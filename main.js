const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');

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

// Function to fetch team stats based on the selected team
async function fetchTeamStats(teamId) {
  try {
    const response = await axios.get(`${API_BASE_URL}/teams/${teamId}`);
    const teamStats = response.data;

    return teamStats;
  } catch (error) {
    console.error('Error fetching team stats:', error);
    return null;
  }
}

// Function to update the stats container with the team's statistics
function updateStatsContainer(teamStats) {
  if (teamStats) {
    statsContainer.innerHTML = `
      <h2>Stats for ${teamStats.name}:</h2>
      <pre>${JSON.stringify(teamStats, null, 2)}</pre>
    `;
  } else {
    statsContainer.innerHTML = '<p>An error occurred while fetching team stats.</p>';
  }
}

// Event listener for when a team is selected
teamSelect.addEventListener('change', async () => {
  const selectedTeamId = teamSelect.value;

  const teamStats = await fetchTeamStats(selectedTeamId);

  updateStatsContainer(teamStats);
}

// Populate the dropdown with NHL teams from the API
populateDropdown();
