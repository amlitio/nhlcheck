const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.querySelector('#loading-indicator');

// Function to populate the dropdown with teams from the NHL API
async function populateDropdown() {
  try {
    // Fetch the teams from the API and populate the dropdown
    // ...
  } catch (error) {
    console.error('Error fetching teams:', error);
  }
}

// Function to fetch player stats based on the selected team and season
async function fetchTeamRosterAndStats(teamId, season) {
  try {
    // Fetch the team's roster
    // ...

    // Array to store player data including stats
    // ...

    for (const player of roster) {
      // Fetch player stats for the specified season
      // ...
    }

    return playerData;
  } catch (error) {
    console.error('Error fetching team roster and player stats:', error);
    return null;
  }
}

// Function to update the stats container with player stats
function updateStatsContainer(playerData) {
  if (playerData) {
    statsContainer.innerHTML = `
      <h2>Players and Stats for ${teamSelect.options[teamSelect.selectedIndex].text}:</h2>
      <ul>
        ${playerData.map(player => `
          <li>${player.playerName} - Goals: ${player.playerStats.goals}, Assists: ${player.playerStats.assists}, Points: ${player.playerStats.points}, TOI: ${player.playerStats.timeOnIce}
        `).join('')}
      </ul>
    `;
  } else {
    statsContainer.innerHTML = '<p>An error occurred while fetching team roster and player stats.</p>';
  }
}

// Event listener for when a team is selected
teamSelect.addEventListener('change', async () => {
  // Show the loading indicator
  loadingIndicator.style.visibility = 'visible';

  const selectedTeamId = teamSelect.value;
  const season = '20232024'; // Replace with the desired season

  const playerData = await fetchTeamRosterAndStats(selectedTeamId, season);

  // Hide the loading indicator
  loadingIndicator.style.visibility = 'hidden';

  updateStatsContainer(playerData);
});

// Populate the dropdown with teams from the NHL API
populateDropdown();
