const { test } = require('node:test');
const assert = require('node:assert/strict');
const { rankGoalScorers } = require('../daily-goal-model');

const game = { id: 1, gameState: 'FUT', startTimeUTC: '2026-10-16T23:00:00Z',
  homeTeam: { abbrev: 'EDM' }, awayTeam: { abbrev: 'BOS' } };
const skater = (id, goals, gamesPlayed) => ({ playerId: id, firstName: { default: 'Player' },
  lastName: { default: String(id) }, goals, gamesPlayed });
const base = { games: [game], teamStats: { EDM: { skaters: [skater(1, 30, 80), skater(2, 10, 80)] },
  BOS: { skaters: [skater(3, 25, 80), skater(4, 0, 80)] } } };
const opts = { asOf: '2026-10-16T15:00:00Z' };

test('ranks at least three eligible skaters with bounded model percentages', () => {
  const [result] = rankGoalScorers(base, opts);
  assert.equal(result.gameId, 1);
  assert.equal(result.picks.length, 3);
  assert.equal(result.picks[0].playerId, 1);
  assert.ok(result.picks.every(p => Number.isInteger(p.estimatedGoalPct) && p.estimatedGoalPct >= 0 && p.estimatedGoalPct <= 95));
  assert.match(result.picks[0].reason, /model estimate/);
});

test('recent and opponent evidence excludes current-day and future rows', () => {
  const evidence = { ...base, recentByPlayer: { 1: [
    { gameId: 10, gameDate: '2026-10-15', goals: 1 },
    { gameId: 11, gameDate: '2026-10-16', goals: 10 },
    { gameId: 12, gameDate: '2026-10-17', goals: 10 },
  ] }, opponentByPlayer: { 1: [
    { gameId: 13, gameDate: '2026-09-01', opponentAbbrev: 'BOS', goals: 1 },
    { gameId: 14, gameDate: '2026-09-02', opponentAbbrev: 'TOR', goals: 1 },
  ] } };
  const [result] = rankGoalScorers(evidence, opts);
  const pick = result.picks.find(p => p.playerId === 1);
  assert.equal(pick.factors.recentGames, 1);
  assert.equal(pick.factors.opponentGames, 1);
});

test('missing stats are excluded and completed games are not predicted', () => {
  const input = { ...base, teamStats: { EDM: { skaters: [skater(1, null, 80), skater(2, 10, 80)] },
    BOS: { skaters: [skater(3, 25, 80)] } } };
  assert.equal(rankGoalScorers(input, opts)[0].picks.length, 2);
  assert.deepEqual(rankGoalScorers({ ...base, games: [{ ...game, gameState: 'FINAL' }] }, opts), []);
});
