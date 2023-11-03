const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.querySelector('#loading-indicator');

// Function to populate the dropdown with teams from the NHL API
async function populateDropdown() {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams`);
    const teams = response.data.teams;

    teams.forEach((team) => {
      const option = document.createElement('option');
      option.value = team.id;
      option.textContent = team.name;
      teamSelect.appendChild(option);
    });

    // Display the dropdown
    teamSelect.style.display = 'block';
  } catch (error) {
    console.error('Error fetching teams:', error);
  }
}

// Function to fetch the team's roster
async function fetchTeamRoster(teamId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams/${teamId}/roster`);
    return response.data.roster;
  } catch (error) {
    console.error('Error fetching team roster:', error);
    return null;
  }
}

// Function to fetch player stats for the specified season
async function fetchPlayerStats(playerId, season) {
  try {
    const response = await axios.get(`${API_BASE_URL}/people/${playerId}/stats?stats=statsSingleSeason&season=${season}`);
    return response.data.stats[0].splits[0].stat;
  } catch (error) {
    console.error('Error fetching player stats:', error);
    return null;
  }
}

// Function to fetch all player data including stats
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

// Function to update the stats container with the player data
function updateStatsContainer(playerData) {
  if (playerData.length > 0) {
    statsContainer.innerHTML = `
      <h2>Players and Stats for ${teamSelect.options[teamSelect.selectedIndex].text}:</h2>
      <ul>
        ${playerData.map(player => `
          <li>${player.playerName} - Goals: ${player.playerStats.goals}, Assists: ${player.playerStats.assists}, Points: ${player.playerStats.points}, TOI: ${player.playerStats.timeOnIce}
        `).join('')}
      </ul>
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

  const roster = await fetchTeamRoster(selectedTeamId);

  if (roster) {
    const playerData = await fetchAllPlayerData(roster, season);

    // Hide the loading indicator
    loadingIndicator.style.visibility = 'hidden';

    updateStatsContainer(playerData);
  } else {
    // Hide the loading indicator in case of an error
    loadingIndicator.style.visibility = 'hidden';

    // Display an error message in the statsContainer
    statsContainer.innerHTML = '<p>An error occurred while fetching team roster.</p>';
  }
});

// Populate the dropdown with teams from the NHL API
populateDropdown();
