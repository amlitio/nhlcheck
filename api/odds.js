/**
 * Vercel Serverless Function — The Odds API proxy
 *
 * GET /api/odds
 * Returns today's NHL game moneyline + totals from The Odds API (free tier).
 *
 * Caching: Vercel edge caches this response for 6 hours.
 * At most 4 cache misses/day × 30 days = 120 requests/month — well under 500 free limit.
 *
 * Required env var: ODDS_API_KEY  (set in .env.local and Vercel dashboard)
 */

// Full NHL team names (as The Odds API uses) → ESPN abbreviations
const NAME_TO_ABBREV = {
  'Anaheim Ducks':         'ANA',
  'Utah Hockey Club':      'UTA',
  'Boston Bruins':         'BOS',
  'Buffalo Sabres':        'BUF',
  'Calgary Flames':        'CGY',
  'Carolina Hurricanes':   'CAR',
  'Chicago Blackhawks':    'CHI',
  'Colorado Avalanche':    'COL',
  'Columbus Blue Jackets': 'CBJ',
  'Dallas Stars':          'DAL',
  'Detroit Red Wings':     'DET',
  'Edmonton Oilers':       'EDM',
  'Florida Panthers':      'FLA',
  'Los Angeles Kings':     'LA',
  'Minnesota Wild':        'MIN',
  'Montreal Canadiens':    'MTL',
  'Nashville Predators':   'NSH',
  'New Jersey Devils':     'NJD',
  'New York Islanders':    'NYI',
  'New York Rangers':      'NYR',
  'Ottawa Senators':       'OTT',
  'Philadelphia Flyers':   'PHI',
  'Pittsburgh Penguins':   'PIT',
  'San Jose Sharks':       'SJS',
  'Seattle Kraken':        'SEA',
  'St. Louis Blues':       'STL',
  'Tampa Bay Lightning':   'TB',
  'Toronto Maple Leafs':   'TOR',
  'Vancouver Canucks':     'VAN',
  'Vegas Golden Knights':  'VGK',
  'Washington Capitals':   'WSH',
  'Winnipeg Jets':         'WPG',
};

// Preferred sportsbooks in priority order
const BOOK_PRIORITY = ['draftkings', 'fanduel', 'betmgm', 'barstool', 'bovada', 'williamhill_us'];

module.exports = async function handler(req, res) {
  const key = process.env.ODDS_API_KEY;
  if (!key) {
    // Return empty array so the UI degrades gracefully rather than errors
    res.setHeader('Cache-Control', 's-maxage=300');
    return res.status(200).json([]);
  }

  try {
    const url = new URL('https://api.the-odds-api.com/v4/sports/icehockey_nhl/odds/');
    url.searchParams.set('apiKey', key);
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', 'h2h,totals');
    url.searchParams.set('oddsFormat', 'american');
    url.searchParams.set('dateFormat', 'iso');

    const upstream = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });

    if (!upstream.ok) {
      const text = await upstream.text();
      return res.status(upstream.status).json({ error: `Odds API: ${upstream.status}`, detail: text });
    }

    const games = await upstream.json();

    const normalized = games.map(game => {
      // Pick the best available bookmaker
      const book = BOOK_PRIORITY.reduce((found, k) =>
        found ?? game.bookmakers.find(b => b.key === k), null)
        ?? game.bookmakers[0];

      if (!book) return null;

      const h2h    = book.markets.find(m => m.key === 'h2h');
      const totals = book.markets.find(m => m.key === 'totals');

      const homeAbbrev = NAME_TO_ABBREV[game.home_team];
      const awayAbbrev = NAME_TO_ABBREV[game.away_team];
      if (!homeAbbrev || !awayAbbrev) return null; // unknown team

      const homeOdds = h2h?.outcomes.find(o => o.name === game.home_team)?.price ?? null;
      const awayOdds = h2h?.outcomes.find(o => o.name === game.away_team)?.price ?? null;
      const overLine = totals?.outcomes.find(o => o.name === 'Over');

      return {
        // Key used by frontend to match ESPN scoreboard games
        matchKey:     `${awayAbbrev}_${homeAbbrev}`,
        homeAbbrev,
        awayAbbrev,
        homeOdds,      // American odds, e.g. -140 or +120
        awayOdds,
        total:         overLine?.point  ?? null,  // e.g. 5.5
        overOdds:      overLine?.price  ?? null,
        commenceTime:  game.commence_time,
        bookmaker:     book.title,
      };
    }).filter(Boolean);

    // Cache at Vercel edge for 6 hours; serve stale for up to 12 hours
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=43200');
    res.status(200).json(normalized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
