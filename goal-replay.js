/* Last three completed games for teams scheduled on the selected date.
 * NHL public API: /score/{date}, /schedule/{date}, /gamecenter/{id}/play-by-play.
 * Goal coordinates are event positions, NOT reconstructed puck trajectories.
 */
(function () {
  'use strict';
  const root = document.getElementById('goal-replay-root');
  if (!root) return;
  const api = '/api/nhl';
  const dateInput = document.getElementById('goal-replay-date');
  const status = document.getElementById('goal-replay-status');
  const gameSelect = document.getElementById('goal-replay-game');
  const rink = document.getElementById('goal-replay-rink');
  const details = document.getElementById('goal-replay-details');
  const progress = document.getElementById('goal-replay-progress');
  const prev = document.getElementById('goal-replay-prev');
  const next = document.getElementById('goal-replay-next');
  const play = document.getElementById('goal-replay-play');
  const refresh = document.getElementById('goal-replay-load');
  const state = { games: [], goals: [], index: 0, timer: null, request: 0 };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = d => d.toISOString().slice(0, 10);
  const offsetDay = (date, offset) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return day(d); };
  const code = team => team?.abbrev || team?.triCode || team?.abbreviation || '';
  const finished = game => ['OFF', 'FINAL'].includes(game.gameState) || game.gameState === 'FINAL';
  const gameTeams = game => [code(game.awayTeam), code(game.homeTeam)];
  async function json(path) {
    const res = await fetch(api + path);
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
    return res.json();
  }
  function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; play.textContent = 'Play'; }
  function reset() { stop(); state.goals = []; state.index = 0; rink.innerHTML = ''; details.textContent = ''; progress.textContent = ''; }
  function draw() {
    if (!state.goals.length) { details.textContent = 'No regulation/overtime goals available for this game.'; return; }
    const goal = state.goals[state.index], d = goal.details || {};
    const x = Number(d.xCoord), y = Number(d.yCoord);
    // NHL coordinates: x approx -100..100 feet, y approx -42..42 feet.
    const valid = Number.isFinite(x) && Number.isFinite(y) && d.xCoord != null && d.yCoord != null;
    const px = valid ? 300 + x * 2.55 : 300;
    const py = valid ? 150 - y * 2.55 : 150;
    rink.innerHTML = `<rect width="600" height="300" rx="40" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>
      <path d="M300 0V300 M115 0V300 M485 0V300" stroke="#ef4444" stroke-width="2" opacity=".65"/>
      <circle cx="300" cy="150" r="48" fill="none" stroke="#2563eb" stroke-width="2"/>
      <circle cx="145" cy="150" r="55" fill="none" stroke="#ef4444" opacity=".35"/>
      <circle cx="455" cy="150" r="55" fill="none" stroke="#ef4444" opacity=".35"/>
      <path d="M30 125v50 M570 125v50" stroke="#2563eb" stroke-width="6"/>
      ${valid ? `<circle cx="${px}" cy="${py}" r="9" fill="#ea580c" stroke="#fff" stroke-width="3"/>` : ''}`;
    const scorer = goal.roster.get(d.scoringPlayerId);
    const assists = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map(id => goal.roster.get(id) || ('Player #' + id));
    details.innerHTML = `<strong>${esc(scorer || 'Scorer unavailable')}</strong> · ${esc(goal.team)} · Period ${esc(goal.period)} · ${esc(goal.time)}
      <div>Shot: ${esc(d.shotType || 'Unavailable')} · Assists: ${esc(assists.join(', ') || 'None recorded')}</div>
      <div>Position: ${valid ? esc(x + ', ' + y + ' ft') : 'Unavailable'} · Shot speed: unavailable · xG: unavailable</div>
      <div class="text-xs text-gray-400">Goal location marker only; trajectory is not available from this feed.</div>`;
    progress.textContent = 'Goal ' + (state.index + 1) + ' of ' + state.goals.length;
    prev.disabled = state.index === 0;
    next.disabled = state.index === state.goals.length - 1;
  }
  async function selectGame() {
    stop(); reset();
    const game = state.games.find(g => String(g.id) === gameSelect.value);
    if (!game) return;
    const token = ++state.request;
    status.textContent = 'Loading play-by-play…';
    try {
      const data = await json('/gamecenter/' + game.id + '/play-by-play');
      if (token !== state.request) return;
      const roster = new Map((data.rosterSpots || []).map(p => [p.playerId, [p.firstName?.default || p.firstName, p.lastName?.default || p.lastName].filter(Boolean).join(' ')]));
      state.goals = (data.plays || []).filter(p => p.typeDescKey === 'goal' && p.periodDescriptor?.periodType !== 'SO')
        .sort((a,b) => (a.sortOrder || 0) - (b.sortOrder || 0))
        .map(p => ({ ...p, roster, team: p.details?.eventOwnerTeamId === data.awayTeam?.id ? code(data.awayTeam) : p.details?.eventOwnerTeamId === data.homeTeam?.id ? code(data.homeTeam) : 'Unknown', period: p.periodDescriptor?.number, time: p.timeInPeriod }));
      status.textContent = esc(gameTeams(game).join(' @ ')) + ' · ' + state.goals.length + ' goals';
      draw();
    } catch (err) { if (token === state.request) status.textContent = 'Play-by-play unavailable: ' + err.message; }
  }
  async function load() {
    ++state.request; reset(); gameSelect.replaceChildren(); state.games = [];
    status.textContent = 'Finding teams and their last three completed games…';
    const date = dateInput.value;
    if (!date) { status.textContent = 'Select a date.'; return; }
    try {
      const score = await json('/score/' + date);
      const todayGames = score.games || [];
      const teams = new Set(todayGames.flatMap(gameTeams).filter(Boolean));
      if (!teams.size) { status.textContent = 'No NHL games scheduled for this date.'; return; }
      // Five weekly windows provide up to 35 days of history, without fetching every day.
      const windows = await Promise.all([ -35, -28, -21, -14, -7 ].map(n => json('/schedule/' + offsetDay(date, n))));
      const unique = new Map();
      for (const window of windows) for (const week of (window.gameWeek || [])) for (const g of (week.games || [])) {
        if (g.gameDate < date && finished(g) && gameTeams(g).some(t => teams.has(t))) unique.set(g.id, g);
      }
      const history = [...unique.values()].sort((a,b) => b.gameDate.localeCompare(a.gameDate));
      const chosen = new Map();
      for (const team of teams) for (const game of history.filter(g => gameTeams(g).includes(team)).slice(0,3)) chosen.set(game.id, game);
      state.games = [...chosen.values()].sort((a,b) => b.gameDate.localeCompare(a.gameDate));
      for (const g of state.games) {
        const opt = document.createElement('option');
        opt.value = String(g.id);
        opt.textContent = g.gameDate + ' · ' + gameTeams(g).join(' @ ');
        gameSelect.appendChild(opt);
      }
      status.textContent = state.games.length ? state.games.length + ' unique historical games for ' + teams.size + ' teams (up to 3 per team)' : 'No completed games found in the previous 35 days.';
      if (state.games.length) await selectGame();
    } catch (err) { status.textContent = 'Could not load replay: ' + err.message; }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  dateInput.value = parts.year + '-' + parts.month + '-' + parts.day;
  refresh.addEventListener('click', load);
  gameSelect.addEventListener('change', selectGame);
  prev.addEventListener('click', () => { stop(); state.index = Math.max(0, state.index - 1); draw(); });
  next.addEventListener('click', () => { stop(); state.index = Math.min(state.goals.length - 1, state.index + 1); draw(); });
  play.addEventListener('click', () => {
    if (state.timer) { stop(); return; }
    if (!state.goals.length) return;
    if (state.index === state.goals.length - 1) state.index = 0;
    draw(); play.textContent = 'Pause';
    state.timer = setInterval(() => { if (state.index >= state.goals.length - 1) { stop(); return; } ++state.index; draw(); }, 1800);
  });
  // Lazy load only when the user opens the tab.
  document.querySelector('[data-tab="goal-replay"]')?.addEventListener('click', () => { if (!state.games.length) load(); });
})();
