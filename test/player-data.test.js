const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPlayerContext } = require('../player-data');
const asOf = new Date('2026-10-17T02:00:00Z');
const row = (extra = {}) => ({ season: 20262027, leagueAbbrev: 'NHL', gameTypeId: 2,
  gamesPlayed: 3, goals: 1, assists: 2, points: 3, shots: 10, ...extra });
const game = (extra = {}) => ({ gameState: 'FUT', gameScheduleState: 'OK', gameType: 2,
  startTimeUTC: '2026-10-18T23:00:00Z', homeTeam: { abbrev: 'TOR' }, awayTeam: { abbrev: 'BOS' }, ...extra });
function mock({ landing = { currentTeamAbbrev: 'TOR', seasonTotals: [row()] },
  current = { gameLog: [] }, previous = { gameLog: [] }, schedule = { games: [] } } = {}) {
  const calls = [];
  return { calls, fetchImpl: async (url, options) => {
    calls.push(url);
    assert.ok(options.signal instanceof AbortSignal);
    const data = url.endsWith('/landing') ? landing : url.includes('/club-schedule-season/') ? schedule
      : url.includes('/20262027/') ? current : previous;
    if (data instanceof Error) throw data;
    return { ok: true, json: async () => data };
  } };
}
test('landing current team overrides stale leaders; schedule selects earliest valid participating game', async () => {
  const transport = mock({ schedule: { games: [game(), game({ startTimeUTC: '2026-10-18T01:00:00Z' }),
    game({ startTimeUTC: '2026-10-17T03:00:00Z', gameState: 'OFF' }),
    game({ startTimeUTC: '2026-10-17T03:00:00Z', gameType: 1 }),
    game({ startTimeUTC: '2026-10-17T03:00:00Z', homeTeam: { abbrev: 'NYR' } })] } });
  const result = await loadPlayerContext(123, 'EDM', { ...transport, asOf });
  assert.equal(transport.calls[0], '/api/nhl/player/123/landing');
  assert.ok(transport.calls.includes('/api/nhl/club-schedule-season/TOR/20262027'));
  assert.equal(result.nextOpponent, 'BOS');
  assert.equal(result.nextGame.startTimeUTC, '2026-10-18T01:00:00Z');
});
test('stale featured and historical totals do not become current season evidence', async () => {
  const transport = mock({ landing: { currentTeamAbbrev: 'TOR',
    featuredStats: { regularSeason: { subSeason: row() } }, seasonTotals: [row({ season: 20252026 })] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.seasonStats, null);
  assert.equal(result.nextGame, null);
});
test('combined total avoids summing team splits twice; absent counts remain unavailable', async () => {
  const transport = mock({ landing: { currentTeamAbbrev: 'TOR', seasonTotals: [row({ teamAbbrev: 'TOR' }),
    row({ teamAbbrev: 'EDM' }), row({ teamAbbrev: 'TOT', gamesPlayed: 6, goals: 2, shots: undefined })] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.seasonStats.gamesPlayed, 6);
  assert.equal(result.seasonStats.goals, 2);
  assert.equal(result.seasonStats.shots, null);
});
test('distinct team splits aggregate and duplicate identical rows do not', async () => {
  const transport = mock({ landing: { currentTeamAbbrev: 'TOR', seasonTotals:
    [row({ teamAbbrev: 'TOR' }), row({ teamAbbrev: 'TOR' }), row({ teamAbbrev: 'EDM' })] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.seasonStats.gamesPlayed, 6);
});
test('partial failures retain successful evidence and distinguish unavailable logs', async () => {
  const transport = mock({ landing: new Error('network'), current: new Error('network'),
    previous: { gameLog: [{ gameId: 1, gameDate: '2026-04-01', goals: 1 }] }, schedule: { unexpected: [] } });
  const result = await loadPlayerContext(123, 'EDM', { ...transport, asOf });
  assert.equal(result.landing, null);
  assert.equal(result.currentGameLog, null);
  assert.equal(result.gameLog.length, 1);
  assert.equal(result.teamAbbrev, 'EDM');
  assert.equal(result.nextGame, null);
  assert.ok(result.warnings.includes('Current team unverified; upcoming matchup unavailable'));
  assert.ok(!transport.calls.some(url => url.includes('club-schedule')));
});
test('logs sort descending, deduplicate, and reject malformed or future rows', async () => {
  const old = { gameId: 1, gameDate: '2026-10-12' };
  const transport = mock({ current: { gameLog: [old, { gameId: 2, gameDate: '2026-10-16' }, null,
    { gameDate: '2027-01-01' }] }, previous: { gameLog: [old] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.deepEqual(result.gameLog.map(g => g.gameId), [2, 1]);
});
test('invalid fallback never enters a URL and invalid IDs fail before fetching', async () => {
  const transport = mock({ landing: new Error('network') });
  const result = await loadPlayerContext(123, '../bad', { ...transport, asOf });
  assert.equal(result.teamAbbrev, null);
  assert.ok(!transport.calls.some(url => url.includes('club-schedule')));
  await assert.rejects(loadPlayerContext('../bad', 'TOR', { ...transport, asOf }), /Invalid player ID/);
});
test('UTC October boundary chooses the season consistently', async () => {
  const transport = mock();
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf: new Date('2026-09-30T23:59:59Z') });
  assert.equal(result.season, 20252026);
});
test('verified current-season featured totals are used before seasonTotals is populated', async () => {
  const transport = mock({ landing: { currentTeamAbbrev: 'TOR', seasonTotals: [row({ season: 20252026 })],
    featuredStats: { season: 20262027, regularSeason: { subSeason: row({ goals: 4 }) } } } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.seasonStats.goals, 4);
});
test('explicitly stale featured totals never qualify', async () => {
  const transport = mock({ landing: { currentTeamAbbrev: 'TOR', seasonTotals: [],
    featuredStats: { season: 20252026, regularSeason: { subSeason: row({ goals: 4 }) } } } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.seasonStats, null);
});
test('missing landing team keeps fallback display but suppresses opponent evidence', async () => {
  const transport = mock({ landing: { seasonTotals: [row()] }, schedule: { games: [game()] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.teamAbbrev, 'TOR');
  assert.equal(result.nextOpponent, null);
  assert.equal(result.nextGame, null);
  assert.ok(!transport.calls.some(url => url.includes('club-schedule')));
});
test('malformed schedule degrades without suppressing valid player evidence', async () => {
  const transport = mock({ schedule: { games: 'invalid' } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.nextGame, null);
  assert.equal(result.seasonStats.goals, 1);
  assert.ok(result.warnings.includes('Team schedule unavailable'));
});
test('postponed, canceled, and unverified schedule states are excluded', async () => {
  const transport = mock({ schedule: { games: [game({ gameScheduleState: 'PPD' }),
    game({ gameScheduleState: 'CNCL' }), game({ gameScheduleState: undefined })] } });
  const result = await loadPlayerContext(123, 'TOR', { ...transport, asOf });
  assert.equal(result.nextGame, null);
  assert.equal(result.nextOpponent, null);
});
