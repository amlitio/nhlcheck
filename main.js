const API_BASE_URL = 'https://statsapi.web.nhl.com/api/v1';

const teamSelect = document.getElementById('team-select');
const statsContainer = document.getElementById('stats-container');
const loadingIndicator = document.getElementById('loading-indicator');

// Function to display loading indicator
function showLoadingIndicator() {
  loadingIndicator.style.display = 'block';
  statsContainer.style.display = 'none';
}

// Function to hide loading indicator
function hideLoadingIndicator() {
  loadingIndicator.style.display = 'none';
  statsContainer.style.display = 'block';
}

// Function to populate the dropdown with teams from the API
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
  } catch (error) {
    console.error('Error fetching teams:', error);
    teamSelect.disabled = true; // Disable the dropdown on error
  }
}

// Function to fetch the roster for the selected team from the API
async function fetchTeamRoster() {
  const selectedTeamId = teamSelect.value;

  try {
    showLoadingIndicator();
    const response = await axios.get(`${API_BASE_URL}/teams/${selectedTeamId}/roster`);
    const roster = response.data.roster;

    // Clear the statsContainer
    statsContainer.innerHTML = '';

    if (roster.length > 0) {
      // Display player stats
      statsContainer.innerHTML = `<h2>Roster for selected team:</h2>`;
      roster.forEach((player) => {
        statsContainer.innerHTML += `<p>${player.person.fullName} - ${player.position.name}</p>`;
      });
    } else {
      statsContainer.innerHTML = '<p>No players found for the selected team.</p>';
    }

    hideLoadingIndicator();
  } catch (error) {
    hideLoadingIndicator();
    console.error('Error fetching team roster:', error);
    statsContainer.innerHTML = '<p>An error occurred while fetching player stats.</p>';
  }
}

// Add event listener for when a team is selected
teamSelect.addEventListener('change', fetchTeamRoster);

// Populate the dropdown with teams from the API
populateDropdown();
