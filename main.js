// ─── Constants & DOM References ────────────────────────────────────────────────
// All NHL API calls go through Vercel's server-side proxy (/nhl-api/* → api-web.nhle.com/v1/*)
// This avoids CORS issues — api-web.nhle.com blocks direct browser requests from localhost.
const API_BASE = '/nhl-api';

const teamSelect        = document.getElementById('team-select');
const statsContainer    = document.getElementById('stats-container');
const loadingIndicator  = document.getElementById('loading-indicator');
const standingsContainer = document.getElementById('standings-container');
const standingsLoading  = document.getElementById('standings-loading');
const scoresContainer   = document.getElementById('scores-container');
const scoresLoading     = document.getElementById('scores-loading');
const topScorersContainer = document.getElementById('top-scorers-container');
const topScorersLoading = document.getElementById('top-scorers-loading');
const playerModal       = document.getElementById('player-modal');
const modalTitle        = document.getElementById('modal-title');
const modalContent      = document.getElementById('modal-content');

// Cache so rows can access the leaders array by index on click
let _leadersCache = null;

// ─── Country Flags Map ─────────────────────────────────────────────────────────
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

// ─── Tab Switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');

    if (btn.dataset.tab === 'standings' && !standingsContainer.innerHTML) fetchStandings();
    if (btn.dataset.tab === 'scores' && !scoresContainer.innerHTML) fetchScores();
    if (btn.dataset.tab === 'top-scorers' && !topScorersContainer.innerHTML) fetchAndRenderTopScorers();
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showLoading(el) { el.classList.remove('hidden'); }
function hideLoading(el) { el.classList.add('hidden'); }

function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startYear = month >= 10 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

function getFlag(countryCode) {
  return COUNTRY_FLAGS[countryCode] || '';
}

const SPINNER_SVG = `<svg class="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" fill="none"/>
  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
</svg>`;

// ─── Team Dropdown ─────────────────────────────────────────────────────────────
async function populateDropdown() {
  try {
    const res = await fetch(`${API_BASE}/standings/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const teams = data.standings
      .map(t => ({
        abbrev: t.teamAbbrev.default,
        name: `${t.placeName.default} ${t.teamCommonName.default}`
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const seen = new Set();
    teams.forEach(team => {
      if (seen.has(team.abbrev)) return;
      seen.add(team.abbrev);
      const option = document.createElement('option');
      option.value = team.abbrev;
      option.textContent = team.name;
      teamSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching teams:', error);
    statsContainer.innerHTML = `<p class="text-red-400">Error loading teams: ${error.message}</p>`;
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
  const results = await Promise.all(
    roster.map(async player => {
      try {
        const data = await fetchPlayerStats(player.id);
        const isGoalie = player.positionCode === 'G';

        let stats = null;
        if (data.featuredStats && data.featuredStats.regularSeason) {
          stats = data.featuredStats.regularSeason.subSeason;
        }
        if (!stats) {
          const seasonEntry = (data.seasonTotals || [])
            .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
            .pop();
          stats = seasonEntry || null;
        }

        return {
          name: `${player.firstName.default} ${player.lastName.default}`,
          number: player.sweaterNumber,
          position: player.positionCode,
          headshot: player.headshot,
          isGoalie,
          stats
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(r => r && r.stats);
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
    const s = p.stats;
    const svPct = s.savePctg != null ? s.savePctg.toFixed(3) : '—';
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
      <td class="py-2 px-3 text-center">${svPct}</td>
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
    const roster = await fetchTeamRoster(teamAbbrev);
    const playerData = await fetchAllPlayerData(roster);

    statsContainer.innerHTML = `
      <h2 class="text-xl font-bold mb-4">${teamSelect.options[teamSelect.selectedIndex].text}</h2>
      <div class="bg-nhl-card rounded-lg p-4">
        ${renderSkaterTable(playerData)}
        ${renderGoalieTable(playerData)}
      </div>`;
  } catch (error) {
    statsContainer.innerHTML = `<p class="text-red-400">Error loading roster: ${error.message}</p>`;
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
    data.standings.forEach(team => {
      const div = team.divisionName;
      if (!divisions[div]) divisions[div] = [];
      divisions[div].push(team);
    });

    Object.values(divisions).forEach(teams => {
      teams.sort((a, b) => b.points - a.points || b.regulationWins - a.regulationWins);
    });

    const divisionOrder = ['Atlantic', 'Metropolitan', 'Central', 'Pacific'];
    const html = divisionOrder.map(divName => {
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

    standingsContainer.innerHTML = html;
  } catch (error) {
    standingsContainer.innerHTML = `<p class="text-red-400">Error loading standings: ${error.message}</p>`;
  } finally {
    hideLoading(standingsLoading);
  }
}

// ─── Today's Scores ────────────────────────────────────────────────────────────
async function fetchScores() {
  showLoading(scoresLoading);

  try {
    const res = await fetch(`${API_BASE}/score/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (!data.games || data.games.length === 0) {
      scoresContainer.innerHTML = `<p class="text-gray-400">No games scheduled for today.</p>`;
      return;
    }

    const html = data.games.map(game => {
      const away = game.awayTeam;
      const home = game.homeTeam;
      const state = game.gameState;

      let statusText = '';
      let statusClass = 'text-gray-400';
      if (state === 'FUT') {
        const time = new Date(game.startTimeUTC).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        statusText = time;
      } else if (state === 'LIVE' || state === 'CRIT') {
        const period = game.periodDescriptor ? `P${game.periodDescriptor.number}` : '';
        const clock = game.clock ? game.clock.timeRemaining : '';
        statusText = `${period} ${clock}`;
        statusClass = 'text-green-400 font-semibold';
      } else if (state === 'OFF') {
        let suffix = 'Final';
        if (game.gameOutcome && game.gameOutcome.lastPeriodType !== 'REG') {
          suffix = `Final/${game.gameOutcome.lastPeriodType}`;
        }
        statusText = suffix;
      }

      return `
        <div class="bg-nhl-card rounded-lg p-4 flex flex-col gap-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 flex-1">
              <img src="${away.logo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
              <span class="font-medium">${away.abbrev}</span>
            </div>
            <span class="text-2xl font-bold w-8 text-center">${state !== 'FUT' ? (away.score ?? 0) : ''}</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3 flex-1">
              <img src="${home.logo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
              <span class="font-medium">${home.abbrev}</span>
            </div>
            <span class="text-2xl font-bold w-8 text-center">${state !== 'FUT' ? (home.score ?? 0) : ''}</span>
          </div>
          <div class="text-center text-sm ${statusClass}">${statusText}</div>
        </div>`;
    }).join('');

    scoresContainer.innerHTML = `
      <h2 class="text-xl font-bold mb-4">Games — ${data.currentDate || 'Today'}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">${html}</div>`;
  } catch (error) {
    scoresContainer.innerHTML = `<p class="text-red-400">Error loading scores: ${error.message}</p>`;
  } finally {
    hideLoading(scoresLoading);
  }
}

// ─── Scoring Leaders ───────────────────────────────────────────────────────────

/**
 * Merge points/goals/assists leader arrays into one unified list.
 * The points list drives rank order; goals and assists values are overlaid by player ID.
 */
function mergeLeadersData(pointsData, goalsData, assistsData) {
  const map = {};

  (pointsData.points || []).forEach((p, i) => {
    map[p.id] = { ...p, rank: i + 1, points: p.value || 0, goals: 0, assists: 0 };
  });
  (goalsData.goals || []).forEach(p => { if (map[p.id]) map[p.id].goals = p.value || 0; });
  (assistsData.assists || []).forEach(p => { if (map[p.id]) map[p.id].assists = p.value || 0; });

  return Object.values(map).sort((a, b) => a.rank - b.rank);
}

async function fetchScoringLeaders(limit = 25) {
  const season = getCurrentSeason();

  // 1. Try the daily-cached JSON files first (populated by GH Actions cron)
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
        // Show cache timestamp
        const cacheStatus = document.getElementById('cache-status');
        if (cacheStatus && meta.cachedAt) {
          cacheStatus.textContent = `Data cached: ${new Date(meta.cachedAt).toLocaleString()}`;
        }
        return mergeLeadersData(ptData, gData, aData);
      }
    }
  } catch (_) { /* cache miss — fall through to live fetch */ }

  // 2. Live fetch from NHL API (via Vercel proxy — no CORS issues)
  const [ptRes, gRes, aRes] = await Promise.all([
    fetch(`${API_BASE}/skater-stats-leaders/${season}/2?categories=points&limit=${limit}`),
    fetch(`${API_BASE}/skater-stats-leaders/${season}/2?categories=goals&limit=${limit}`),
    fetch(`${API_BASE}/skater-stats-leaders/${season}/2?categories=assists&limit=${limit}`),
  ]);
  if (!ptRes.ok) throw new Error(`NHL API returned HTTP ${ptRes.status} for scoring leaders (season ${season})`);
  const [ptData, gData, aData] = await Promise.all([ptRes.json(), gRes.json(), aRes.json()]);
  return mergeLeadersData(ptData, gData, aData);
}

function renderScoringLeaders(leaders) {
  if (!leaders.length) {
    return '<p class="text-gray-400">No scoring leaders data available. The season may not have started yet.</p>';
  }

  const rankColors = ['text-yellow-400', 'text-gray-300', 'text-amber-500'];

  const rows = leaders.map((p, idx) => {
    const flag = getFlag(p.birthCountry);
    const teamAbbrev = p.teamAbbrev?.default || '—';
    const name = `${p.firstName?.default || ''} ${p.lastName?.default || ''}`.trim();
    const rankClass = rankColors[p.rank - 1] || 'text-gray-500';

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
        <td class="py-3 px-4 text-center text-xl hidden sm:table-cell">${flag}</td>
        <td class="py-3 px-4 text-center text-blue-400 font-bold text-lg tabular-nums">${p.points}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${p.goals}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${p.assists}</td>
      </tr>`;
  }).join('');

  return `
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
      <h2 class="text-xl font-bold">League Scoring Leaders</h2>
      <p class="text-xs text-gray-500">Click any player to view props &amp; predictions</p>
    </div>
    <div class="overflow-x-auto">
      <table class="w-full text-sm bg-nhl-card rounded-xl border border-gray-700/50">
        <thead>
          <tr class="border-b border-gray-600 text-gray-400 text-xs uppercase">
            <th class="py-3 px-4 text-center w-10">#</th>
            <th class="py-3 px-4 text-left">Player</th>
            <th class="py-3 px-4 text-center hidden sm:table-cell">Country</th>
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
    const leaders = await fetchScoringLeaders(25);
    _leadersCache = leaders;
    topScorersContainer.innerHTML = renderScoringLeaders(leaders);

    // Wire up click handlers
    topScorersContainer.querySelectorAll('.scoring-leader-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.playerIdx, 10);
        if (_leadersCache && _leadersCache[idx]) openPlayerModal(_leadersCache[idx]);
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
    // gameLog is sorted most-recent first by the API
    return (data.gameLog || []).slice(0, 20);
  } catch (err) {
    console.error('fetchPlayerGameLog error:', err);
    return [];
  }
}

// ─── Next Scheduled Game ───────────────────────────────────────────────────────
async function fetchNextGame(teamAbbrev) {
  try {
    const res = await fetch(`${API_BASE}/club-schedule/${teamAbbrev}/week/now`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const now = new Date();
    return (data.games || []).find(g => new Date(g.startTimeUTC) > now) || null;
  } catch (err) {
    console.error('fetchNextGame error:', err);
    return null;
  }
}

// ─── Prediction Algorithm ──────────────────────────────────────────────────────
/**
 * Calculate player prop predictions using a three-factor model:
 *   1. Season per-game average  (40% weight, or 70% if < 3 recent games)
 *   2. Recent form — last 5 games, exponentially weighted (60% / 30%)
 *   3. Head-to-head vs. next opponent — multiplicative adjustment (±0–30%)
 *
 * Returns an object keyed by prop name, each containing:
 *   { label, line, projected, direction, confidence, h2hGames }
 */
function calculateProps(seasonStats, gameLog, nextOpponentAbbrev) {
  const gp = seasonStats.gamesPlayed || 1;

  const seasonPPG = {
    goals:   (seasonStats.goals   || 0) / gp,
    assists: (seasonStats.assists || 0) / gp,
    points:  (seasonStats.points  || 0) / gp,
    shots:   (seasonStats.shots   || 0) / gp,
  };

  // Exponential weights for last 5 games (must sum to 1.0)
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

  // H2H: filter game log for games against the next opponent
  let h2hGames = [];
  let h2hMult = { goals: 1, assists: 1, points: 1, shots: 1 };

  if (nextOpponentAbbrev) {
    h2hGames = gameLog.filter(g => g.opponentAbbrev === nextOpponentAbbrev);

    if (h2hGames.length >= 2) {
      const avg = (arr, fn) => arr.reduce((s, g) => s + fn(g), 0) / arr.length;
      const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

      const h2hG   = avg(h2hGames, g => g.goals   || 0);
      const h2hA   = avg(h2hGames, g => g.assists || 0);
      const h2hSOG = avg(h2hGames, g => g.shots   || g.shotsOnGoal || 0);

      // Multiplier blends h2h average with season average (30% h2h influence)
      h2hMult.goals   = seasonPPG.goals   > 0 ? clamp(0.7 + 0.3 * (h2hG   / seasonPPG.goals),   0.75, 1.30) : 1;
      h2hMult.assists = seasonPPG.assists > 0 ? clamp(0.7 + 0.3 * (h2hA   / seasonPPG.assists), 0.75, 1.30) : 1;
      h2hMult.shots   = seasonPPG.shots   > 0 ? clamp(0.7 + 0.3 * (h2hSOG / seasonPPG.shots),   0.75, 1.30) : 1;
      h2hMult.points  = (h2hMult.goals + h2hMult.assists) / 2;
    }
  }

  // Blend weights: season 40% / recent 60% (or 70/30 if sparse recent data)
  const SW = recent5.length >= 3 ? 0.40 : 0.70;
  const RW = 1 - SW;

  const PROP_META = {
    goals:   'Goals',
    assists: 'Assists',
    points:  'Points',
    shots:   'Shots on Goal',
  };

  const props = {};

  Object.keys(PROP_META).forEach(stat => {
    const projected = ((seasonPPG[stat] * SW) + (recentW[stat] * RW)) * h2hMult[stat];

    // Line: season average rounded to nearest 0.5, minimum 0.5 when player scores at all
    let line = Math.round(seasonPPG[stat] * 2) / 2;
    if (line <= 0 && projected > 0) line = 0.5;

    // Standard deviation of last 5 games for this prop
    const vals = recent5.map(g => {
      if (stat === 'points') return (g.goals || 0) + (g.assists || 0);
      if (stat === 'shots')  return g.shots || g.shotsOnGoal || 0;
      return g[stat] || 0;
    });
    const mean   = vals.reduce((s, v) => s + v, 0) / Math.max(vals.length, 1);
    const stdDev = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(vals.length, 1));

    // Confidence: magnitude of edge + consistency bonus/penalty
    const relGap = line > 0 ? Math.abs(projected - line) / line : Math.abs(projected - line);
    let conf = relGap >= 0.40 ? 82 : relGap >= 0.25 ? 70 : relGap >= 0.10 ? 58 : 51;
    if (stdDev < 0.80) conf = Math.min(92, conf + 8);
    else if (stdDev > 2.0) conf = Math.max(42, conf - 10);

    props[stat] = {
      label:      PROP_META[stat],
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
  // Show modal immediately with a loading spinner while we fetch data
  modalTitle.innerHTML = renderModalHeader(playerData);
  modalContent.innerHTML = `<div class="flex justify-center py-12">${SPINNER_SVG}</div>`;
  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';

  try {
    const teamAbbrev = playerData.teamAbbrev?.default;

    const [gameLog, nextGame, landing] = await Promise.all([
      fetchPlayerGameLog(playerData.id),
      fetchNextGame(teamAbbrev),
      fetchPlayerStats(playerData.id),
    ]);

    // Enrich birth country from landing data if not already on the player object
    if (!playerData.birthCountry && landing.birthCountry) {
      playerData = { ...playerData, birthCountry: landing.birthCountry };
      modalTitle.innerHTML = renderModalHeader(playerData);
    }

    // Resolve season stats from landing
    let seasonStats = {};
    if (landing.featuredStats?.regularSeason?.subSeason) {
      seasonStats = landing.featuredStats.regularSeason.subSeason;
    } else {
      seasonStats = (landing.seasonTotals || [])
        .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
        .pop() || {};
    }

    // Determine the abbreviation for the next opponent
    const nextOpponent = nextGame
      ? (nextGame.homeTeam?.abbrev === teamAbbrev
          ? nextGame.awayTeam?.abbrev
          : nextGame.homeTeam?.abbrev)
      : null;

    const props = calculateProps(seasonStats, gameLog, nextOpponent);
    modalContent.innerHTML = renderModalBody(playerData, gameLog, nextGame, props, nextOpponent, seasonStats);

  } catch (err) {
    modalContent.innerHTML = `<p class="text-red-400 p-4">Error loading player data: ${err.message}</p>`;
  }
}

function renderModalHeader(player) {
  const flag = getFlag(player.birthCountry);
  const teamAbbrev = player.teamAbbrev?.default || '';
  const name = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();

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

  // ── Season Stats Summary ──────────────────────────────────────────────────────
  const seasonSummaryHTML = gp ? `
    <div class="grid grid-cols-4 gap-2 mb-5">
      ${[
        ['GP',  gp],
        ['G',   seasonStats.goals   || 0],
        ['A',   seasonStats.assists || 0],
        ['PTS', seasonStats.points  || 0],
      ].map(([label, val]) => `
        <div class="bg-gray-900 rounded-lg p-2 text-center border border-gray-700/40">
          <div class="text-xl font-bold text-white tabular-nums">${val}</div>
          <div class="text-xs text-gray-500 uppercase tracking-wide">${label}</div>
        </div>`).join('')}
    </div>` : '';

  // ── Next Game Banner ──────────────────────────────────────────────────────────
  const nextGameHTML = nextGame ? (() => {
    const awayA = nextGame.awayTeam?.abbrev || '';
    const homeA = nextGame.homeTeam?.abbrev || '';
    const dateStr = new Date(nextGame.startTimeUTC).toLocaleDateString([], {
      weekday: 'short', month: 'short', day: 'numeric'
    });
    return `
      <div class="mb-5 p-3 bg-gray-900/80 rounded-lg border border-gray-700/50 flex flex-wrap items-center gap-3">
        <span class="text-xs text-blue-400 font-semibold uppercase tracking-wide">Next Game</span>
        <div class="flex items-center gap-2 ml-auto">
          <img src="${nextGame.awayTeam?.logo || ''}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="font-medium text-sm">${awayA} @ ${homeA}</span>
          <img src="${nextGame.homeTeam?.logo || ''}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="text-xs text-gray-400 ml-1">${dateStr}</span>
        </div>
      </div>`;
  })() : '';

  // ── Prop Predictions ──────────────────────────────────────────────────────────
  const propsHTML = `
    <div class="mb-5">
      <div class="flex items-center gap-2 mb-3">
        <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide">Prop Predictions</h3>
        ${nextOpponent ? `<span class="text-xs bg-blue-500/20 text-blue-300 rounded px-1.5 py-0.5 border border-blue-500/30">vs ${nextOpponent}</span>` : ''}
        <span class="ml-auto text-xs text-gray-600 italic">Entertainment only</span>
      </div>
      <div class="grid grid-cols-2 gap-2">
        ${Object.values(props).map(p => {
          const isOver   = p.direction === 'OVER';
          const dirClass = isOver ? 'text-green-400' : 'text-red-400';
          const borderCls = isOver ? 'border-green-500/25' : 'border-red-500/25';
          const barColor = p.confidence >= 75 ? 'bg-green-500'
                         : p.confidence >= 60 ? 'bg-yellow-500'
                         : 'bg-gray-500';
          return `
            <div class="bg-gray-900 rounded-lg p-3 border ${borderCls}">
              <div class="flex justify-between items-center mb-1">
                <span class="text-xs text-gray-400 font-semibold uppercase tracking-wide">${p.label}</span>
                <span class="text-xs font-bold ${dirClass}">${p.direction}</span>
              </div>
              <div class="flex justify-between items-end mb-2.5">
                <span class="text-2xl font-bold text-white tabular-nums">${p.line}</span>
                <span class="text-xs text-gray-500">
                  Proj: <span class="${dirClass} font-semibold">${p.projected}</span>
                </span>
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

  // ── Head-to-Head ─────────────────────────────────────────────────────────────
  const h2hGames = props.goals?.h2hGames || [];
  const h2hHTML = nextOpponent && h2hGames.length >= 2 ? `
    <div class="mb-5">
      <h3 class="text-sm font-semibold text-gray-400 uppercase tracking-wide mb-2">
        H2H vs ${nextOpponent} <span class="text-gray-600 font-normal normal-case">(${h2hGames.length} games in game log)</span>
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

  // ── Recent Form ───────────────────────────────────────────────────────────────
  const recent5 = gameLog.slice(0, 5);
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
              const pts = (g.goals || 0) + (g.assists || 0);
              const isHome = g.homeRoadFlag === 'H';
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
