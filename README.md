# nhlcheck

A lightweight static web app for viewing NHL player stats, standings, and live scores. No build step required — just open `index.html` in a browser.

## Features

- **Team Stats** — Select any NHL team to view skater and goalie stats for the current season (goals, assists, points, +/-, save %, GAA, and more)
- **Standings** — Division standings with W/L/OTL, points, goal differential, and streaks
- **Today's Scores** — Live, final, and upcoming games with scores and game clocks

## How to Use

1. Open `index.html` in any modern browser
2. Use the tabs to switch between Team Stats, Standings, and Today's Scores
3. In the Team Stats tab, select a team from the dropdown to load player stats

## Tech

- Vanilla HTML/JS with [Tailwind CSS v3](https://tailwindcss.com) (play CDN)
- Uses the [NHL Web API](https://api-web.nhle.com) — no API key required
- Player stats fetched in parallel via `Promise.all`
- Season is derived dynamically from the current date
