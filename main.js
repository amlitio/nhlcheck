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
// Uses ESPN standings (CORS-friendly, no proxy needed) to build the team list.
// ESPN structure: data.children[conf].standings.entries[team]  (no division nesting)
async function populateDropdown() {
  try {
    const res = await fetch('https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const teams = [];
    const seen  = new Set();
    for (const conf of (data.children || [])) {
      for (const entry of (conf.standings?.entries || [])) {
        const abbrev = entry.team.abbreviation;
        if (seen.has(abbrev)) continue;
        seen.add(abbrev);
        teams.push({ abbrev, name: entry.team.displayName });
      }
    }
    teams.sort((a, b) => a.name.localeCompare(b.name));

    teams.forEach(team => {
      const opt       = document.createElement('option');
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

      const season = Number(getCurrentSeason());
      let stats = Number(data.featuredStats?.season) === season
        ? data.featuredStats?.regularSeason?.subSeason ?? null : null;
      if (!stats) {
        stats = (data.seasonTotals || [])
          .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2 && Number(s.season) === season)
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
// Data from ESPN (CORS-friendly). Organized conference → division → teams.
async function fetchStandings() {
  showLoading(standingsLoading);
  try {
    const res = await fetch('https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const getStat    = (stats, name) => stats.find(s => s.name === name)?.value ?? 0;
    const getStatStr = (stats, name) => stats.find(s => s.name === name)?.displayValue ?? '—';

    // ESPN standings: data.children = conferences, each with .standings.entries (no division nesting)
    standingsContainer.innerHTML = (data.children || []).map(conf => {
      const entries = [...(conf.standings?.entries || [])].sort((a, b) =>
        getStat(b.stats, 'points') - getStat(a.stats, 'points') ||
        getStat(b.stats, 'regulationOvertimeWins') - getStat(a.stats, 'regulationOvertimeWins')
      );

      const rows = entries.map((entry, i) => {
        const t    = entry.team;
        const s    = entry.stats;
        const logo = `https://a.espncdn.com/i/teamlogos/nhl/500/${t.abbreviation.toLowerCase()}.png`;
        const gd   = getStat(s, 'goalDifferential');
        return `
          <tr class="border-b border-gray-700 hover:bg-gray-700/50">
            <td class="py-2 px-3">${i + 1}</td>
            <td class="py-2 px-3 flex items-center gap-2">
              <img src="${logo}" alt="" class="w-6 h-6" onerror="this.style.display='none'">
              ${t.abbreviation} — ${t.displayName}
            </td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'gamesPlayed')}</td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'wins')}</td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'losses')}</td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'overtimeLosses')}</td>
            <td class="py-2 px-3 text-center font-semibold">${getStatStr(s, 'points')}</td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'goalsFor')}</td>
            <td class="py-2 px-3 text-center">${getStatStr(s, 'goalsAgainst')}</td>
            <td class="py-2 px-3 text-center">${gd > 0 ? '+' : ''}${gd}</td>
          </tr>`;
      }).join('');

      return `
        <div class="mb-6">
          <h3 class="text-lg font-semibold mb-2 text-gray-300">${conf.name}</h3>
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
// Returns { "EDM": { points, gamesPlayed, goalFor, goalAgainst, cfPct, xgfPct, ... }, ... }
// ESPN standings + NST advanced stats merged. Failure of either degrades gracefully.
async function fetchStandingsMap() {
  const [espnRes, nstRes] = await Promise.all([
    fetch('https://site.api.espn.com/apis/v2/sports/hockey/nhl/standings'),
    fetch('/api/scrape-stats').catch(() => null),
  ]);

  if (!espnRes.ok) throw new Error(`ESPN HTTP ${espnRes.status}`);
  const espnData = await espnRes.json();

  // Advanced stats from NST — silently ignored if unavailable
  let advStats = {};
  try {
    if (nstRes?.ok) advStats = await nstRes.json();
  } catch (_) { /* ignore */ }

  const map     = {};
  const getStat = (stats, name) => stats.find(s => s.name === name)?.value ?? 0;

  // ESPN: data.children = conferences, each with .standings.entries (no division nesting)
  for (const conf of (espnData.children || [])) {
    for (const entry of (conf.standings?.entries || [])) {
      const abbrev = entry.team.abbreviation;
      const s      = entry.stats;
      const adv    = advStats[abbrev] ?? {};
      map[abbrev]  = {
        points:      getStat(s, 'points'),
        gamesPlayed: getStat(s, 'gamesPlayed'),
        goalFor:     getStat(s, 'goalsFor'),
        goalAgainst: getStat(s, 'goalsAgainst'),
        wins:        getStat(s, 'wins'),
        losses:      getStat(s, 'losses'),
        otLosses:    getStat(s, 'overtimeLosses'),
        streakCode:  '',
        streakCount: 0,
        cfPct:   adv.cfPct   ?? null,
        xgfPct:  adv.xgfPct  ?? null,
        hdcfPct: adv.hdcfPct ?? null,
      };
    }
  }
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
    const gdNorm  = Math.min(1, Math.max(0, (gdPerGP + 2) / 4));

    // When NST advanced stats are available, use a 4-factor model;
    // otherwise fall back to the original 2-factor model.
    if (t.xgfPct != null && t.cfPct != null) {
      const xgfNorm  = t.xgfPct  / 100; // already a 0–100 percentage
      const cfNorm   = t.cfPct   / 100;
      return ptsPct * 0.45 + gdNorm * 0.25 + xgfNorm * 0.20 + cfNorm * 0.10;
    }
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

// ─── Odds Helper ──────────────────────────────────────────────────────────────
// Returns a map keyed by "AWAYABBREV_HOMEABBREV" → odds object.
// Silently returns {} if /api/odds is unconfigured or fails.
async function fetchOdds() {
  try {
    const res = await fetch('/api/odds');
    if (!res.ok) return {};
    const games = await res.json();
    return Object.fromEntries((Array.isArray(games) ? games : []).map(g => [g.matchKey, g]));
  } catch (_) {
    return {};
  }
}

// Format an American odds number for display: +120, -140, etc.
function fmtOdds(n) {
  if (n == null) return '—';
  return n > 0 ? `+${n}` : String(n);
}

// ─── Today's Scores + Predictions ─────────────────────────────────────────────
// Data from ESPN scoreboard (CORS-friendly, no proxy needed).
async function fetchScores() {
  showLoading(scoresLoading);
  try {
    const now = new Date();
    const localDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const [boardRes, standingsMap, oddsMap, scorerData] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/scoreboard?dates=${localDate}`).then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
      fetchStandingsMap().catch(() => ({})),
      fetchOdds(),
      fetch(`/api/daily-goal-picks?date=${localDate.slice(0,4)}-${localDate.slice(4,6)}-${localDate.slice(6,8)}`)
        .then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const events      = boardRes.events ?? [];
    // ESPN and NHL assign different IDs to the same game; match the scheduled teams.
    const scorerGames = new Map((Array.isArray(scorerData?.games) ? scorerData.games : [])
      .filter(game => game.awayTeam && game.homeTeam)
      .map(game => [`${game.awayTeam}_${game.homeTeam}`, game]));
    const displayDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    if (!events.length) {
      scoresContainer.innerHTML = `<p class="text-gray-400">No games scheduled for today.</p>`;
      return;
    }

    const cards = events.map(event => {
      try {
        const comp       = event.competitions?.[0] ?? {};
        const competitors = comp.competitors ?? [];
        const homeComp   = competitors.find(c => c.homeAway === 'home') ?? {};
        const awayComp   = competitors.find(c => c.homeAway === 'away') ?? {};
        const homeTeam   = homeComp.team ?? {};
        const awayTeam   = awayComp.team ?? {};

        // ESPN status.type.state: 'pre' = future, 'in' = live, 'post' = final
        const state      = event.status?.type?.state ?? 'pre';
        const statusName = event.status?.type?.name  ?? '';

        // ESPN CDN logo by abbreviation
        const homeLogo = `https://a.espncdn.com/i/teamlogos/nhl/500/${(homeTeam.abbreviation || '').toLowerCase()}.png`;
        const awayLogo = `https://a.espncdn.com/i/teamlogos/nhl/500/${(awayTeam.abbreviation || '').toLowerCase()}.png`;

        let statusText  = '';
        let statusClass = 'text-gray-400';

        if (state === 'pre') {
          // Use ESPN's pre-formatted detail string, e.g. "7:30 PM ET"
          statusText = event.status?.type?.detail
            ?? new Date(event.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } else if (state === 'in') {
          statusText  = event.status?.type?.shortDetail ?? 'Live';
          statusClass = 'text-green-400 font-semibold animate-pulse';
        } else {
          // post — STATUS_FINAL, STATUS_FINAL_OT, STATUS_FINAL_SO, etc.
          statusText = event.status?.type?.shortDetail ?? 'Final';
        }

        // Prediction badge for not-yet-started games
        let predBadge = '';
        if (state === 'pre' && homeTeam.abbreviation && awayTeam.abbreviation) {
          const pred = predictGame(homeTeam.abbreviation, awayTeam.abbreviation, standingsMap);
          if (pred) {
            predBadge = `
              <div class="mt-3 pt-3 border-t border-gray-700">
                <div class="flex items-center justify-between">
                  <span class="text-xs text-gray-500 uppercase tracking-wide">Model lean</span>
                  <div class="flex items-center gap-2">
                    <span class="text-xs font-bold ${pred.pick === homeTeam.abbreviation ? 'text-blue-300' : 'text-orange-300'}">
                      ${pred.pick}
                    </span>
                  </div>
                </div>
                ${pred.streakLabel ? `<div class="text-xs text-gray-600 text-right mt-0.5">${pred.streakLabel}</div>` : ''}
              </div>`;
          }
        }

        const scorerGame = scorerGames.get(`${awayTeam.abbreviation}_${homeTeam.abbreviation}`);
        const scorerPicks = state === 'pre' && Array.isArray(scorerGame?.picks)
          ? scorerGame.picks.filter(p => Number.isFinite(p.estimatedGoalPct)).slice(0, 3) : [];
        const scorerHTML = state === 'pre' ? `
          <div class="mt-3 pt-3 border-t border-gray-700">
            <h3 class="text-xs font-semibold uppercase text-blue-300 mb-2">Best goal scorers today</h3>
            ${scorerPicks.length >= 3 ? scorerPicks.map(p => `
              <div class="py-2 border-b border-gray-700/40 last:border-0">
                <div class="flex justify-between gap-2 text-sm"><span>${escapeHTML(p.name)} <span class="text-gray-500">${escapeHTML(p.team)}</span></span><strong class="text-blue-300">${p.estimatedGoalPct.toFixed(1)}%</strong></div>
                <p class="text-xs text-gray-400 mt-1">${escapeHTML(p.reason)}</p>
              </div>`).join('') : '<p class="text-xs text-gray-400">Goal scorer estimates are unavailable for this matchup.</p>'}
            <p class="text-[10px] text-gray-500 mt-2">Model estimates of 1+ goals, not guarantees or sportsbook odds. Based on available pregame stats.</p>
          </div>` : '';
        const showScore = state !== 'pre';

        // Live sportsbook odds from The Odds API (pre-game only)
        const oddsKey  = `${awayTeam.abbreviation}_${homeTeam.abbreviation}`;
        const gameOdds = state === 'pre' ? (oddsMap[oddsKey] ?? null) : null;
        const oddsBadge = gameOdds ? `
          <div class="mt-2 pt-2 border-t border-gray-700/50">
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500 uppercase tracking-wide text-[10px]">Live Odds</span>
              <span class="text-gray-600 text-[10px]">${gameOdds.bookmaker}</span>
            </div>
            <div class="flex justify-between items-center mt-1 text-xs tabular-nums">
              <span class="text-gray-300">${awayTeam.abbreviation} <span class="${(gameOdds.awayOdds ?? 0) > 0 ? 'text-green-400' : 'text-red-400'} font-semibold">${fmtOdds(gameOdds.awayOdds)}</span></span>
              ${gameOdds.total != null ? `<span class="text-gray-500">O/U <span class="text-gray-300">${gameOdds.total}</span> <span class="text-gray-500">(${fmtOdds(gameOdds.overOdds)})</span></span>` : ''}
              <span class="text-gray-300">${homeTeam.abbreviation} <span class="${(gameOdds.homeOdds ?? 0) > 0 ? 'text-green-400' : 'text-red-400'} font-semibold">${fmtOdds(gameOdds.homeOdds)}</span></span>
            </div>
          </div>` : '';

        return `
          <div class="bg-nhl-card rounded-lg p-4 flex flex-col gap-3 border border-gray-700/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 flex-1">
                <img src="${awayLogo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
                <span class="font-medium">${awayTeam.abbreviation ?? '—'}</span>
              </div>
              <span class="text-2xl font-bold w-8 text-center tabular-nums">${showScore ? (awayComp.score ?? 0) : ''}</span>
            </div>
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-3 flex-1">
                <img src="${homeLogo}" alt="" class="w-10 h-10" onerror="this.style.display='none'">
                <span class="font-medium">${homeTeam.abbreviation ?? '—'} <span class="text-xs text-gray-500">HOME</span></span>
              </div>
              <span class="text-2xl font-bold w-8 text-center tabular-nums">${showScore ? (homeComp.score ?? 0) : ''}</span>
            </div>
            <div class="text-center text-sm ${statusClass}">${statusText}</div>
            ${predBadge}${scorerHTML}${oddsBadge}
          </div>`;
      } catch (cardErr) {
        console.warn('Error rendering game card:', cardErr);
        return '';
      }
    }).join('');

    scoresContainer.innerHTML = `
      <div class="flex items-center justify-between mb-4">
        <h2 class="text-xl font-bold">Games — ${displayDate}</h2>
        <span class="text-xs text-gray-500">Schedule and model leans</span>
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
      points:  Number.isSafeInteger(p.value) && p.value >= 0 ? p.value : null,
      goals:   null,
      assists: null,
    };
  });
  (goalsData.goals     || []).forEach(p => { if (map[p.id]) map[p.id].goals   = Number.isSafeInteger(p.value) && p.value >= 0 ? p.value : null; });
  (assistsData.assists || []).forEach(p => { if (map[p.id]) map[p.id].assists = Number.isSafeInteger(p.value) && p.value >= 0 ? p.value : null; });

  // Category endpoints return only their top 50. Derive a missing count only
  // when the other count and total points are both verified.
  for (const player of Object.values(map)) {
    if (player.points === null) continue;
    if (player.goals === null && player.assists !== null && player.assists <= player.points)
      player.goals = player.points - player.assists;
    if (player.assists === null && player.goals !== null && player.goals <= player.points)
      player.assists = player.points - player.goals;
  }
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
      const meta = await metaRes.json();
      const cacheAge = Date.now() - Date.parse(meta.cachedAt);
      if (String(meta.season) !== getCurrentSeason() || !Number.isFinite(cacheAge) || cacheAge < 0 || cacheAge > 36 * 60 * 60 * 1000) throw new Error('Stale cache');
      const [ptRes, gRes, aRes] = await Promise.all([
        fetch('./data/leaders-points.json'),
        fetch('./data/leaders-goals.json'),
        fetch('./data/leaders-assists.json'),
      ]);
      if (ptRes.ok) {
        const [ptData, gData, aData] = await Promise.all([ptRes.json(), gRes.json(), aRes.json()]);
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
  const el = document.getElementById('cache-status');
  if (el) el.textContent = `Live NHL data · ${getCurrentSeason()}`;
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
        <td class="py-3 px-4 text-center text-blue-400 font-bold text-lg tabular-nums">${displayStat(p.points)}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${displayStat(p.goals)}</td>
        <td class="py-3 px-4 text-center text-gray-200 font-medium tabular-nums">${displayStat(p.assists)}</td>
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

// ─── Player Modal ──────────────────────────────────────────────────────────────
// A generation counter prevents a slower previous request replacing a new player.
let modalRequest = 0;
async function openPlayerModal(playerData) {
  const request = ++modalRequest;
  modalTitle.innerHTML = renderModalHeader(playerData);
  modalContent.innerHTML = `<div class="flex justify-center py-12">${SPINNER_SVG}</div>`;
  playerModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  try {
    const context = await NHLPlayerData.loadPlayerContext(playerData.id, playerData.teamAbbrev);
    if (request !== modalRequest) return;
    const { gameLog, currentGameLog, nextGame, nextOpponent, seasonStats, landing } = context;
    playerData = { ...playerData, teamAbbrev: context.teamAbbrev,
      birthCountry: landing?.birthCountry ?? playerData.birthCountry };
    modalTitle.innerHTML = renderModalHeader(playerData);
    const props = NHLPlayerModel.calculateProps(seasonStats, gameLog, nextOpponent, {
      asOf: new Date(context.fetchedAt), recentLog: currentGameLog ?? [],
    });
    modalContent.innerHTML = renderModalBody(playerData, currentGameLog ?? [], nextGame,
      props, nextOpponent, seasonStats ?? {}, context);
  } catch (_) {
    if (request === modalRequest) modalContent.textContent = 'Player data is unavailable. Please try again.';
  }
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}
function displayStat(value) {
  return Number.isFinite(value) ? String(value) : '—';
}

function renderModalHeader(player) {
  const flag       = getFlag(player.birthCountry);
  const teamAbbrev = player.teamAbbrev || '';    // plain string
  const name       = `${player.firstName?.default || ''} ${player.lastName?.default || ''}`.trim();

  return `
    <div class="flex items-center gap-4 min-w-0">
      <img src="${escapeHTML(player.headshot || '')}" alt=""
           class="w-14 h-14 rounded-full border-2 border-gray-600 object-cover bg-gray-700 flex-shrink-0"
           onerror="this.style.display='none'">
      <div class="min-w-0">
        <div class="font-bold text-white text-lg leading-tight">
          ${escapeHTML(name)} <span class="text-2xl align-middle">${flag}</span>
        </div>
        <div class="text-sm text-gray-400 mt-0.5">
          ${escapeHTML(teamAbbrev)}${player.position ? ' &middot; ' + escapeHTML(player.position) : ''}
        </div>
      </div>
    </div>`;
}

function renderModalBody(player, gameLog, nextGame, props, nextOpponent, seasonStats, context = {}) {
  const gp = seasonStats.gamesPlayed || 0;

  // Season summary
  const seasonSummaryHTML = gp ? `
    <div class="grid grid-cols-4 gap-2 mb-5">
      ${[['GP', gp], ['G', displayStat(seasonStats.goals)], ['A', displayStat(seasonStats.assists)], ['PTS', displayStat(seasonStats.points)]]
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
          <img src="${escapeHTML(nextGame.awayTeam?.logo || '')}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="font-medium text-sm">${escapeHTML(nextGame.awayTeam?.abbrev ?? '')} @ ${escapeHTML(nextGame.homeTeam?.abbrev ?? '')}</span>
          <img src="${escapeHTML(nextGame.homeTeam?.logo || '')}" alt="" class="w-5 h-5" onerror="this.style.display='none'">
          <span class="text-xs text-gray-400 ml-1">${dateStr}</span>
        </div>
      </div>`;
  })() : '';

  // Percentages are observed frequencies, never uncalibrated win probabilities.
  const rate = value => Number.isFinite(value) ? value.toFixed(2) : '—';
  const frequency = sample => sample?.games > 0 && Number.isFinite(sample.hitRate)
    ? `${(sample.hitRate * 100).toFixed(1)}% (${sample.games} games)` : 'Unavailable (0 games)';
  const propsHTML = `
    <section class="mb-5">
      <h3 class="text-sm font-semibold text-gray-300 mb-2">Player projections ${nextOpponent ? `vs ${escapeHTML(nextOpponent)}` : ''}</h3>
      <p class="text-xs text-gray-400 mb-3">Weighted per-game estimates, not betting lines or scoring probabilities. Historical 1+ rates describe observed games only.</p>
      ${!nextGame ? '<p class="text-amber-300 text-sm mb-3">No verified upcoming matchup. Estimates below show general form only; opponent weighting is omitted.</p>' : ''}
      ${(context.warnings || []).map(w => `<p class="text-amber-300 text-xs mb-2">${escapeHTML(w)}</p>`).join('')}
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
      ${Object.values(props).map(p => `
        <div class="bg-gray-900 rounded-lg p-3 border border-gray-700">
          <h4 class="font-semibold">${escapeHTML(p.label)}</h4>
          <div class="text-2xl font-bold text-blue-300 my-2">${rate(p.projected)} <span class="text-xs text-gray-400">projected / game</span></div>
          <dl class="text-xs text-gray-300 space-y-2">
            <div>Season average: ${rate(p.seasonRate)}</div>
            <div>Shrinkage baseline: ${rate(p.baselineRate)} (${p.baselineSource === 'season' ? 'season' : p.baselineSource === 'observed-history' ? 'available current-season log' : 'unavailable'})</div>
            <div>Recent average: ${rate(p.recent.rate)} (${p.recent.games} valid games)</div>
            <div>Recent 1+ rate: ${frequency(p.recent)}</div>
            <div>Active 1+ streak: ${p.recent.streak == null ? 'Unavailable' : `${p.recent.streak} games`}</div>
            <div>Recent lift vs baseline: ${p.recent.uplift == null ? 'Unavailable' : `${p.recent.uplift >= 0 ? '+' : ''}${rate(p.recent.uplift)} / game`}</div>
            <div>Opponent 1+ rate: ${frequency(p.opponent)}</div>
            <div>Opponent average: ${rate(p.opponent.rate)}; shrunk: ${rate(p.opponent.shrunkRate)}</div>
            <div class="text-gray-400">Effective weights — season ${Math.round((p.weights.season || 0)*100)}%, recent ${Math.round((p.weights.recent || 0)*100)}%, opponent ${Math.round((p.weights.opponent || 0)*100)}%</div>
          </dl>
        </div>`).join('')}
      </div>
      <p class="text-xs text-gray-400 mt-3">Recent form uses the latest five current-season regular-season games. Opponent history spans the current and previous regular season, excluding today's UTC date and future dates. Small samples shrink toward the baseline using 5 prior games for recent form and 10 for opponent history. Weights are heuristic and require backtesting before predictive use.</p>
      <p class="text-xs text-gray-500 mt-2">Fetched: ${escapeHTML(context.fetchedAt || 'Unavailable')} · Season: ${escapeHTML(context.season || 'Unavailable')}</p>
    </section>`;

  // Recent form table
  const recent5    = NHLPlayerModel.normalizeGames(gameLog, { asOf: new Date(context.fetchedAt || Date.now()) }).slice(0, 5);
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
              const pts      = g.points;
              const isHome   = g.homeRoadFlag === 'H';
              const ptsClass = pts > 1 ? 'text-blue-400 font-bold' : pts === 1 ? 'text-blue-300 font-semibold' : 'text-gray-500';
              return `
                <tr class="border-b border-gray-700/30 hover:bg-gray-700/20 transition-colors">
                  <td class="py-2 px-3 text-gray-400 text-xs whitespace-nowrap">${escapeHTML(g.gameDate || '—')}</td>
                  <td class="py-2 px-3 text-center text-xs">${isHome ? 'vs' : '@'}&nbsp;${escapeHTML(g.opponentAbbrev || '—')}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${displayStat(g.goals)}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${displayStat(g.assists)}</td>
                  <td class="py-2 px-3 text-center tabular-nums ${ptsClass}">${displayStat(pts)}</td>
                  <td class="py-2 px-3 text-center tabular-nums">${displayStat(g.shots)}</td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>` : '<p class="text-gray-500 text-sm">No recent game data available.</p>';

  return seasonSummaryHTML + nextGameHTML + propsHTML + recentHTML;
}

// ─── Modal Controls ────────────────────────────────────────────────────────────
function closeModal() {
  modalRequest++;
  playerModal.classList.add('hidden');
  document.body.style.overflow = '';
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('modal-overlay').addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── Init ──────────────────────────────────────────────────────────────────────
populateDropdown();
