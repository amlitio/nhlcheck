const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const NHLPlayerModel = require('../prediction-model');

function app(loader) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      innerHTML: '', textContent: '', classList: { add() {}, remove() {} },
      addEventListener() {}, appendChild() {}, querySelectorAll() { return []; },
    });
    return elements.get(id);
  };
  const context = vm.createContext({
    NHLPlayerModel, NHLPlayerData: { loadPlayerContext: loader }, console,
    fetch: async () => ({ ok: true, json: async () => ({ children: [] }) }),
    document: { getElementById: element, querySelectorAll: () => [],
      addEventListener() {}, body: { style: {} } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../main'), 'utf8'), context);
  return { context, element };
}

test('player cards show empirical percentages and missing evidence without fabricated confidence', () => {
  const { context } = app();
  const games = [{ gameId: 1, gameDate: '2026-10-01', goals: 1, assists: 1, opponentAbbrev: 'TOR' }];
  const props = NHLPlayerModel.calculateProps({ gamesPlayed: 10, goals: 4, points: 10 }, games, 'TOR', { asOf: '2026-10-16' });
  const html = context.renderModalBody({}, games, null, props, 'TOR', {}, {
    fetchedAt: '2026-10-16T12:00:00Z', season: 20262027, warnings: ['<script>bad</script>'],
  });
  assert.match(html, /100.0% \(1 games\)/);
  assert.match(html, /Opponent 1\+ rate/);
  assert.match(html, /Unavailable \(0 games\)/);
  assert.match(html, /&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html, /Confidence|confidence-bar|>OVER<|>UNDER<|<script>/);
  assert.doesNotMatch(html, /NaN|undefined/);
});

test('modal escapes upstream player text and image attributes', () => {
  const { context } = app();
  const html = context.renderModalHeader({ firstName: { default: '<img src=x>' },
    headshot: '" onload="alert(1)', position: '<script>', teamAbbrev: 'TOR' });
  assert.match(html, /&lt;img src=x&gt;/);
  assert.match(html, /&quot; onload=&quot;/);
  assert.doesNotMatch(html, /<script>|src="" onload=/);
});

test('slow previous modal requests cannot overwrite the newest player or a closed modal', async () => {
  const pending = [];
  const { context, element } = app(() => new Promise(resolve => pending.push(resolve)));
  const player = id => ({ id, firstName: { default: 'Player ' + id }, teamAbbrev: 'TOR' });
  const data = { gameLog: [], currentGameLog: [], nextGame: null, nextOpponent: null,
    seasonStats: null, landing: null, teamAbbrev: 'TOR', warnings: [], fetchedAt: '2026-10-16T12:00:00Z' };
  const first = context.openPlayerModal(player(1));
  const second = context.openPlayerModal(player(2));
  pending[1](data); await second;
  pending[0](data); await first;
  assert.match(element('modal-title').innerHTML, /Player 2/);
  const third = context.openPlayerModal(player(3));
  context.closeModal();
  const before = element('modal-content').innerHTML;
  pending[2](data); await third;
  assert.equal(element('modal-content').innerHTML, before);
});

test('scores request uses viewer calendar date and no invented percentages', async () => {
  const { context, element } = app();
  const calls = [];
  context.fetch = async url => {
    calls.push(url);
    if (String(url).includes('scoreboard')) return { ok: true, json: async () => ({ events: [{ competitions: [{ competitors: [
      { homeAway: 'home', team: { abbreviation: 'COL' }, score: '5' },
      { homeAway: 'away', team: { abbreviation: 'PIT' }, score: '2' },
    ] }], status: { type: { state: 'post', shortDetail: 'Final' } } }] }) };
    return { ok: true, json: async () => ({ children: [] }) };
  };
  await context.fetchScores();
  assert.match(calls.find(url => String(url).includes('scoreboard')), /dates=\d{8}/);
  assert.match(element('scores-container').innerHTML, /PIT/);
  assert.match(element('scores-container').innerHTML, /COL/);
  assert.doesNotMatch(element('scores-container').innerHTML, /Confidence|homeWinPct/);
});
