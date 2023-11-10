const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.querySelector('#loading-indicator');

async function populateDropdown() {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams`);
    const teams = response.data.teams;
    console.log('Teams fetched:', teams); // Debugging log

    teams.forEach((team) => {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = team.name;
      teamSelect.appendChild(option);
    });
  } catch (error) {
    console.error('Error fetching teams:', error);
  }
}

async function fetchTeamRoster(teamId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams/${teamId}/roster`);
    return response.data.roster;
  } catch (error) {
    console.error('Error fetching team roster:', error);
    return null;
  }
}

async function fetchPlayerStats(playerId, season) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/people/${playerId}/stats?stats=statsSingleSeason&season=${season}`
    );
    const playerStatsData = response.data.stats[0].splits[0].stat;

    playerStatsData.shots = playerStatsData.shots || 0;
    playerStatsData.powerPlayGoals = playerStatsData.powerPlayGoals || 0;
    playerStatsData.powerPlayAssists = playerStatsData.powerPlayAssists || 0;
    playerStatsData.shortHandedGoals = playerStatsData.shortHandedGoals || 0;
    playerStatsData.shortHandedAssists = playerStatsData.shortHandedAssists || 0;
    playerStatsData.hits = playerStatsData.hits || 0;
    playerStatsData.blocked = playerStatsData.blocked || 0;
    playerStatsData.faceoffPct = playerStatsData.faceoffPct || 0;
    playerStatsData.pim = playerStatsData.pim || 0;
    playerStatsData.plusMinus = playerStatsData.plusMinus || 0;

    return playerStatsData;
  } catch (error) {
    console.error('Error fetching player stats:', error);
    return null;
  }
}

async function fetchAllPlayerData(roster, season) {
  const playerData = [];

  for (const player of roster) {
    const playerId = player.person.id;
    const playerName = player.person.fullName;

    const playerStats = await fetchPlayerStats(playerId, season);

    if (playerStats) {
      playerData.push({
        playerName,
        playerStats,
      });
    } else {
      console.error(`Error fetching stats for ${playerName}`);
    }
  }

  return playerData;
}

function updateStatsContainer(playerData) {
  if (playerData.length > 0) {
    statsContainer.innerHTML = `
      <h2>Players and Stats for ${teamSelect.options[teamSelect.selectedIndex].text}:</h2>
      <table class="table table-striped">
        <thead>
          <tr>
            <th>Player</th>
            <th>Goals</th>
            <th>Assists</th>
            <th>Points</th>
            <th>TOI</th>
            <th>Shots</th>
            <th>Power Play Goals</th>
            <th>Power Play Assists</th>
            <th>Short Handed Goals</th>
            <th>Short Handed Assists</th>
            <th>Hits</th>
            <th>Blocked</th>
            <th>Faceoff %</th>
            <th>PIM</th>
            <th>Plus-Minus</th>
          </tr>
        </thead>
        <tbody>
          ${playerData.map((player) => `
            <tr>
              <td>${player.playerName}</td>
              <td>${player.playerStats.goals}</td>
              <td>${player.playerStats.assists}</td>
              <td>${player.playerStats.points}</td>
              <td>${player.playerStats.timeOnIce}</td>
              <td>${player.playerStats.shots}</td>
              <td>${player.playerStats.powerPlayGoals}</td>
              <td>${player.playerStats.powerPlayAssists}</td>
              <td>${player.playerStats.shortHandedGoals}</td>
              <td>${player.playerStats.shortHandedAssists}</td>
              <td>${player.playerStats.hits}</td>
              <td>${player.playerStats.blocked}</td>
              <td>${player.playerStats.faceoffPct}%</td>
              <td>${player.playerStats.pim}</td>
              <td>${player.playerStats.plusMinus}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } else {
    statsContainer.innerHTML = '<p>No player stats available for this team.</p>';
  }
}

teamSelect.addEventListener('change', async () => {
  statsContainer.innerHTML = '';
  loadingIndicator.style.visibility = 'visible';

  const selectedTeamId = teamSelect.value;
  const season = '20232024'; // Replace with the desired season

  const roster = await fetchTeamRoster(selectedTeamId);

  if (roster) {
        const playerData = await fetchAllPlayerData(roster, season);

    loadingIndicator.style.visibility = 'hidden';

    updateStatsContainer(playerData);
  } else {
    loadingIndicator.style.visibility = 'hidden';
    statsContainer.innerHTML = '<p>An error occurred while fetching team roster.</p>';
  }
});

populateDropdown();

