const API_BASE = 'https://api-web.nhle.com/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.getElementById('loading-indicator');
const standingsContainer = document.getElementById('standings-container');
const standingsLoading = document.getElementById('standings-loading');
const scoresContainer = document.getElementById('scores-container');
const scoresLoading = document.getElementById('scores-loading');

// --- Tab switching ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');

    if (btn.dataset.tab === 'standings' && !standingsContainer.innerHTML) {
      fetchStandings();
    }
    if (btn.dataset.tab === 'scores' && !scoresContainer.innerHTML) {
      fetchScores();
    }
  });
});

// --- Helpers ---
function showLoading(el) { el.classList.remove('hidden'); }
function hideLoading(el) { el.classList.add('hidden'); }

function getCurrentSeason() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NHL season starts in October. Before October, we're in the previous season.
  const startYear = month >= 10 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}

// --- Populate team dropdown from standings ---
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

    // Deduplicate by abbreviation
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

// --- Fetch roster + player stats ---
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
  const season = getCurrentSeason();
  const results = await Promise.all(
    roster.map(async player => {
      try {
        const data = await fetchPlayerStats(player.id);
        const isGoalie = player.positionCode === 'G';

        // Try featuredStats first, fall back to seasonTotals
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

  // Sort by points descending
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
    const svPct = s.savePctg != null ? (s.savePctg >= 1 ? s.savePctg.toFixed(3) : s.savePctg.toFixed(3)) : '—';
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

// --- Team select handler ---
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

// --- Standings ---
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

    // Sort each division by points descending, then regulation wins
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

// --- Today's Scores ---
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
      const state = game.gameState; // FUT, LIVE, CRIT, OFF

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

// --- Init ---
populateDropdown();
