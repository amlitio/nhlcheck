(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NHLPlayerData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const validTeam = value => typeof value === 'string' && /^[A-Z]{2,3}$/.test(value);
  const numeric = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

  function seasonTotals(landing, season) {
    const rows = (Array.isArray(landing?.seasonTotals) ? landing.seasonTotals : [])
      .filter(row => row && row.leagueAbbrev === 'NHL' && row.gameTypeId === 2 && Number(row.season) === season);
    // The API can publish this season's featured totals before adding seasonTotals.
    // Only its explicit season marker permits this fallback; career totals never qualify.
    if (!rows.length) {
      const featured = landing?.featuredStats;
      const subSeason = featured?.regularSeason?.subSeason;
      if (Number(featured?.season) !== season || !subSeason || typeof subSeason !== 'object' || Array.isArray(subSeason)) return null;
      rows.push(subSeason);
    }
    const combined = rows.find(row => row.teamAbbrev === 'TOT' ||
      /^(total|\d+ teams)$/i.test(row.teamName?.default || ''));
    const selected = combined ? [combined] : rows.filter((row, index) =>
      rows.findIndex(other => JSON.stringify(other) === JSON.stringify(row)) === index);
    const result = {};
    for (const field of ['gamesPlayed', 'goals', 'assists', 'points', 'shots']) {
      result[field] = selected.every(row => numeric(row[field]))
        ? selected.reduce((sum, row) => sum + row[field], 0) : null;
    }
    return result;
  }

  /** Load dated NHL evidence; null denotes unavailable data, while [] denotes a valid empty log. */
  async function loadPlayerContext(playerId, fallbackTeam, { fetchImpl = fetch, asOf = new Date() } = {}) {
    if (!/^\d+$/.test(String(playerId))) throw new TypeError('Invalid player ID');
    const now = new Date(asOf);
    if (!Number.isFinite(now.getTime())) throw new TypeError('Invalid asOf date');
    const year = now.getUTCFullYear() - (now.getUTCMonth() < 9 ? 1 : 0);
    const season = year * 10000 + year + 1;
    const previousSeason = (year - 1) * 10000 + year;
    const warnings = [];
    async function get(path, label, validate) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetchImpl('/api/nhl/' + path, { signal: controller.signal });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const data = await response.json();
        if (!validate(data)) throw new Error('Invalid response shape');
        return data;
      } catch (_) {
        warnings.push(label + ' unavailable');
        return null;
      } finally { clearTimeout(timeout); }
    }
    const landing = await get('player/' + playerId + '/landing', 'Player profile', data =>
      data !== null && typeof data === 'object' && !Array.isArray(data) &&
      (Array.isArray(data.seasonTotals) || validTeam(data.currentTeamAbbrev) ||
        Number.isInteger(data.featuredStats?.season)));
    const verifiedTeam = validTeam(landing?.currentTeamAbbrev) ? landing.currentTeamAbbrev : null;
    const teamAbbrev = verifiedTeam || (validTeam(fallbackTeam) ? fallbackTeam : null);
    if (!verifiedTeam) warnings.push('Current team unverified; upcoming matchup unavailable');
    const validLog = data => data && Array.isArray(data.gameLog);
    const [current, previous, schedule] = await Promise.all([
      get('player/' + playerId + '/game-log/' + season + '/2', 'Current season game log', validLog),
      get('player/' + playerId + '/game-log/' + previousSeason + '/2', 'Previous season game log', validLog),
      verifiedTeam ? get('club-schedule-season/' + verifiedTeam + '/' + season, 'Team schedule',
        data => data && Array.isArray(data.games)) : Promise.resolve(null),
    ]);
    function cleanLog(data) {
      if (!data) return null;
      const rows = data.gameLog.filter(row => row && typeof row === 'object' &&
        Number.isFinite(Date.parse(row.gameDate)) && Date.parse(row.gameDate) <= now.getTime());
      if (rows.length !== data.gameLog.length) warnings.push('Invalid or future game log rows excluded');
      return rows.sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));
    }
    const currentGameLog = cleanLog(current);
    const previousGameLog = cleanLog(previous);
    const seen = new Set();
    const gameLog = [...(currentGameLog || []), ...(previousGameLog || [])]
      .filter(row => {
        const key = row.gameId ?? (row.gameDate + ':' + row.opponentAbbrev);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => Date.parse(b.gameDate) - Date.parse(a.gameDate));
    const nextGame = (schedule?.games || []).filter(game => game &&
      ['FUT', 'PRE'].includes(game.gameState) && game.gameScheduleState === 'OK' && [2, 3].includes(game.gameType) &&
      Date.parse(game.startTimeUTC) > now.getTime() &&
      validTeam(game.homeTeam?.abbrev) && validTeam(game.awayTeam?.abbrev) &&
      [game.homeTeam.abbrev, game.awayTeam.abbrev].includes(teamAbbrev))
      .sort((a, b) => Date.parse(a.startTimeUTC) - Date.parse(b.startTimeUTC))[0] || null;
    const nextOpponent = nextGame ? (nextGame.homeTeam.abbrev === teamAbbrev
      ? nextGame.awayTeam.abbrev : nextGame.homeTeam.abbrev) : null;
    const stats = seasonTotals(landing, season);
    if (!stats) warnings.push('Current season totals unavailable');
    return { seasonStats: stats, gameLog, currentGameLog, previousGameLog, nextGame, nextOpponent,
      landing, teamAbbrev, warnings, season, fetchedAt: now.toISOString() };
  }
  return { loadPlayerContext };
});
