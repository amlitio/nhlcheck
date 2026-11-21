const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/goal-tracking');
function response() {
  return { statusCode: 200, headers: {}, status(n) { this.statusCode = n; return this; },
    setHeader(k,v) { this.headers[k] = v; }, json(body) { this.body = body; return this; } };
}
test('rejects malformed game and event IDs without requesting upstream', async () => {
  const res = response();
  await handler({ method: 'GET', query: { gameId: '../bad', eventId: '1' } }, res);
  assert.equal(res.statusCode, 400);
});
test('forwards validated NHL EDGE tracking frames', async () => {
  const original = global.fetch;
  let url;
  global.fetch = async target => { url = target; return { ok: true, status: 200, text: async () => JSON.stringify({ frames: [{ puck: { x: 1200, y: 510 } }] }) }; };
  try {
    const res = response();
    await handler({ method: 'GET', query: { gameId: '2026020211', eventId: '95' } }, res);
    assert.equal(res.statusCode, 200);
    assert.match(url, /\/sprites\/2026\/2026020211\/ev95\.json$/);
    assert.equal(res.body.frames.length, 1);
  } finally { global.fetch = original; }
});
test('returns missing state for unpublished goal tracking', async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 404 });
  try {
    const res = response();
    await handler({ method: 'GET', query: { gameId: '2026020211', eventId: '95' } }, res);
    assert.equal(res.statusCode, 404);
  } finally { global.fetch = original; }
});
