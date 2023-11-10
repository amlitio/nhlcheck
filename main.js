const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.querySelector('#loading-indicator');

// Function to populate the dropdown with teams from the NHL API
async function populateDropdown() {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams`);
    if (response.data && response.data.teams) {
      const teams = response.data.teams;

      teams.forEach((team) => {
        const option = document.createElement('option');
        option.value = team.id;
        option.textContent = team.name;
        teamSelect.appendChild(option);
      });

      // Display the dropdown
      teamSelect.style.display = 'block';
    } else {
      throw new Error('Invalid API response for teams');
    }
  } catch (error) {
    console.error('Error fetching teams:', error);
    statsContainer.innerHTML = `<p>Error fetching teams: ${error.message}</p>`;
  }
}

// Function to fetch the team's roster
async function fetchTeamRoster(teamId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams/${teamId}/roster`);
    if (response.data && response.data.roster) {
      return response.data.roster;
    } else {
      throw new Error('Invalid API response for roster');
    }
  } catch (error) {
    console.error('Error fetching team roster:', error);
    throw error; // Rethrow to handle in the calling function
  }
}

// Function to fetch player stats for the specified season, including additional stats
async function fetchPlayerStats(playerId, season) {
  try {
    const response = await axios.get(
      `${API_BASE_URL}/people/${playerId}/stats?stats=statsSingleSeason&season=${season}`
    );
    if (response.data && response.data.stats && response.data.stats[0] && response.data.stats[0].splits[0]) {
      const playerStatsData = response.data.stats[0].splits[0].stat;

      // Include additional stats in the player's stats object
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
    } else {
      throw new Error('Invalid API response for player stats');
    }
  } catch (error) {
    console.error('Error fetching player stats:', error);
    throw error; // Rethrow to handle in the calling function
  }
}

// Function to fetch all player data including stats
async function fetchAllPlayerData(roster, season) {
  const playerData = [];

  for (const player of roster) {
    const playerId = player.person.id;
    const playerName = player.person.fullName;

    try {
      const playerStats = await fetchPlayerStats(playerId, season);
      playerData.push({
        playerName,
        playerStats,
      });
    } catch (error) {
      console.error(`Error fetching stats for ${playerName}:`, error);
    }
  }

  return playerData;
}

// Function to update the stats container with the player data
function updateStatsContainer(playerData) {
  if (playerData.length > 0) {
    // Create a table to display player stats
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

// Event listener for when a team is selected
teamSelect.addEventListener('change', async () => {
  // Clear the existing data in the statsContainer
  statsContainer.innerHTML = '';

  // Show the loading indicator
  loadingIndicator.style.visibility = 'visible';

  const selectedTeamId = teamSelect.value;
  const season = '20232024'; // Replace with the desired season

  try {
    const roster = await fetchTeamRoster(selectedTeamId);
    const playerData = await fetchAllPlayerData(roster, season);

    // Hide the loading indicator
    loadingIndicator.style.visibility = 'hidden';

    updateStatsContainer(playerData);
  } catch (error) {
    // Hide the loading indicator in case of an error
    loadingIndicator.style.visibility = 'hidden';

    // Display an error message in the statsContainer
    statsContainer.innerHTML = `<p>An error occurred while fetching team roster: ${error.message}</p>`;
  }
});

// Populate the dropdown with teams from the NHL API
populateDropdown();
