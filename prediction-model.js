(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  else root.NHLPlayerModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LABELS = { goals: 'Goals', assists: 'Assists', points: 'Points', shots: 'Shots on Goal' };
  const BASE_WEIGHTS = { season: 0.45, recent: 0.35, opponent: 0.20 };
  const count = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const abbreviation = value => typeof value === 'string' && /^[a-z]{2,3}$/i.test(value.trim()) ? value.trim().toUpperCase() : null;

  function statValue(row, stat) {
    if (stat === 'shots' && row.shots == null) return count(row.shotsOnGoal);
    const value = count(row[stat]);
    if (stat !== 'points' || value !== null) return value;
    const goals = count(row.goals);
    const assists = count(row.assists);
    return goals !== null && assists !== null ? count(goals + assists) : null;
  }

  /** Return unique, newest-first completed calendar-day records; unknown stats remain null.
   * Today's UTC calendar date is excluded because a date alone cannot prove completion.
   * Duplicate IDs keep the first eligible row in source order. Missing IDs are not deduplicated.
   */
  function normalizeGames(gameLog, options = {}) {
    const asOf = new Date(options?.asOf ?? new Date());
    if (!Number.isFinite(asOf.getTime()) || !Array.isArray(gameLog)) return [];
    const cutoff = asOf.toISOString().slice(0, 10);
    const seen = new Set();
    const rows = [];
    for (const row of gameLog) {
      if (!row || typeof row !== 'object') continue;
      const date = row.gameDate;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const parsed = new Date(`${date}T00:00:00Z`);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date || date >= cutoff) continue;
      const id = (typeof row.gameId === 'string' && row.gameId.trim()) || (count(row.gameId) !== null ? String(row.gameId) : null);
      if (id !== null && seen.has(id)) continue;
      if (id !== null) seen.add(id);
      const normalized = { ...row, gameDate: date, opponentAbbrev: abbreviation(row.opponentAbbrev) };
      for (const stat of Object.keys(LABELS)) normalized[stat] = statValue(row, stat);
      rows.push(normalized);
    }
    return rows.sort((a, b) => b.gameDate.localeCompare(a.gameDate));
  }

  function summarize(rows, stat) {
    const values = rows.map(row => row[stat]).filter(value => value !== null);
    return {
      games: values.length,
      rate: values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null,
      hitRate: values.length ? values.filter(value => value >= 1).length / values.length : null,
    };
  }

  function shrink(sample, baseline, priorGames) {
    if (!sample.games) return null;
    if (baseline === null) return sample.rate;
    const observedWeight = sample.games / (sample.games + priorGames);
    return observedWeight * sample.rate + (1 - observedWeight) * baseline;
  }

  /** Estimate counts/game, never probabilities. Hit rates describe observed >=1 games.
   * Recent and opponent rates use 5 and 10 baseline pseudo-games respectively.
   * Available component weights are renormalized separately for each statistic.
   * recentLog optionally isolates current-season form from multi-season opponent history.
   */
  function calculateProps(seasonStats, gameLog, opponent, options = {}) {
    options = options || {};
    const season = seasonStats && typeof seasonStats === 'object' ? seasonStats : {};
    const games = normalizeGames(gameLog, options);
    const current = Object.prototype.hasOwnProperty.call(options, 'recentLog') ? normalizeGames(options.recentLog, options) : games;
    const window = count(options.recentGames) > 0 ? options.recentGames : 5;
    const recentRows = current.slice(0, window);
    const opponentAbbrev = abbreviation(opponent);
    const opponentRows = opponentAbbrev ? games.filter(row => row.opponentAbbrev === opponentAbbrev) : [];
    const gp = count(season.gamesPlayed);
    const result = {};
    for (const [stat, label] of Object.entries(LABELS)) {
      const total = statValue(season, stat);
      const seasonRate = gp > 0 && total !== null ? total / gp : null;
      const baseline = seasonRate ?? summarize(current, stat).rate;
      const baselineSource = seasonRate !== null ? 'season' : baseline !== null ? 'observed-history' : null;
      const recent = summarize(recentRows, stat);
      recent.shrunkRate = shrink(recent, baseline, 5);
      recent.uplift = recent.rate !== null && baseline !== null ? recent.rate - baseline : null;
      recent.streak = current.length && current[0][stat] !== null ? 0 : null;
      for (const row of current) {
        if (row[stat] === null || row[stat] < 1) break;
        recent.streak++;
      }
      const against = summarize(opponentRows, stat);
      against.shrinkageApplied = against.games > 0 && baseline !== null;
      // Matchup observations alone cannot establish an independent projection baseline.
      against.shrunkRate = against.shrinkageApplied ? shrink(against, baseline, 10) : null;
      const rates = { season: seasonRate, recent: recent.shrunkRate, opponent: against.shrunkRate };
      const availableWeight = Object.keys(rates).reduce((sum, key) => sum + (rates[key] === null ? 0 : BASE_WEIGHTS[key]), 0);
      const weights = {};
      let projected = availableWeight ? 0 : null;
      for (const key of Object.keys(rates)) {
        weights[key] = rates[key] === null ? 0 : BASE_WEIGHTS[key] / availableWeight;
        if (rates[key] !== null) projected += weights[key] * rates[key];
      }
      result[stat] = { label, projected, seasonRate, baselineRate: baseline, baselineSource, recent, opponent: against, weights };
    }
    return result;
  }

  return { calculateProps, normalizeGames };
});
