const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');

// Function to fetch all players and their stats for a specific team and season
async function fetchTeamRosterAndStats(teamId, season) {
  try {
    // Fetch the team's roster
    const rosterResponse = await axios.get(`${API_BASE_URL}/teams/${teamId}/roster`);
    const roster = rosterResponse.data.roster;

    // Array to store player data including stats
    const playerData = [];

    for (const player of roster) {
      const playerId = player.person.id;
      
      // Fetch player stats for the specified season
      const playerStatsResponse = await axios.get(`${API_BASE_URL}/people/${playerId}/stats?stats=statsSingleSeason&season=${season}`);
      const playerStatsData = playerStatsResponse.data.stats[0].splits[0].stat;

      playerData.push({
        playerName: player.person.fullName,
        playerStats: playerStatsData,
      });
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
  const selectedTeamId = teamSelect.value;

  // Replace '20232024' with the desired season, e.g., '20222023'
  const season = '20232024';

  const playerData = await fetchTeamRosterAndStats(selectedTeamId, season);

  updateStatsContainer(playerData);
});

// Populate the dropdown with NHL teams from the API
populateDropdown();
