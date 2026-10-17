const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { calculateProps, normalizeGames } = require('../prediction-model');
const options = { asOf: '2026-10-16T12:00:00Z' };
const game = (id, goals, extra = {}) => ({ gameId: id, gameDate: `2026-10-${String(id).padStart(2, '0')}`, opponentAbbrev: 'TOR', goals, assists: 1, shots: 3, ...extra });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} != ${expected}`);

test('weighted goals and points use independently shrunk empirical rates', () => {
  const result = calculateProps({ gamesPlayed: 10, goals: 5, assists: 5, points: 10, shots: 20 }, [game(1, 0), game(2, 2)], ' tor ', options);
  near(result.goals.recent.rate, 1);
  near(result.goals.recent.shrunkRate, 4.5 / 7);
  near(result.goals.opponent.shrunkRate, 7 / 12);
  near(result.goals.projected, 0.45 * 0.5 + 0.35 * (4.5 / 7) + 0.20 * (7 / 12));
  near(result.points.projected, 0.45 + 0.35 * (9 / 7) + 0.20 * (14 / 12));
  assert.equal(result.goals.opponent.hitRate, 0.5);
  assert.equal(result.goals.recent.streak, 1);
  assert.equal(result.goals.recent.uplift, 0.5);
});

test('a single exceptional matchup is shrunk instead of treated as a probability', () => {
  const result = calculateProps({ gamesPlayed: 20, goals: 10 }, [game(1, 4)], 'TOR', options).goals;
  near(result.opponent.shrunkRate, 9 / 11);
  assert.equal(result.opponent.hitRate, 1);
  assert.equal(result.opponent.games, 1);
  for (const forbidden of ['probability', 'confidence', 'line', 'over', 'under']) assert.equal(result[forbidden], undefined);
});

test('normalization rejects invalid dates, future/today rows, deduplicates numeric/string IDs, sorts', () => {
  const rows = normalizeGames([game(1, 0), game(2, 1), game(2, 8, { gameId: '2' }), game(16, 9), game(17, 9), game(4, 1, { gameDate: '2026-02-30' }), null, game(5, 1, { gameDate: 'invalid' })], options);
  assert.deepEqual(rows.map(row => row.goals), [1, 0]);
  assert.deepEqual(normalizeGames([], { asOf: 'invalid' }), []);
});

test('missing and malformed counts are not zero and cannot bridge a streak', () => {
  const rows = [game(1, 2), game(2, null, { assists: '2', shots: -1 }), game(3, 1, { shots: Infinity }), game(4, 2.5, { shots: NaN })];
  const normalized = normalizeGames(rows, options);
  assert.equal(normalized[0].goals, null);
  assert.equal(normalized[2].points, null);
  const result = calculateProps({}, rows, 'TOR', options);
  assert.equal(result.goals.recent.games, 2);
  assert.equal(result.goals.recent.streak, null);
  assert.equal(result.shots.recent.games, 1);
  assert.equal(result.points.recent.games, 2);
  assert.equal(calculateProps({}, rows.slice(0, 3), 'TOR', options).goals.recent.streak, 1);
});

test('missing opponent data renormalizes weights; zero remains a valid observation', () => {
  const result = calculateProps({ gamesPlayed: 10, goals: 0 }, [game(1, 0)], 'BOS', options).goals;
  assert.equal(result.projected, 0);
  assert.equal(result.opponent.rate, null);
  assert.equal(result.opponent.hitRate, null);
  near(result.weights.season, 0.45 / 0.8);
  near(result.weights.recent, 0.35 / 0.8);
  assert.equal(result.weights.opponent, 0);
  assert.equal(result.recent.hitRate, 0);
});

test('no data yields null projection, season-only works, missing seasons use observed baseline', () => {
  assert.equal(calculateProps(null, null, null, options).goals.projected, null);
  const seasonOnly = calculateProps({ gamesPlayed: 4, goals: 2 }, [], null, options).goals;
  assert.equal(seasonOnly.projected, 0.5);
  assert.equal(seasonOnly.weights.season, 1);
  const observed = calculateProps({}, [game(1, 0), game(2, 2)], 'TOR', options).goals;
  near(observed.projected, 1);
  assert.equal(observed.seasonRate, null);
  assert.equal(observed.weights.season, 0);
});

test('current-season form is separate from historical matchups and streak exceeds window', () => {
  const current = Array.from({ length: 7 }, (_, i) => game(i + 1, 1));
  const old = game(100, 5, { gameDate: '2025-01-01' });
  const result = calculateProps({}, [old, ...current], 'TOR', { ...options, recentLog: current }).goals;
  assert.equal(result.recent.games, 5);
  assert.equal(result.recent.streak, 7);
  assert.equal(result.opponent.games, 8);
  near(result.opponent.shrunkRate, 22 / 18);
  const early = calculateProps({}, [old], 'TOR', { ...options, recentLog: [] }).goals;
  assert.equal(early.recent.games, 0);
  assert.equal(early.recent.streak, null);
  assert.equal(early.weights.recent, 0);
  assert.equal(early.projected, null);
  assert.equal(early.opponent.rate, 5);
  assert.equal(early.opponent.shrunkRate, null);
  assert.equal(early.opponent.shrinkageApplied, false);
  assert.equal(early.baselineRate, null);
  assert.equal(early.baselineSource, null);
  near(result.baselineRate, 1);
  assert.equal(result.baselineSource, 'observed-history');
});

test('points fallback requires both counts and a supplied zero is retained', () => {
  const rows = normalizeGames([game(1, 2, { points: 0 }), game(2, 2, { assists: null }), game(3, 2)], options);
  assert.deepEqual(rows.map(row => row.points), [3, null, 0]);
});

test('opponents match normalized abbreviations exactly and unavailable fields have independent weights', () => {
  const result = calculateProps({ gamesPlayed: 10, goals: 5 }, [game(1, 1, { opponentAbbrev: ' tor ', shots: null }), game(2, 3, { opponentAbbrev: 'BOS', shots: null })], 'TOR', options);
  assert.equal(result.goals.opponent.games, 1);
  assert.equal(result.goals.opponent.rate, 1);
  assert.equal(result.shots.projected, null);
  assert.deepEqual(result.shots.weights, { season: 0, recent: 0, opponent: 0 });
  assert.equal(calculateProps({}, [game(1, 1)], 'TO', options).goals.opponent.games, 0);
});

test('missing recent stats do not pull older games into the five-game window', () => {
  const rows = Array.from({ length: 6 }, (_, i) => game(i + 1, i === 5 ? null : 1));
  const result = calculateProps({}, rows, null, options).goals;
  assert.equal(result.recent.games, 4);
  assert.equal(result.recent.streak, null);
});

test('shotsOnGoal fills missing shots, preserves explicit zero, and rejects malformed alias', () => {
  const rows = normalizeGames([game(1, 1, { shots: null, shotsOnGoal: 4 }), game(2, 1, { shots: 0, shotsOnGoal: 4 }), game(3, 1, { shots: undefined, shotsOnGoal: '4' })], options);
  assert.deepEqual(rows.map(row => row.shots), [null, 0, 4]);
  const result = calculateProps({ gamesPlayed: 10, shotsOnGoal: 20 }, [], null, options).shots;
  assert.equal(result.projected, 2);
  assert.equal(result.baselineSource, 'season');
  assert.equal(result.recent.streak, null);
  assert.equal(calculateProps({}, [game(1, 0)], null, options).goals.recent.streak, 0);
});

test('browser global exposes the same dependency-free API', () => {
  const context = {};
  vm.runInNewContext(fs.readFileSync(require.resolve('../prediction-model'), 'utf8'), context);
  assert.equal(typeof context.NHLPlayerModel.calculateProps, 'function');
  assert.equal(typeof context.NHLPlayerModel.normalizeGames, 'function');
});
