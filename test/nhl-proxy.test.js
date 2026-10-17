const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/nhl');
const config = require('../vercel.json');
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k]=v; },
    status(n) { this.statusCode=n; return this; }, json(v) { this.body=v; return this; },
    end(v) { this.body=v; return this; } };
}
test('Vercel rewrite passes a roster path to the NHL proxy', async () => {
  assert.deepEqual(config.rewrites, [{ source: '/api/nhl/:path*', destination: '/api/nhl?path=:path*' }]);
  const original = global.fetch;
  let target;
  global.fetch = async url => { target=url; return { status:200, text:async()=>'{"forwards":[],"defensemen":[],"goalies":[]}' }; };
  try {
    const res=response();
    await handler({ method:'GET', query:{ path:'roster/FLA/current' } },res);
    assert.equal(res.statusCode,200);
    assert.equal(target,'https://api-web.nhle.com/v1/roster/FLA/current');
    assert.deepEqual(JSON.parse(res.body),{forwards:[],defensemen:[],goalies:[]});
  } finally { global.fetch=original; }
});
test('proxy rejects invalid path and does not expose upstream errors', async () => {
  const bad=response(); await handler({method:'GET',query:{path:'../secret'}},bad);
  assert.equal(bad.statusCode,400);
  const original=global.fetch;
  global.fetch=async()=>{throw Error('private upstream detail');};
  try { const res=response(); await handler({method:'GET',query:{path:'roster/FLA/current'}},res);
    assert.equal(res.statusCode,502); assert.doesNotMatch(JSON.stringify(res.body),/private|https:/);
  } finally {global.fetch=original;}
});
