# NHLCheck

Vanilla HTML/JavaScript NHL statistics, standings, scores, and player projections. Vercel serves static files and the `api/` Node functions. NHL data comes through the same-origin proxy; opening `index.html` as a local file or using GitHub Pages alone does not provide those API routes.

## Development and validation

Use Node.js 24 (matching Vercel). Run `npm ci`, then `npm run dev` with an authenticated Vercel CLI and the intended project selected. `npm test` uses Node's built-in test runner with deterministic fixtures; `npm run lint` checks syntax of every JavaScript file without additional dependencies. There is no bundling build, TypeScript check, or Makefile. Tests do not require live NHL access or API keys.

`npm run deploy:preview` creates a Vercel preview. The legacy `npm run deploy` command targets production: do not use it for review. Review and merge changes separately. GitHub PR validation runs lint and tests. Existing main-only Pages and daily-cache workflows are retained.

## Player projections

Open a player under **Top Scorers**. Each goals, assists, points, and shots card shows a projected count per game, recent scoring streak, recent lift, and observed 1+ frequencies with valid sample counts. Percentages are historical frequencies, **not probabilities or confidence estimates**. No synthetic sportsbook lines or OVER/UNDER picks are produced for players.

For each stat, the base weights are **45% season, 35% recent, 20% opponent**:

- Season baseline: total / games played for the current regular season only. The exact-season landing totals are preferred; explicitly season-matched featured totals are a fallback. Old totals are never substituted for current season totals.
- Recent form: mean of valid observations among the latest five current-season regular-season games. This captures hot/cold form in the weighted algorithm. Displayed lift is recent mean minus baseline in counts/game; active 1+ streak counts consecutive known scoring games, stopping at a zero or missing value. A missing newest value means an unknown streak. A streak ending at an unknown older value is only the observed consecutive run, not a claim about unavailable games.
- Opponent: per-player games against the verified next opponent across the current and previous regular seasons, without the old 20-game truncation. Historical 1+ percentage = games with at least one / games with a valid stat. This is separate from average goals or points per game.
- Shrinkage: `(n * sampleMean + k * baseline) / (n + k)`, with `k=5` for recent form and `k=10` for opponent history. If season totals are missing, the valid current-season game-log mean supplies the shrinkage baseline. Without a baseline, historical opponent frequencies remain visible but cannot produce a projection.
- Final projection: weighted mean of available component rates, renormalizing weights separately per stat. Missing components are omitted, never replaced with zero. The card shows effective weights. A real zero remains zero; no evidence produces an em dash.

These are transparent heuristic weights, not fitted or calibrated predictive parameters. Recent and opponent samples may overlap season evidence. Future evaluation should use rolling date cutoffs and out-of-sample error/calibration checks before treating outputs as predictive probabilities. `asOf` is a filtering clock, not a historical backtest loader: live season totals must not be used as historical snapshots.

## Data quality and scope

`player-data.js` verifies the player's current team from the landing response before selecting the earliest future FUT/PRE game on that team's season schedule (regular season or playoffs). A cached leader's team is display-only if the current team is unavailable. There is no claimed matchup in that case. The projection training history remains regular-season-only even for a playoff matchup; playoff-specific form, injuries, lineup status, ice time, and goalie changes are not modeled.

Current and previous game logs load independently with ten-second timeouts. Failures produce visible warnings and preserve available evidence. Dates are sorted, repeated game IDs deduplicated, and invalid counts excluded per statistic. Points may be derived from goals plus assists only when both are valid. Date-only records on today's UTC calendar date and future dates are conservatively excluded; current-day completed games therefore appear in form calculations after UTC rollover. Season totals are live aggregates and may update sooner. Fetch time is shown, not represented as the upstream observation time.

Daily leaders cache is accepted only for the current season and within 36 hours; otherwise live leaders are fetched. Season selection follows the existing October UTC rollover convention. This is not a career opponent history. A player with no current-season baseline gets no opponent-only projection.

## Architecture and operations

- `main.js`: tab rendering and modal integration; request generation guard prevents stale modal responses.
- `player-data.js`: validated player context acquisition through existing proxy routes.
- `prediction-model.js`: pure CommonJS/browser-compatible projection functions.
- `api/nhl/[...path].js`: existing NHL proxy. `api/odds.js` reads optional server-side `ODDS_API_KEY`; player projections require no key. `api/scrape-stats.js` supplies existing team metrics.
- `data/`: cached leader responses refreshed by the daily workflow. `general_index.md` describes all tracked files.

No API endpoints were added or modified in this change. The separate team-game prediction model in Today's Scores is unchanged and its existing confidence display is not calibrated by this player model. Keep `.env*` and `.vercel/` local. The lockfile updates the existing transitive Undici dependency to resolve the audit finding; no new dependency was introduced.
