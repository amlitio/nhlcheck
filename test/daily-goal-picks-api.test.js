const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/daily-goal-picks');

function response() {
  return { statusCode: 200, headers: {}, setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}
const today = () => new Date().toISOString().slice(0, 10);

test('rejects invalid methods and dates before contacting NHL', async () => {
  const original = global.fetch;
  global.fetch = () => { throw Error('should not fetch'); };
  try {
    const method = response();
    await handler({ method: 'POST', query: { date: today() } }, method);
    assert.equal(method.statusCode, 405);
    const badDate = response();
    await handler({ method: 'GET', query: { date: '2026-02-30' } }, badDate);
    assert.equal(badDate.statusCode, 400);
  } finally { global.fetch = original; }
});

test('returns a schedule with no retroactive picks for finished games', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ games: [{ id: 1, gameType: 2, gameState: 'OFF', awayTeam: { abbrev: 'FLA' }, homeTeam: { abbrev: 'BOS' } }] }) });
  try {
    const res = response();
    await handler({ method: 'GET', query: { date: today() } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.games[0].picks.length, 0);
    assert.equal(res.headers['Cache-Control'], 's-maxage=300, stale-while-revalidate=300');
  } finally { global.fetch = original; }
});

test('hides upstream failure details', async () => {
  const original = global.fetch;
  global.fetch = async () => { throw Error('private upstream detail'); };
  try {
    const res = response();
    await handler({ method: 'GET', query: { date: today() } }, res);
    assert.equal(res.statusCode, 502);
    assert.doesNotMatch(JSON.stringify(res.body), /private upstream detail/);
  } finally { global.fetch = original; }
});

test('includes playoff games and requests playoff club stats', async () => {
  const original = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('/score/')) return { ok: true, json: async () => ({ games: [{ id: 5, gameType: 3, gameState: 'FUT', season: 20262027,
      startTimeUTC: new Date(Date.now() + 86400000).toISOString(), awayTeam: { abbrev: 'FLA' }, homeTeam: { abbrev: 'BOS' } }] }) };
    if (String(url).includes('/club-stats/')) return { ok: true, json: async () => ({ skaters: [] }) };
    return { ok: true, json: async () => ({ forwards: [], defensemen: [] }) };
  };
  try {
    const res = response();
    await handler({ method: 'GET', query: { date: today() } }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.games.length, 1);
    assert.ok(urls.some(url => url.includes('/club-stats/FLA/20262027/3')));
  } finally { global.fetch = original; }
});
