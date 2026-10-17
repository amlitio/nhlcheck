/**
 * GET /api/daily-goal-picks?date=YYYY-MM-DD
 * Returns scheduled NHL games and estimated goal scorers for games yet to start.
 * Query: required viewer-local calendar date (within one UTC day of today).
 * Response: {date, games:[{id, awayTeam, homeTeam, state, picks, reason?}]}.
 * Errors: 400 invalid date, 405 method, 502 unavailable NHL feed. No authentication.
 */
const { rankGoalScorers } = require('../daily-goal-model');
const BASE = 'https://api-web.nhle.com/v1';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'NHLCheck/2.0 (github.com/amlitio/nhlcheck)' };

async function nhl(path) {
  const response = await fetch(`${BASE}/${path}`, { headers: HEADERS, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('upstream status');
  return response.json();
}
function error(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}
function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  return Math.abs(parsed.getTime() - Date.now()) <= 2 * 86400000;
}
async function mapLimit(items, limit, operation) {
  let next = 0;
  const results = Array(items.length);
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await operation(items[index]);
    }
  }));
  return results;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return error(res, 405, 'METHOD_NOT_ALLOWED', 'GET required.');
  const date = req.query && req.query.date;
  if (!validDate(date)) return error(res, 400, 'VALIDATION_ERROR', 'A current date in YYYY-MM-DD format is required.');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=300');
  let schedule;
  try { schedule = await nhl(`score/${date}`); }
  catch { return error(res, 502, 'UPSTREAM_UNAVAILABLE', 'NHL schedule is temporarily unavailable.'); }
  if (!Array.isArray(schedule.games)) return error(res, 502, 'UPSTREAM_UNAVAILABLE', 'NHL schedule is temporarily unavailable.');
  const games = schedule.games.filter(g => g && [2, 3].includes(g.gameType)).map(g => ({
    id: g.id, gameState: g.gameState, startTimeUTC: g.startTimeUTC,
    awayTeam: g.awayTeam, homeTeam: g.homeTeam, season: g.season, gameType: g.gameType,
  }));
  const pending = games.filter(g => ['FUT', 'PRE'].includes(g.gameState));
  if (!pending.length) return res.status(200).json({ date, games: games.map(g => ({ id: g.id, awayTeam: g.awayTeam?.abbrev, homeTeam: g.homeTeam?.abbrev, state: g.gameState, picks: [], reason: 'Game already started or finished.' })) });
  const clubs = [...new Set(pending.flatMap(g => [g.awayTeam?.abbrev, g.homeTeam?.abbrev]).filter(Boolean))];
  const seasons = new Map(pending.flatMap(g => [[g.awayTeam?.abbrev, g.season], [g.homeTeam?.abbrev, g.season]]));
  const gameTypes = new Map(pending.flatMap(g => [[g.awayTeam?.abbrev, g.gameType], [g.homeTeam?.abbrev, g.gameType]]));
  const teamStats = {};
  await mapLimit(clubs, 4, async team => {
    try {
      const [data, roster] = await Promise.all([
        nhl(`club-stats/${team}/${seasons.get(team)}/${gameTypes.get(team)}`), nhl(`roster/${team}/current`),
      ]);
      const active = new Set([...(roster.forwards || []), ...(roster.defensemen || [])].map(p => p.id));
      teamStats[team] = (data.skaters || []).filter(p => active.has(p.playerId) && Number.isInteger(p.playerId) && p.gamesPlayed > 0)
        .sort((a, b) => (b.goals / b.gamesPlayed) - (a.goals / a.gamesPlayed)).slice(0, 10);
    } catch { teamStats[team] = []; }
  });
  const players = [...new Set(clubs.flatMap(team => teamStats[team].map(p => p.playerId)))];
  const recentByPlayer = {};
  const opponentByPlayer = {};
  const playerTeam = new Map(clubs.flatMap(team => teamStats[team].map(p => [p.playerId, team])));
  await mapLimit(players, 6, async id => {
    try {
      const log = await nhl(`player/${id}/game-log/${seasons.get(playerTeam.get(id))}/${gameTypes.get(playerTeam.get(id))}`);
      const past = (Array.isArray(log.gameLog) ? log.gameLog : []).filter(g => g.gameDate < date);
      recentByPlayer[id] = past;
      const opponent = pending.find(g => [g.awayTeam?.abbrev, g.homeTeam?.abbrev].includes(playerTeam.get(id)));
      const other = opponent?.awayTeam?.abbrev === playerTeam.get(id) ? opponent?.homeTeam?.abbrev : opponent?.awayTeam?.abbrev;
      opponentByPlayer[id] = past.filter(g => g.opponentAbbrev === other);
      const stat = teamStats[playerTeam.get(id)].find(p => p.playerId === id);
      stat.goals = past.reduce((sum, g) => sum + (Number(g.goals) || 0), 0);
      stat.gamesPlayed = past.length;
    } catch {
      recentByPlayer[id] = [];
      opponentByPlayer[id] = [];
      const stat = teamStats[playerTeam.get(id)].find(p => p.playerId === id);
      stat.goals = 0;
      stat.gamesPlayed = 0;
    }
  });
  const ranked = rankGoalScorers({ games: pending, teamStats, recentByPlayer, opponentByPlayer }, { asOf: date });
  const byGame = new Map(ranked.map(item => [item.gameId, item.picks]));
  return res.status(200).json({ date, games: games.map(g => {
    const picks = byGame.get(g.id) || [];
    return { id: g.id, awayTeam: g.awayTeam?.abbrev, homeTeam: g.homeTeam?.abbrev, state: g.gameState, picks,
      ...(picks.length < 3 ? { reason: ['FUT', 'PRE'].includes(g.gameState) ? 'Insufficient verified player data for three picks.' : 'Game already started or finished.' } : {}) };
  }) });
};
