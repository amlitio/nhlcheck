# General Codebase Index

Generated dependency/build folders are excluded. Update this map when file purpose or structure changes.

| File | Purpose |
|---|---|
| `.gitignore` | Excludes dependencies, credentials, deployment metadata, and generated local files. |
| `.github/FUNDING.yml` | Defines repository sponsorship links. |
| `.github/workflows/static.yml` | Deploys the existing static site to GitHub Pages on main updates. |
| `.github/workflows/daily-cache.yml` | Refreshes and commits NHL leaders cache on its daily schedule. |
| `.github/workflows/test.yml` | Validates pull requests and non-main branches with Node 24 syntax checks and tests. |
| `LICENSE` | Repository licensing terms. |
| `README.md` | Setup, validation, model mathematics, data limitations, and deployment workflow. |
| `general_index.md` | Project-wide map of meaningful tracked files. |
| `package.json` | Defines dependencies and development, validation, and deployment commands. |
| `package-lock.json` | Pins dependency versions, including the existing scraper dependency tree. |
| `index.html` | Page tabs, player modal shell, styles, and browser script loading order. |
| `tailwind.css` | Existing Tailwind styling directives. |
| `main.js` | Renders stats, scores, leaders, and evidence-based player projection cards. |
| `player-data.js` | Loads verified team, next matchup, current totals, and two seasons of player logs. |
| `prediction-model.js` | Pure weighted per-stat projection, sample shrinkage, empirical rates, and streak logic. |
| `vercel.json` | Configures Vercel NHL proxy rewrite and cached-data response headers. |
| `api/nhl.js` | Existing same-origin serverless proxy to NHL Web API paths. |
| `api/odds.js` | Existing server-side NHL bookmaker odds adapter with optional secret key. |
| `api/scrape-stats.js` | Existing Natural Stat Trick team-stat scraper using Cheerio. |
| `data/.gitkeep` | Preserves the cache directory before generated snapshots exist. |
| `data/meta.json` | Records cached leader season and refresh timestamp. |
| `data/leaders-points.json` | Cached points leaders from the NHL API. |
| `data/leaders-goals.json` | Cached goals leaders from the NHL API. |
| `data/leaders-assists.json` | Cached assists leaders from the NHL API. |
| `scripts/check-js.js` | Runs dependency-free node --check syntax validation across JavaScript sources. |
| `test/prediction-model.test.js` | Verifies weighted math, shrinkage, missing values, history filtering, and browser export. |
| `test/player-data.test.js` | Mocks NHL responses to verify season/team selection, schedule sorting, and partial outages. |
| `test/player-ui.test.js` | Checks modal rendering, escaping, missing evidence, and asynchronous request races. |
| `test/nhl-proxy.test.js` | Verifies the Vercel NHL rewrite contract, roster response, and proxy error handling. |
| `api/daily-goal-picks.js` | Returns roster-verified current-day goal scorer estimates for upcoming NHL games. |
| `daily-goal-model.js` | Pure ranking and shrunk goal-scoring percentage estimates with short reasoning. |
| `test/daily-goal-picks-api.test.js` | Checks endpoint validation, completed-game behavior, and upstream error handling. |
| `test/daily-goal-model.test.js` | Checks ranking, percentage bounds, missing data, and date cutoffs. |
