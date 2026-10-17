(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.NHLDailyGoalModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const teamCode = value => typeof value === 'string' && /^[A-Z]{2,3}$/.test(value) ? value : null;
  const priorRate = 0.12;
  const priorGames = 15;

  function eligibleLog(log, asOf, opponent) {
    if (!Array.isArray(log)) return [];
    const today = asOf.toISOString().slice(0, 10);
    const seen = new Set();
    return log.filter(row => {
      if (!row || typeof row.gameDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.gameDate) || row.gameDate >= today) return false;
      if (opponent && row.opponentAbbrev !== opponent) return false;
      if (count(row.goals) === null) return false;
      const id = row.gameId == null ? null : String(row.gameId);
      if (id && seen.has(id)) return false;
      if (id) seen.add(id);
      return true;
    }).sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  }

  function playerEstimate(row, team, opponent, recentLog, opponentLog, asOf) {
    const playerId = count(row.playerId ?? row.id);
    const goals = count(row.goals);
    const games = count(row.gamesPlayed);
    if (playerId === null || goals === null || games === null || games === 0) return null;
    const name = [row.firstName?.default ?? row.firstName, row.lastName?.default ?? row.lastName]
      .filter(part => typeof part === 'string' && part.trim()).join(' ') || row.name?.default || row.name;
    if (typeof name !== 'string' || !name.trim()) return null;
    const seasonLambda = (goals + priorGames * priorRate) / (games + priorGames);
    const recent = eligibleLog(recentLog, asOf).slice(0, 5);
    const against = eligibleLog(opponentLog, asOf, opponent);
    // Only observed game logs can contribute occurrence evidence. Totals alone yield
    // a Poisson one-plus estimate; they cannot establish a goal-scoring hit rate.
    let probability = 1 - Math.exp(-seasonLambda);
    const seasonProbability = probability;
    if (recent.length) {
      const hits = recent.filter(game => game.goals > 0).length;
      const shrunk = (hits + 10 * seasonProbability) / (recent.length + 10);
      probability = 0.75 * probability + 0.25 * shrunk;
    }
    if (against.length) {
      const hits = against.filter(game => game.goals > 0).length;
      const shrunk = (hits + 20 * seasonProbability) / (against.length + 20);
      probability = 0.85 * probability + 0.15 * shrunk;
    }
    const pct = Math.round(Math.min(0.95, Math.max(0, probability)) * 100);
    const reason = `${goals} goals in ${games} season games; season scoring rate shrunk toward a prior rate.` +
      (recent.length ? ` Scored in ${recent.filter(game => game.goals > 0).length} of ${recent.length} recent games.` : '') +
      (against.length ? ` Scored in ${against.filter(game => game.goals > 0).length} of ${against.length} logged games versus ${opponent}.` : '') +
      ' Percentage is a model estimate, not a guaranteed outcome.';
    return { playerId, name: name.trim(), team, estimatedGoalPct: pct, reason,
      factors: { seasonGoals: goals, seasonGames: games, recentGames: recent.length,
        opponentGames: against.length, method: 'shrunk Poisson one-plus with observed log adjustments' } };
  }

  function rankGoalScorers(input, options = {}) {
    const asOf = new Date(options?.asOf ?? new Date());
    if (!Number.isFinite(asOf.getTime())) throw new TypeError('Invalid asOf date');
    const { games = [], teamStats = {}, recentByPlayer = {}, opponentByPlayer = {} } = input || {};
    if (!Array.isArray(games)) return [];
    return games.filter(game => game && ['FUT', 'PRE'].includes(game.gameState) &&
      (!game.startTimeUTC || Date.parse(game.startTimeUTC) > asOf.getTime())).map(game => {
      const home = teamCode(game.homeTeam?.abbrev);
      const away = teamCode(game.awayTeam?.abbrev);
      if (!home || !away) return null;
      const picks = [];
      for (const [team, opponent] of [[home, away], [away, home]]) {
        const source = teamStats[team];
        const skaters = Array.isArray(source) ? source : source?.skaters;
        if (!Array.isArray(skaters)) continue;
        for (const row of skaters) {
          if (!row || row.positionCode === 'G' || row.position === 'G') continue;
          const id = row.playerId ?? row.id;
          const estimate = playerEstimate(row, team, opponent, recentByPlayer[id], opponentByPlayer[id], asOf);
          if (estimate) picks.push(estimate);
        }
      }
      picks.sort((a, b) => b.estimatedGoalPct - a.estimatedGoalPct || a.name.localeCompare(b.name));
      return { gameId: game.id ?? game.gameId, picks: picks.slice(0, Math.max(3, count(options.limit) || 3)) };
    }).filter(Boolean);
  }

  return { rankGoalScorers };
});
