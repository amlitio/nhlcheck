const axios = require('axios');

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

// Fetch NHL teams from the API and populate the dropdown
axios.get('https://statsapi.web.nhl.com/api/v1/teams')
    .then(response => {
        const teams = response.data.teams;
        teams.forEach(team => {
            const option = document.createElement('option');
            option.value = team.id;
            option.textContent = team.name;
            teamSelect.appendChild(option);
        });
    })
    .catch(error => {
        console.error('Error fetching teams:', error);
        teamSelect.disabled = true; // Disable the dropdown on error
    });

// Event listener for when a team is selected
teamSelect.addEventListener('change', () => {
    showLoadingIndicator();

    const selectedTeamId = teamSelect.value;

    // Fetch stats for the selected team from the API
    axios.get(`https://statsapi.web.nhl.com/api/v1/teams/${selectedTeamId}/roster`)
        .then(response => {
            hideLoadingIndicator();
            const roster = response.data.roster;

            // Clear the statsContainer
            statsContainer.innerHTML = '';

            if (roster.length > 0) {
                // Display player stats
                statsContainer.innerHTML = `<h2>Roster for selected team:</h2>`;
                roster.forEach(player => {
                    statsContainer.innerHTML += `<p>${player.person.fullName} - ${player.position.name}</p>`;
                });
            } else {
                statsContainer.innerHTML = '<p>No players found for the selected team.</p>';
            }
        })
        .catch(error => {
            hideLoadingIndicator();
            console.error('Error fetching team roster:', error);
            statsContainer.innerHTML = '<p>An error occurred while fetching player stats.</p>';
        });
});
