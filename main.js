// ─── API Base ─────────────────────────────────────────────────────────────────
// All NHL calls route through our Vercel serverless proxy (api/nhl/[...path].js)
// which forwards them server-side to api-web.nhle.com/v1 — no CORS issues.
const API_BASE = '/api/nhl';

// ─── DOM References ────────────────────────────────────────────────────────────
const teamSelect          = document.getElementById('team-select');
const statsContainer      = document.getElementById('stats-container');
const loadingIndicator    = document.getElementById('loading-indicator');
const standingsContainer  = document.getElementById('standings-container');
const standingsLoading    = document.getElementById('standings-loading');
const scoresContainer     = document.getElementById('scores-container');
const scoresLoading       = document.getElementById('scores-loading');
const topScorersContainer = document.getElementById('top-scorers-container');
const topScorersLoading   = document.getElementById('top-scorers-loading');
const playerModal         = document.getElementById('player-modal');
const modalTitle          = document.getElementById('modal-title');
const modalContent        = document.getElementById('modal-content');

// Cache so row click-handlers can look up the full player object by index
let _leadersCache = null;

// ─── Country Flags ─────────────────────────────────────────────────────────────
// NOTE: birthCountry is NOT included in the scoring-leaders endpoint response.
// It IS included in the player landing endpoint, which we fetch when the modal opens.
const COUNTRY_FLAGS = {
  'CAN': '🇨🇦', 'USA': '🇺🇸', 'SWE': '🇸🇪', 'FIN': '🇫🇮',
  'RUS': '🇷🇺', 'CZE': '🇨🇿', 'SVK': '🇸🇰', 'GER': '🇩🇪',
  'DEU': '🇩🇪', 'AUT': '🇦🇹', 'SUI': '🇨🇭', 'CHE': '🇨🇭',
  'DEN': '🇩🇰', 'DNK': '🇩🇰', 'NOR': '🇳🇴', 'NLD': '🇳🇱',
  'LAT': '🇱🇻', 'LVA': '🇱🇻', 'BLR': '🇧🇾', 'KAZ': '🇰🇿',
  'FRA': '🇫🇷', 'GBR': '🇬🇧', 'POL': '🇵🇱', 'UKR': '🇺🇦',
  'SLO': '🇸🇮', 'SVN': '🇸🇮', 'HUN': '🇭🇺', 'ITA': '🇮🇹',
  'AUS': '🇦🇺', 'CHN': '🇨🇳', 'KOR': '🇰🇷', 'JPN': '🇯🇵',
};

function getFlag(code) { return COUNTRY_FLAGS[code] || ''; }

const SPINNER_SVG = `<svg class="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
</svg>`;

// ─── Tab Switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');

    if (btn.dataset.tab === 'standings'   && !standingsContainer.innerHTML)  fetchStandings();
    if (btn.dataset.tab === 'scores'      && !scoresContainer.innerHTML)     fetchScores();
    if (btn.dataset.tab === 'top-scorers' && !topScorersContainer.innerHTML) fetchAndRenderTopScorers();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showLoading(el) { el.classList.remove('hidden'); }
function hideLoading(el) { el.classList.add('hidden'); }

function getCurrentSeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 10 ? year : year - 1;
  return `${start}${start + 1}`;
}

// ─── Team Dropdown (Team Stats tab) ───────────────────────────────────────────
async function populateDropdown() {
  try {
    const res = await fetch(`${API_BASE}/standings/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const teams = data.standings
      .map(t => ({
        abbrev: t.teamAbbrev.default,          // standings uses {default:string}
        name:   `${t.placeName.default} ${t.teamCommonName.default}`,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const seen = new Set();
    teams.forEach(team => {
      if (seen.has(team.abbrev)) return;
      seen.add(team.abbrev);
      const opt = document.createElement('option');
      opt.value       = team.abbrev;
      opt.textContent = team.name;
      teamSelect.appendChild(opt);
    });
  } catch (err) {
    statsContainer.innerHTML = `<p class="text-red-400">Error loading teams: ${err.message}</p>`;
  }
}

// ─── Team Roster & Player Stats ───────────────────────────────────────────────
async function fetchTeamRoster(teamAbbrev) {
  const res = await fetch(`${API_BASE}/roster/${teamAbbrev}/current`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return [...(data.forwards || []), ...(data.defensemen || []), ...(data.goalies || [])];
}

async function fetchPlayerStats(playerId) {
  const res = await fetch(`${API_BASE}/player/${playerId}/landing`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function fetchAllPlayerData(roster) {
  const results = await Promise.all(roster.map(async player => {
    try {
      const data     = await fetchPlayerStats(player.id);
      const isGoalie = player.positionCode === 'G';

      let stats = data.featuredStats?.regularSeason?.subSeason ?? null;
      if (!stats) {
        stats = (data.seasonTotals || [])
          .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
          .pop() ?? null;
      }

      return {
        name:     `${player.firstName.default} ${player.lastName.default}`,
        number:   player.sweaterNumber,
        position: player.positionCode,
        headshot: player.headshot,
        isGoalie,
        stats,
      };
    } catch { return null; }
  }));
  return results.filter(r => r?.stats);
}

function renderSkaterTable(players) {
  const skaters = players.filter(p => !p.isGoalie);
  if (!skaters.length) return '';
  skaters.sort((a, b) => (b.stats.points || 0) - (a.stats.points || 0));

  const rows = skaters.map(p => {
    const s = p.stats;
    return `<tr class="border-b border-gray-700 hover:bg-gray-700/50">
      <td class="py-2 px-3 flex items-center gap-2">
        <img src="${p.headshot}" alt="" class="w-8 h-8 rounded-full" onerror="this.style.display='none'">
        <span>#${p.number || '—'} ${p.name}</span>
      </td>
      <td class="py-2 px-3 text-center">${p.position}</td>
      <td class="py-2 px-3 text-center">${s.gamesPlayed || 0}</td>
      <td class="py-2 px-3 text-center">${s.goals || 0}</td>
      <td class="py-2 px-3 text-center">${s.assists || 0}</td>
      <td class="py-2 px-3 text-center font-semibold">${s.points || 0}</td>
      <td class="py-2 px-3 text-center">${s.plusMinus != null ? (s.plusMinus > 0 ? '+' : '') + s.plusMinus : '—'}</td>
      <td class="py-2 px-3 text-center">${s.pim || 0}</td>
      <td class="py-2 px-3 text-center">${s.shots || 0}</td>
      <td class="py-2 px-3 text-center">${s.powerPlayGoals || 0}</td>
      <td class="py-2 px-3 text-center">${s.shorthandedGoals || 0}</td>
      <td class="py-2 px-3 text-center">${s.gameWinningGoals || 0}</td>
    </tr>`;
  }).join('');

  return `
    <h3 class="text-lg font-semibold mb-2 text-gray-300">Skaters</h3>
    <div class="overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-600 text-gray-400 text-xs uppercase">
            <th class="py-2 px-3 text-left">Player</th>
            <th class="py-2 px-3 text-center">Pos</th>
            <th class="py-2 px-3 text-center">GP</th>
            <th class="py-2 px-3 text-center">G</th>
            <th class="py-2 px-3 text-center">A</th>
            <th class="py-2 px-3 text-center">PTS</th>
            <th class="py-2 px-3 text-center">+/-</th>
            <th class="py-2 px-3 text-center">PIM</th>
            <th class="py-2 px-3 text-center">SOG</th>
            <th class="py-2 px-3 text-center">PPG</th>
            <th class="py-2 px-3 text-center">SHG</th>
            <th class="py-2 px-3 text-center">GWG</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderGoalieTable(players) {
  const goalies = players.filter(p => p.isGoalie);
  if (!goalies.length) return '';
  goalies.sort((a, b) => (b.stats.wins || 0) - (a.stats.wins || 0));

  const rows = goalies.map(p => {
    const s   = p.stats;
    const svp = s.savePctg != null ? s.savePctg.toFixed(3) : '—';
    const gaa = s.goalsAgainstAvg != null ? s.goalsAgainstAvg.toFixed(2) : '—';
    return `<tr class="border-b border-gray-700 hover:bg-gray-700/50">
      <td class="py-2 px-3 flex items-center gap-2">
        <img src="${p.headshot}" alt="" class="w-8 h-8 rounded-full" onerror="this.style.display='none'">
        <span>#${p.number || '—'} ${p.name}</span>
      </td>
      <td class="py-2 px-3 text-center">${s.gamesPlayed || 0}</td>
      <td class="py-2 px-3 text-center">${s.wins || 0}</td>
      <td class="py-2 px-3 text-center">${s.losses || 0}</td>
      <td class="py-2 px-3 text-center">${s.otLosses || 0}</td>
      <td class="py-2 px-3 text-center">${svp}</td>
      <td class="py-2 px-3 text-center">${gaa}</td>
      <td class="py-2 px-3 text-center">${s.shutouts || 0}</td>
    </tr>`;
  }).join('');

  return `
    <h3 class="text-lg font-semibold mb-2 text-gray-300">Goalies</h3>
    <div class="overflow-x-auto mb-6">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b border-gray-600 text-gray-400 text-xs uppercase">
            <th class="py-2 px-3 text-left">Player</th>
            <th class="py-2 px-3 text-center">GP</th>
            <th class="py-2 px-3 text-center">W</th>
            <th class="py-2 px-3 text-center">L</th>
            <th class="py-2 px-3 text-center">OTL</th>
            <th class="py-2 px-3 text-center">SV%</th>
            <th class="py-2 px-3 text-center">GAA</th>
            <th class="py-2 px-3 text-center">SO</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

teamSelect.addEventListener('change', async () => {
  statsContainer.innerHTML = '';
  const teamAbbrev = teamSelect.value;
  if (!teamAbbrev) return;
  showLoading(loadingIndicator);
  try {
    const roster     = await fetchTeamRoster(teamAbbrev);
    const playerData = await fetchAllPlayerData(roster);
    statsContainer.innerHTML = `
      <h2 class="text-xl font-bold mb-4">${teamSelect.options[teamSelect.selectedIndex].text}</h2>
      <div class="bg-nhl-card rounded-lg p-4">
        ${renderSkaterTable(playerData)}
        ${renderGoalieTable(playerData)}
      </div>`;
  } catch (err) {
    statsContainer.innerHTML = `<p class="text-red-400">Error loading roster: ${err.message}</p>`;
  } finally {
    hideLoading(loadingIndicator);
  }
});

// ─── Standings ─────────────────────────────────────────────────────────────────
async function fetchStandings() {
  showLoading(standingsLoading);
  try {
    const res = await fetch(`${API_BASE}/standings/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const divisions = {};
    data.standings.forEach(t => {
      const d = t.divisionName;
      if (!divisions[d]) divisions[d] = [];
      divisions[d].push(t);
    });
    Object.values(divisions).forEach(arr =>
      arr.sort((a, b) => b.points - a.points || b.regulationWins - a.regulationWins)
    );

    const divOrder = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    standingsContainer.innerHTML = divOrder.map(divName => {
      const teams = divisions[divName];
      if (!teams) return '';
      const rows = teams.map((t, i) => `
        <tr class="border-b border-gray-700 hover:bg-gray-700/50">
          <td class="py-2 px-3">${i + 1}</td>
          <td class="py-2 px-3 flex items-center gap-2">
            <img src="${t.teamLogo}" alt="" class="w-6 h-6" onerror="this.style.display='none'">
            ${t.teamAbbrev.default} — ${t.placeName.default} ${t.teamCommonName.default}
          </td>
          <td class="py-2 px-3 text-center">${t.gamesPlayed}</td>
          <td class="py-2 px-3 text-center">${t.wins}</td>
          <td class="py-2 px-3 text-center">${t.losses}</td>
          <td class="py-2 px-3 text-center">${t.otLosses}</td>
          <td class="py-2 px-3 text-center font-semibold">${t.points}</td>
          <td class="py-2 px-3 text-center">${t.goalFor}</td>
          <td class="py-2 px-3 text-center">${t.goalAgainst}</td>
          <td class="py-2 px-3 text-center">${t.goalDifferential > 0 ? '+' : ''}${t.goalDifferential}</td>
          <td class="py-2 px-3 text-center">${t.streakCode}${t.streakCount}</td>
        </tr>`).join('');

      return `
        <div class="mb-6">
          <h3 class="text-lg font-semibold mb-2 text-gray-300">${divName} Division</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm bg-nhl-card rounded-lg">
              <thead>
                <tr class="border-b border-gray-600 text-gray-400 text-xs uppercase">
                  <th class="py-2 px-3 text-left">#</th>
                  <th class="py-2 px-3 text-left">Team</th>
                  <th class="py-2 px-3 text-center">GP</th>
                  <th class="py-2 px-3 text-center">W</th>
                  <th class="py-2 px-3 text-center">L</th>
                  <th class="py-2 px-3 text-center">OTL</th>
                  <th class="py-2 px-3 text-center">PTS</th>
                  <th class="py-2 px-3 text-center">GF</th>
                  <th class="py-2 px-3 text-center">GA</th>
                  <th class="py-2 px-3 text-center">DIFF</th>
                  <th class="py-2 px-3 text-center">STRK</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
  } catch (err) {
    standingsContainer.innerHTML = `<p class="text-red-400">Error loading standings: ${err.message}</p>`;
  } finally {
    hideLoading(standingsLoading);
  }
}

// ─── Standings Map (for predictions) ──────────────────────────────────────────
// Returns { "EDM": { points, gamesPlayed, goalFor, goalAgainst, streakCode, streakCount, ... }, ... }
async function fetchStandingsMap() {
  const res = await fetch(`${API_BASE}/standings/now`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const map = {};
  (data.standings || []).forEach(t => {
    map[t.teamAbbrev.default] = t;
  });
  return map;
}

// ─── Game Prediction Model ─────────────────────────────────────────────────────
/**
 * Predict game outcome using a simple two-factor model:
 *   60% points-percentage  (wins vs possible points)
 *   40% goal-differential per game  (offensive/defensive dominance)
 * Home-ice advantage: home team gets a +5% strength multiplier.
 *
 * Returns { pick, confidence, homeWinPct } or null if data unavailable.
 */
function predictGame(homeAbbrev, awayAbbrev, standingsMap) {
  const home = standingsMap[homeAbbrev];
  const away = standingsMap[awayAbbrev];
  if (!home || !away) return null;

  const teamScore = t => {
    const ptsPct  = t.points / Math.max(t.gamesPlayed * 2, 1);
    const gdPerGP = (t.goalFor - t.goalAgainst) / Math.max(t.gamesPlayed, 1);
    // Normalize GD: typical range is roughly -2 to +2 per game → map to 0–1
    const gdNorm  = Math.min(1, Math.max(0, (gdPerGP + 2) / 4));
    return ptsPct * 0.60 + gdNorm * 0.40;
  };

  const homeScore = teamScore(home) * 1.05; // home-ice advantage
  const awayScore = teamScore(away);
  const total     = homeScore + awayScore;
  const homeWinPct = homeScore / total;

  const pick       = homeWinPct >= 0.5 ? homeAbbrev : awayAbbrev;
  const confidence = Math.round(Math.max(homeWinPct, 1 - homeWinPct) * 100);

  // Streak bonus text
  const pickTeam    = pick === homeAbbrev ? home : away;
  const streakLabel = pickTeam.streakCode === 'W'
    ? `W${pickTeam.streakCount} streak`
    : pickTeam.streakCode === 'L'
      ? `L${pickTeam.streakCount} streak`
      : '';

  return { pick, confidence, homeWinPct: Math.round(homeWinPct * 100), streakLabel };
}

// ─── Today's Scores + Predictions ─────────────────────────────────────────────
async function fetchScores() {
  showLoading(scoresLoading);
  try {
    // /schedule/now returns gameWeek[{date, games:[...]}]
    // Fetch games and standings in parallel; standings failure is non-fatal.
    const [schedRes, standingsMap] = await Promise.all([
      fetch(`${API_BASE}/schedule/now`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetchStandingsMap().catch(() => ({})),
    ]);

    // Flatten today's games from the gameWeek structure
    const todayBlock = schedRes.gameWeek?.[0] ?? {};
    const games      = todayBlock.games ?? [];
    const displayDate = todayBlock.date ?? 'Today';

    if (!games.length) {
      scoresContainer.innerHTML = `<p class="text-gray-400">No games scheduled for today.</p>`;
      return;
    }

    // Render each game card; wrap individually so one bad record can't blank the tab.
    const cards = games.map(game => {
      try {
        const away  = game.awayTeam ?? {};
        const home  = game.homeTeam ?? {};
        const state = game.gameState ?? 'FUT';

        // /schedule/now does not include logo URLs — reconstruct from abbreviation.
        // NHL logo CDN pattern: https://assets.nhle.com/logos/nhl/svg/{ABBREV}_light.svg
        const awayLogo = `https://assets.nhle.com/logos/nhl/svg/${away.abbrev}_light.svg`;
        const homeLogo = `https://assets.nhle.com/logos/nhl/svg/${home.abbrev}_light.svg`;

        let statusText  = '';
        let statusClass = 'text-gray-400';

        if (state === 'FUT' || state === 'PRE') {
          statusText = new Date(game.startTimeUTC).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } else if (state === 'LIVE' || state === 'CRIT') {
          const period = game.periodDescriptor?.number ? `P${game.periodDescriptor.number}` : '';
          const clock  = game.clock?.timeRemaining ?? '';
          statusText   = `${period} ${clock}`.trim();
          statusClass  = 'text-green-400 font-semibold animate-pulse';
        } else if (state === 'OFF') {
          const ot     = game.gameOutcome?.lastPeriodType;
          statusText   = ot && ot !== 'REG' ? `Final/${ot}` : 'Final';
        }

        // Prediction badge — only for not-yet-started games; silently skip if data missing.
        let predBadge = '';
        if ((state === 'FUT' || state === 'PRE') && home.abbrev && away.abbrev) {
          const pred = predictGame(home.abbrev, away.abbrev, standingsMap);
          if (pred) {
            predBadge = `
              <div class="mt-3 pt-3 border-t border-gray-700">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500 uppercase tracking-wide">Prediction</span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold ${pred.pick === home.abbrev ? 'text-blue-300' : 'text-orange-300'}">
                      ${pred.pick}
                    </span>
                    <div class="flex items-center gap-1">
                      <div class="h-1.5 rounded-full bg-gray-700 w-16 overflow-hidden">
                        <div class="h-full rounded-full ${pred.pick === home.abbrev ? 'bg-blue-500' : 'bg-orange-400'}"
                             style="width:${pred.confidence}%"></div>
                      </div>
                      <span class="text-xs text-gray-400">${pred.confidence}%</span>
                    </div>
                  </div>
                </div>
                ${pred.streakLabel ? `<div class="text-xs text-gray-600 text-right mt-0.5">${pred.streakLabel}</div>` : ''}
                <div class="flex justify-between text-xs text-gray-600 mt-1">
                  <span>${away.abbrev} ${100 - pred.homeWinPct}%</span>
                  <span class="text-gray-500">Home ice incl.</span>
                  <span>${home.abbrev} ${pred.homeWinPct}%</span>
                </div>
              </div>`;
          }
        }

        const showScore = state !== 'FUT' && state !== 'PRE';

        return `
          <div class="bg-nhl-card rounded-lg p-4 flex flex-col gap-3 border border-gray-700/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 flex-1">
                <img src="${awayLogo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
                <span class="font-medium">${away.abbrev ?? '—'}</span>
              </div>
              <span class="text-2xl font-bold w-8 text-center tabular-nums">${showScore ? (away.score ?? 0) : ''}</span>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 flex-1">
                <img src="${homeLogo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
                <span class="font-medium">${home.abbrev ?? '—'} <span class="text-xs text-gray-500">HOME</span></span>
              </div>
              <span class="text-2xl font-bold w-8 text-center tabular-nums">${showScore ? (home.score ?? 0) : ''}</span>
            </div>
            <div class="text-center text-sm ${statusClass}">${statusText}</div>
            ${predBadge}
          </div>`;
      } catch (cardErr) {
        // One malformed game record should never take down the whole tab.
        console.warn('Error rendering game card:', cardErr);
        return '';
      }
    }).join('');

    scoresContainer.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">Games — ${displayDate}</h2>
        <span class="text-xs text-gray-500">Predictions for scheduled games</span>
      </div>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${cards}</div>`;
  } catch (err) {
    scoresContainer.innerHTML = `<p class="text-red-400">Error loading scores: ${err.message}</p>`;
  } finally {
    hideLoading(scoresLoading);
  }
}

// ─── Top Scorers — Data Fetching ───────────────────────────────────────────────
/**
 * Merge the three category responses into one unified player list.
 *
 * IMPORTANT — API field shapes from skater-stats-leaders:
 *   teamAbbrev  → plain string "EDM"   (NOT an object — different from standings!)
 *   firstName   → { default: "Connor" }
 *   lastName    → { default: "McDavid" }
 *   position    → plain string "C"
 *   value       → the stat value (points / goals / assists depending on endpoint)
 *   birthCountry → NOT present in this endpoint (fetched from player landing)
 */
function mergeLeadersData(pointsData, goalsData, assistsData) {
  const map = {};

  // Points list drives ranking; overlay goals/assists from their respective lists
  (pointsData.points || []).forEach((p, i) => {
    map[p.id] = {
      ...p,
      rank:    i + 1,
      points:  p.value || 0,
      goals:   0,
      assists: 0,
    };
  });
  (goalsData.goals     || []).forEach(p => { if (map[p.id]) map[p.id].goals   = p.value || 0; });
  (assistsData.assists || []).forEach(p => { if (map[p.id]) map[p.id].assists = p.value || 0; });

  return Object.values(map).sort((a, b) => a.rank - b.rank);
}

async function fetchScoringLeaders(displayLimit = 50) {
  // Use /current — avoids hardcoding a season+gametype that can 404.
  // limit=50 is the max the NHL API accepts for this endpoint.
  const fetchLimit = 50;

  // 1 — Try daily-cached JSON files first (committed by GitHub Actions cron)
  try {
    const metaRes = await fetch('./data/meta.json');
    if (metaRes.ok) {
      const [ptRes, gRes, aRes] = await Promise.all([
        fetch('./data/leaders-points.json'),
        fetch('./data/leaders-goals.json'),
        fetch('./data/leaders-assists.json'),
      ]);
      if (ptRes.ok) {
        const [ptData, gData, aData] = await Promise.all([ptRes.json(), gRes.json(), aRes.json()]);
        const meta = await metaRes.json();
        const el   = document.getElementById('cache-status');
        if (el && meta.cachedAt) el.textContent = `Cached ${new Date(meta.cachedAt).toLocaleString()}`;
        return mergeLeadersData(ptData, gData, aData).slice(0, displayLimit);
      }
    }
  } catch (_) { /* cache miss — fall through to live */ }

  // 2 — Live fetch via /api/nhl proxy (never hits nhle.com directly from browser)
  const [ptRes, gRes, aRes] = await Promise.all([
    fetch(`${API_BASE}/skater-stats-leaders/current?categories=points&limit=${fetchLimit}`),
    fetch(`${API_BASE}/skater-stats-leaders/current?categories=goals&limit=${fetchLimit}`),
    fetch(`${API_BASE}/skater-stats-leaders/current?categories=assists&limit=${fetchLimit}`),
  ]);

  if (!ptRes.ok) throw new Error(`NHL API returned HTTP ${ptRes.status} for scoring leaders`);

  const [ptData, gData, aData] = await Promise.all([ptRes.json(), gRes.json(), aRes.json()]);
  return mergeLeadersData(ptData, gData, aData).slice(0, displayLimit);
}

// ─── Top Scorers — Rendering ───────────────────────────────────────────────────
function renderScoringLeaders(leaders) {
  if (!leaders.length) {
    return '<p class="text-gray-400">No scoring leaders data available.</p>';
  }

  const rankColors = ['text-yellow-400', 'text-gray-300', 'text-amber-500'];

  const rows = leaders.map((p, idx) => {
    // teamAbbrev from the leaders API is a PLAIN STRING, not an object.
    const teamAbbrev = p.teamAbbrev || '—';
    const name       = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
    const rankClass  = rankColors[p.rank - 1] || 'text-gray-500';

    return `
      <tr class="border-b border-gray-700/50 hover:bg-blue-500/10 cursor-pointer transition-colors scoring-leader-row"
          data-player-idx="${idx}" title="Click for player profile &amp; props">
        <td class="py-3 px-4 font-bold font-mono ${rankClass} text-center w-10">${p.rank}</td>
        <td class="py-3 px-4">
          <div class="flex items-center gap-3">
            <img src="${p.headshot || ''}" alt=""
                 class="w-10 h-10 rounded-full bg-gray-700 object-cover flex-shrink-0"
                 onerror="this.style.display='none'">
            <div class="min-w-0">
              <div class="font-semibold text-white leading-tight truncate">${name}</div>
              <div class="text-xs text-gray-400 mt-0.5">${teamAbbrev}${p.position ? ' &middot; ' + p.position : ''}</div>
            </div>
          </div>
        </td>
        <td class="py-3 px-4 text-center text-blue-400 font-bold text-lg tabular-nums">${p.points}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${p.goals}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${p.assists}</td>
      </tr>`;
  }).join('');

  return `
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <h2 class="text-xl font-bold">League Scoring Leaders</h2>
      <p class="text-xs text-gray-500">Click a player for profile &amp; prop predictions</p>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm bg-nhl-card rounded-xl border border-gray-700/50">
        <thead>
          <tr class="border-b border-gray-600 text-gray-400 text-xs uppercase">
            <th class="py-3 px-4 text-center w-10">#</th>
            <th class="py-3 px-4 text-left">Player</th>
            <th class="py-3 px-4 text-center">PTS</th>
            <th class="py-3 px-4 text-center">G</th>
            <th class="py-3 px-4 text-center">A</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

async function fetchAndRenderTopScorers() {
  showLoading(topScorersLoading);
  try {
    const leaders    = await fetchScoringLeaders(50);
    _leadersCache    = leaders;
    topScorersContainer.innerHTML = renderScoringLeaders(leaders);

    // Wire up row click → modal
    topScorersContainer.querySelectorAll('.scoring-leader-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.playerIdx, 10);
        if (!isNaN(idx) && _leadersCache?.[idx]) openPlayerModal(_leadersCache[idx]);
      });
    });
  } catch (err) {
    topScorersContainer.innerHTML = `<p class="text-red-400">Error loading top scorers: ${err.message}</p>`;
  } finally {
    hideLoading(topScorersLoading);
  }
}

// ─── Player Game Log ───────────────────────────────────────────────────────────
async function fetchPlayerGameLog(playerId) {
  const season = getCurrentSeason();
  try {
    const res = await fetch(`${API_BASE}/player/${playerId}/game-log/${season}/2`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return (data.gameLog || []).slice(0, 20); // most-recent first
  } catch (err) {
    console.warn('fetchPlayerGameLog:', err.message);
    return [];
  }
}

// ─── Next Scheduled Game ───────────────────────────────────────────────────────
async function fetchNextGame(teamAbbrev) {
  try {
    const res = await fetch(`${API_BASE}/club-schedule/${teamAbbrev}/week/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const now  = new Date();
    return (data.games || []).find(g => new Date(g.startTimeUTC) > now) ?? null;
  } catch (err) {
    console.warn('fetchNextGame:', err.message);
    return null;
  }
}

// ─── Prop Prediction Algorithm ────────────────────────────────────────────────
/**
 * Three-factor model:
 *   40% season per-game average (or 70% if < 3 recent games available)
 *   60% recent form — last 5 games with exponential weights [35,25,20,12,8]%
 *   ±30% head-to-head multiplier vs next opponent (if ≥ 2 historical games exist)
 */
function calculateProps(seasonStats, gameLog, nextOpponentAbbrev) {
  const gp = seasonStats.gamesPlayed || 1;

  const seasonPPG = {
    goals:   (seasonStats.goals   || 0) / gp,
    assists: (seasonStats.assists || 0) / gp,
    points:  (seasonStats.points  || 0) / gp,
    shots:   (seasonStats.shots   || 0) / gp,
  };

  const WEIGHTS = [0.35, 0.25, 0.20, 0.12, 0.08];
  const recent5 = gameLog.slice(0, 5);
  const recentW = { goals: 0, assists: 0, points: 0, shots: 0 };

  recent5.forEach((g, i) => {
    const w = WEIGHTS[i] || 0;
    recentW.goals   += (g.goals   || 0) * w;
    recentW.assists += (g.assists || 0) * w;
    recentW.points  += ((g.goals || 0) + (g.assists || 0)) * w;
    recentW.shots   += (g.shots   || g.shotsOnGoal || 0) * w;
  });

  // H2H — filter historical game log for games against next opponent
  let h2hGames = [];
  const h2hMult = { goals: 1, assists: 1, points: 1, shots: 1 };

  if (nextOpponentAbbrev) {
    h2hGames = gameLog.filter(g => g.opponentAbbrev === nextOpponentAbbrev);
    if (h2hGames.length >= 2) {
      const avg   = (arr, fn) => arr.reduce((s, g) => s + fn(g), 0) / arr.length;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
      const h2hG   = avg(h2hGames, g => g.goals   || 0);
      const h2hA   = avg(h2hGames, g => g.assists || 0);
      const h2hSOG = avg(h2hGames, g => g.shots   || g.shotsOnGoal || 0);

      h2hMult.goals   = seasonPPG.goals   > 0 ? clamp(0.7 + 0.3 * (h2hG   / seasonPPG.goals),   0.75, 1.30) : 1;
      h2hMult.assists = seasonPPG.assists > 0 ? clamp(0.7 + 0.3 * (h2hA   / seasonPPG.assists), 0.75, 1.30) : 1;
      h2hMult.shots   = seasonPPG.shots   > 0 ? clamp(0.7 + 0.3 * (h2hSOG / seasonPPG.shots),   0.75, 1.30) : 1;
      h2hMult.points  = (h2hMult.goals + h2hMult.assists) / 2;
    }
  }

  const SW = recent5.length >= 3 ? 0.40 : 0.70;
  const RW = 1 - SW;

  const LABELS = { goals: 'Goals', assists: 'Assists', points: 'Points', shots: 'Shots on Goal' };
  const props  = {};

  Object.keys(LABELS).forEach(stat => {
    const projected = ((seasonPPG[stat] * SW) + (recentW[stat] * RW)) * h2hMult[stat];

    let line = Math.round(seasonPPG[stat] * 2) / 2;
    if (line <= 0 && projected > 0) line = 0.5;

    // Confidence — based on projection/line gap and recent consistency
    const vals   = recent5.map(g => stat === 'points' ? (g.goals || 0) + (g.assists || 0)
                                    : stat === 'shots'  ? (g.shots || g.shotsOnGoal || 0)
                                    : (g[stat] || 0));
    const mean   = vals.reduce((s, v) => s + v, 0) / Math.max(vals.length, 1);
    const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(vals.length, 1));
    const relGap = line > 0 ? Math.abs(projected - line) / line : Math.abs(projected - line);
    let conf = relGap >= 0.40 ? 82 : relGap >= 0.25 ? 70 : relGap >= 0.10 ? 58 : 51;
    if (stdDev < 0.80) conf = Math.min(92, conf + 8);
    else if (stdDev > 2)  conf = Math.max(42, conf - 10);

    props[stat] = {
      label:      LABELS[stat],
      line,
      projected:  Math.round(projected * 100) / 100,
      direction:  projected >= line ? 'OVER' : 'UNDER',
      confidence: Math.round(conf),
      h2hGames,
    };
  });

  return props;
}

// ─── Player Modal ──────────────────────────────────────────────────────────────
async function openPlayerModal(playerData) {
  modalTitle.innerHTML   = renderModalHeader(playerData);
  modalContent.innerHTML = `<div class="flex justify-center py-12">${SPINNER_SVG}</div>`;
  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const teamAbbrev = playerData.teamAbbrev; // plain string from leaders API

    const [gameLog, nextGame, landing] = await Promise.all([
      fetchPlayerGameLog(playerData.id),
      fetchNextGame(teamAbbrev),
      fetchPlayerStats(playerData.id),
    ]);

    // birthCountry lives in the player landing, not the leaders endpoint
    if (!playerData.birthCountry && landing.birthCountry) {
      playerData = { ...playerData, birthCountry: landing.birthCountry };
      modalTitle.innerHTML = renderModalHeader(playerData);
    }

    // Season stats from landing
    let seasonStats = landing.featuredStats?.regularSeason?.subSeason ?? null;
    if (!seasonStats) {
      seasonStats = (landing.seasonTotals || [])
        .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
        .pop() ?? {};
    }

    const nextOpponent = nextGame
      ? (nextGame.homeTeam?.abbrev === teamAbbrev ? nextGame.awayTeam?.abbrev : nextGame.homeTeam?.abbrev)
      : null;

    const props = calculateProps(seasonStats, gameLog, nextOpponent);
    modalContent.innerHTML = renderModalBody(playerData, gameLog, nextGame, props, nextOpponent, seasonStats);

  } catch (err) {
    modalContent.innerHTML = `<p class="text-red-400 p-4">Error loading player data: ${err.message}</p>`;
  }
}

function renderModalHeader(player) {
  const flag       = getFlag(player.birthCountry);
  const teamAbbrev = player.teamAbbrev || '';    // plain string
  const name       = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();

  return `
    <div class="flex items-center gap-4 min-w-0">
      <img src="${player.headshot || ''}" alt=""
           class="w-14 h-14 rounded-full border-2 border-gray-600 object-cover bg-gray-700 flex-shrink-0"
           onerror="this.style.display='none'">
      <div class="min-w-0">
        <div class="font-bold text-white text-lg leading-tight">
          ${name} <span class="text-2xl align-middle">${flag}</span>
        </div>
        <div class="text-sm text-gray-400 mt-0.5">
          ${teamAbbrev}${player.position ? ' &middot; ' + player.position : ''}
        </div>
      </div>
    </div>`;
}

function renderModalBody(player, gameLog, nextGame, props, nextOpponent, seasonStats) {
  const gp = seasonStats.gamesPlayed || 0;

  // Season summary
  const seasonSummaryHTML = gp ? `
    <div class="grid grid-cols-4 gap-2 mb-5">
      ${[['GP', gp], ['G', seasonStats.goals || 0], ['A', seasonStats.assists || 0], ['PTS', seasonStats.points || 0]]
        .map(([label, val]) => `
          <div class="bg-gray-900 rounded-lg p-2 text-center border border-gray-700/40">
            <div class="text-xl font-bold text-white tabular-nums">${val}</div>
            <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
          </div>`).join('')}
    </div>` : '';

  // Next game banner
  const nextGameHTML = nextGame ? (() => {
    const dateStr = new Date(nextGame.startTimeUTC).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
    return `
      <div class="mb-5 p-3 bg-gray-900/80 rounded-lg border border-gray-700/50 flex flex-wrap items-center gap-3">
        <span class="text-xs text-blue-400 font-semibold uppercase tracking-wide">Next Game</span>
        <div class="flex items-center gap-2 ml-auto">
          <img src="${nextGame.awayTeam?.logo || ''}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="font-medium text-sm">${nextGame.awayTeam?.abbrev ?? ''} @ ${nextGame.homeTeam?.abbrev ?? ''}</span>
          <img src="${nextGame.homeTeam?.logo || ''}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="text-xs text-gray-400 ml-1">${dateStr}</span>
        </div>
      </div>`;
  })() : '';

  // Prop prediction cards
  const propsHTML = `
    <div class="mb-5">
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide">Prop Predictions</h3>
        ${nextOpponent ? `<span class="text-xs bg-blue-500/20 text-blue-300 rounded px-1.5 py-0.5 border border-blue-500/30">vs ${nextOpponent}</span>` : ''}
        <span class="ml-auto text-xs text-gray-600 italic">For entertainment only</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${Object.values(props).map(p => {
          const isOver    = p.direction === 'OVER';
          const dirClass  = isOver ? 'text-green-400' : 'text-red-400';
          const borderCls = isOver ? 'border-green-500/25' : 'border-red-500/25';
          const barColor  = p.confidence >= 75 ? 'bg-green-500' : p.confidence >= 60 ? 'bg-yellow-500' : 'bg-gray-500';
          return `
            <div class="bg-gray-900 rounded-lg p-3 border ${borderCls}">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs text-gray-400 font-semibold uppercase tracking-wide">${p.label}</span>
                <span class="text-xs font-bold ${dirClass}">${p.direction}</span>
              </div>
              <div class="flex justify-between items-end mb-2.5">
                <span class="text-2xl font-bold text-white tabular-nums">${p.line}</span>
                <span class="text-xs text-gray-500">Proj: <span class="${dirClass} font-semibold">${p.projected}</span></span>
              </div>
              <div class="flex justify-between text-xs text-gray-600 mb-1">
                <span>Confidence</span><span>${p.confidence}%</span>
              </div>
              <div class="w-full bg-gray-700 rounded-full h-1.5">
                <div class="${barColor} rounded-full h-1.5 confidence-bar" style="width:${p.confidence}%"></div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;

  // H2H stats
  const h2hGames  = props.goals?.h2hGames || [];
  const h2hHTML   = nextOpponent && h2hGames.length >= 2 ? `
    <div class="mb-5">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
        H2H vs ${nextOpponent} <span class="text-gray-600 font-normal normal-case">(${h2hGames.length} games in log)</span>
      </h3>
      <div class="grid grid-cols-3 gap-2">
        ${[
          ['Goals/gm',  (h2hGames.reduce((s, g) => s + (g.goals   || 0), 0) / h2hGames.length).toFixed(1)],
          ['Assists/gm', (h2hGames.reduce((s, g) => s + (g.assists || 0), 0) / h2hGames.length).toFixed(1)],
          ['PTS/gm',    (h2hGames.reduce((s, g) => s + (g.goals || 0) + (g.assists || 0), 0) / h2hGames.length).toFixed(1)],
        ].map(([label, val]) => `
          <div class="bg-gray-900 rounded-lg p-2 text-center border border-gray-700/40">
            <div class="text-lg font-bold text-blue-400 tabular-nums">${val}</div>
            <div class="text-xs text-gray-500">${label}</div>
          </div>`).join('')}
      </div>
    </div>` : '';

  // Recent form table
  const recent5    = gameLog.slice(0, 5);
  const recentHTML = recent5.length ? `
    <div>
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
        Recent Form <span class="text-gray-600 font-normal normal-case">(last ${recent5.length} games)</span>
      </h3>
      <div class="overflow-x-auto rounded-lg border border-gray-700/50">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-900 text-gray-500 text-xs uppercase border-b border-gray-700">
              <th class="py-2 px-3 text-left">Date</th>
              <th class="py-2 px-3 text-center">Opp</th>
              <th class="py-2 px-3 text-center">G</th>
              <th class="py-2 px-3 text-center">A</th>
              <th class="py-2 px-3 text-center">PTS</th>
              <th class="py-2 px-3 text-center">SOG</th>
            </tr>
          </thead>
          <tbody>
            ${recent5.map(g => {
              const pts      = (g.goals || 0) + (g.assists || 0);
              const isHome   = g.homeRoadFlag === 'H';
              const ptsClass = pts > 1 ? 'text-blue-400 font-bold' : pts === 1 ? 'text-blue-300 font-semibold' : 'text-gray-500';
              return `
                <tr class="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td class="py-2 px-3 text-gray-400 text-xs whitespace-nowrap">${g.gameDate || '—'}</td>
                  <td class="py-2 px-3 text-center text-xs">${isHome ? 'vs' : '@'}&nbsp;${g.opponentAbbrev || '—'}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${g.goals   || 0}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${g.assists || 0}</td>
                  <td class="py-2 px-3 text-center tabular-nums ${ptsClass}">${pts}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${g.shots || g.shotsOnGoal || 0}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '<p class="text-gray-500 text-sm">No recent game data available.</p>';

  return seasonSummaryHTML + nextGameHTML + propsHTML + h2hHTML + recentHTML;
}

// ─── Modal Controls ────────────────────────────────────────────────────────────
function closeModal() {
  playerModal.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── Init ──────────────────────────────────────────────────────────────────────
populateDropdown();
