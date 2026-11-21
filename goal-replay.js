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
  const state = { games: [], goals: [], index: 0, timer: null, request: 0, frames: [], frameIndex: 0, tracking: 'unavailable' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const day = d => d.toISOString().slice(0, 10);
  const offsetDay = (date, offset) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + offset); return day(d); };
  const code = team => { const value = team?.abbrev || team?.triCode || team?.abbreviation || ''; return typeof value === 'string' ? value : (value?.default || value?.en || ''); };
  const finished = game => ['OFF', 'FINAL'].includes(game.gameState) || ['OFF', 'FINAL'].includes(game.gameStatus);
  const gameTeams = game => [code(game.awayTeam), code(game.homeTeam)];
  async function json(path) {
    const res = await fetch(api + path);
    if (!res.ok) throw new Error(path + ': HTTP ' + res.status);
    return res.json();
  }
  function stop() { if (state.timer) clearInterval(state.timer); state.timer = null; play.textContent = 'Play'; }
  // NHL EDGE sprite coordinates are inches from the rink corner. Convert to feet,
  // centered at center ice, matching the 200 x 85 foot rink.
  function puckPosition(point) {
    if (!point || typeof point !== 'object') return null;
    const x = Number(point.x), y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x: x / 12 - 100, y: y / 12 - 42.5 };
  }
  function trackingFrames(payload) {
    const frames = Array.isArray(payload) ? payload : payload?.frames || payload?.data?.frames || [];
    if (!Array.isArray(frames)) return [];
    return frames.map((frame, i) => {
      const puck = frame?.puck || frame?.puckPosition || frame?.objects?.puck || null;
      const pos = puckPosition(puck);
      return pos ? { ...pos, time: Number(frame.timeStamp ?? frame.timestamp ?? i * 100) } : null;
    }).filter(Boolean);
  }
  async function loadTracking(goal, token) {
    state.frames = []; state.frameIndex = 0; state.tracking = 'unavailable';
    if (!Number.isInteger(Number(goal.eventId))) { draw(); return; }
    try {
      const response = await fetch('/api/goal-tracking?gameId=' + goal.gameId + '&eventId=' + goal.eventId);
      if (!response.ok) throw new Error('No tracking frames');
      const payload = await response.json();
      if (token !== state.request || state.goals[state.index] !== goal) return;
      state.frames = trackingFrames(payload);
      state.tracking = state.frames.length > 1 ? 'recorded' : 'unavailable';
    } catch (_) { /* show honest fallback */ }
    if (token === state.request && state.goals[state.index] === goal) draw();
  }
  function goToGoal(index) {
    stop();
    state.index = Math.max(0, Math.min(state.goals.length - 1, index));
    state.frames = []; state.frameIndex = 0; state.tracking = 'loading';
    draw();
    const goal = state.goals[state.index];
    if (goal) loadTracking(goal, state.request);
  }
  function reset() { ++state.request; stop(); state.goals = []; state.frames = []; state.frameIndex = 0; state.index = 0; rink.innerHTML = ''; details.textContent = ''; progress.textContent = ''; }
  function draw() {
    if (!state.goals.length) { details.textContent = 'No regulation/overtime goals available for this game.'; return; }
    const goal = state.goals[state.index], d = goal.details || {};
    const x = Number(d.xCoord), y = Number(d.yCoord);
    // NHL coordinates: x approx -100..100 feet, y approx -42..42 feet.
    const valid = Number.isFinite(x) && Number.isFinite(y) && d.xCoord != null && d.yCoord != null;
    const px = valid ? 300 + x * 2.55 : 300;
    const py = valid ? 150 - y * 2.55 : 150;
    const frames = state.tracking === 'recorded' ? state.frames.slice(0, state.frameIndex + 1) : [];
    const coords = frames.map(p => [300 + p.x * 2.55, 150 - p.y * 2.55]);
    const path = coords.map((p,i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = coords[coords.length - 1];
    rink.innerHTML = `<rect width="600" height="300" rx="40" fill="#f8fafc" stroke="#94a3b8" stroke-width="3"/>
      <path d="M300 0V300 M115 0V300 M485 0V300" stroke="#ef4444" stroke-width="2" opacity=".65"/>
      <circle cx="300" cy="150" r="48" fill="none" stroke="#2563eb" stroke-width="2"/>
      <circle cx="145" cy="150" r="55" fill="none" stroke="#ef4444" opacity=".35"/>
      <circle cx="455" cy="150" r="55" fill="none" stroke="#ef4444" opacity=".35"/>
      <path d="M30 125v50 M570 125v50" stroke="#2563eb" stroke-width="6"/>
      ${frames.length > 1 ? `<path d="${path}" fill="none" stroke="#ea580c" stroke-width="3" stroke-linejoin="round"/>` : ''}
      ${last ? `<circle cx="${last[0]}" cy="${last[1]}" r="7" fill="#ea580c" stroke="#fff" stroke-width="2"/>` : valid ? `<circle cx="${px}" cy="${py}" r="9" fill="#ea580c" stroke="#fff" stroke-width="3"/>` : ''}`;
    const scorer = goal.roster.get(d.scoringPlayerId);
    const assists = [d.assist1PlayerId, d.assist2PlayerId].filter(Boolean).map(id => goal.roster.get(id) || ('Player #' + id));
    details.innerHTML = `<strong>${esc(scorer || 'Scorer unavailable')}</strong> · ${esc(goal.team)} · Period ${esc(goal.period)} · ${esc(goal.time)}
      <div>Shot: ${esc(d.shotType || 'Unavailable')} · Assists: ${esc(assists.join(', ') || 'None recorded')}</div>
      <div>Position: ${valid ? esc(x + ', ' + y + ' ft') : 'Unavailable'} · Shot speed: unavailable · xG: unavailable</div>
      <div class="text-xs text-gray-400">${state.tracking === "recorded" ? "Recorded NHL EDGE puck trajectory · " + state.frames.length + " available puck frames" : state.tracking === "loading" ? "Loading recorded puck tracking…" : "Tracking unavailable for this goal; showing goal-event location only."}</div>`;
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
        .map(p => ({ ...p, gameId: game.id, roster, team: p.details?.eventOwnerTeamId === data.awayTeam?.id ? code(data.awayTeam) : p.details?.eventOwnerTeamId === data.homeTeam?.id ? code(data.homeTeam) : 'Unknown', period: p.periodDescriptor?.number, time: p.timeInPeriod }));
      status.textContent = esc(gameTeams(game).join(' @ ')) + ' · ' + state.goals.length + ' goals';
      goToGoal(0);
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
      // Use each club's season schedule, not the date score archive.
      // The NHL club-schedule-season endpoint returns completed games for the team.
      const year = Number(date.slice(0, 4));
      const seasonStart = Number(date.slice(5, 7)) >= 7 ? year : year - 1;
      const season = String(seasonStart) + String(seasonStart + 1);
      const results = await Promise.allSettled([...teams].map(async team => ({
        team, data: await json('/club-schedule-season/' + encodeURIComponent(team) + '/' + season)
      })));
      const unique = new Map();
      const errors = [];
      const missing = [];
      for (let i = 0; i < results.length; i++) {
        const result = results[i], team = [...teams][i];
        if (result.status !== 'fulfilled') {
          errors.push(team + ': ' + result.reason.message);
          continue;
        }
        const schedule = result.value.data;
        const candidates = (schedule.games || []).filter(g => {
          const gameDate = g.gameDate || g.startTimeUTC?.slice(0,10) || '';
          return gameDate < date && finished(g) && gameTeams(g).includes(team);
        }).sort((a,b) => (b.gameDate || '').localeCompare(a.gameDate || ''));
        if (!candidates.length) missing.push(team);
        for (const g of candidates.slice(0, 3)) unique.set(g.id, g);
      }
      state.games = [...unique.values()].sort((a,b) => (b.gameDate || '').localeCompare(a.gameDate || ''));
      if (!state.games.length) {
        status.textContent = 'No historical games loaded. ' +
          (errors.length ? 'API errors: ' + errors.join('; ') : 'No completed games matched for: ' + missing.join(', ')) +
          '. Season ' + season + '.';
      }
      for (const g of state.games) {
        const opt = document.createElement('option');
        opt.value = String(g.id);
        opt.textContent = g.gameDate + ' · ' + gameTeams(g).join(' @ ');
        gameSelect.appendChild(opt);
      }
      if (state.games.length) status.textContent = state.games.length + ' historical games for ' + teams.size + ' scheduled teams (up to 3 per team).' + (errors.length ? ' API errors: ' + errors.join('; ') : '');
      if (state.games.length) await selectGame();
    } catch (err) { status.textContent = 'Could not load replay: ' + err.message; }
  }
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year:'numeric', month:'2-digit', day:'2-digit' }).formatToParts(new Date()).map(p => [p.type, p.value]));
  dateInput.value = parts.year + '-' + parts.month + '-' + parts.day;
  refresh.addEventListener('click', load);
  gameSelect.addEventListener('change', selectGame);
  prev.addEventListener('click', () => goToGoal(state.index - 1));
  next.addEventListener('click', () => goToGoal(state.index + 1));
  play.addEventListener('click', () => {
    if (state.timer) { stop(); return; }
    if (state.tracking !== 'recorded' || state.frames.length < 2) {
      status.textContent = 'Recorded puck tracking is unavailable for this goal.';
      return;
    }
    if (state.frameIndex >= state.frames.length - 1) state.frameIndex = 0;
    play.textContent = 'Pause'; draw();
    state.timer = setInterval(() => {
      if (state.frameIndex >= state.frames.length - 1) { stop(); return; }
      state.frameIndex++; draw();
    }, 100);
  });
  // Lazy load only when the user opens the tab.
  document.querySelector('[data-tab="goal-replay"]')?.addEventListener('click', () => { if (!state.games.length) load(); });
})();
