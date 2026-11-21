const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../goal-replay.js'), 'utf8');

test('goal replay source parses', () => {
  assert.doesNotThrow(() => new vm.Script(source));
});
test('goal replay uses NHL event data and avoids fabricating tracking metrics', () => {
  assert.match(source, /\/gamecenter\/.*play-by-play/);
  assert.match(source, /typeDescKey === 'goal'/);
  assert.match(source, /shot speed: unavailable/i);
  assert.match(source, /xG: unavailable/);
  assert.match(source, /slice\(0,3\)/);
});
test('replay is initialized only when its UI exists', () => {
  const context = vm.createContext({ document: { getElementById: () => null } });
  assert.doesNotThrow(() => vm.runInContext(source, context));
});
