/**
 * Vercel Serverless Function — Natural Stat Trick advanced stats scraper
 *
 * GET /api/scrape-stats
 * Returns 5v5 team advanced stats for the current NHL season.
 * Scraped from naturalstattrick.com using cheerio.
 *
 * Response shape:
 *   { "BOS": { cfPct: 53.2, xgfPct: 54.1, hdcfPct: 51.8, sfPct: 52.3 }, ... }
 *
 * Caching: 3 hours at Vercel edge — stats don't change mid-game significantly.
 */

const cheerio = require('cheerio');

// NST full team names → ESPN abbreviations (same mapping as odds.js)
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

function getCurrentSeason() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1;
  const start = month >= 10 ? year : year - 1;
  return `${start}${start + 1}`;
}

module.exports = async function handler(req, res) {
  try {
    const season = getCurrentSeason();
    const nstUrl = `https://www.naturalstattrick.com/teamtable.php?fromseason=${season}&thruseason=${season}&stype=2&sit=5v5&score=all&rate=n&team=all&loc=B&gpf=&gpt=&fd=&td=`;

    const page = await fetch(nstUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NHLCheck/1.0; +https://github.com/amlitio/nhlcheck)',
        'Accept':     'text/html,application/xhtml+xml',
      },
    });

    if (!page.ok) throw new Error(`NST returned HTTP ${page.status}`);

    const html = await page.text();
    const $    = cheerio.load(html);

    // Locate the table that contains a 'CF%' column header
    let targetTable = null;
    $('table').each((_, table) => {
      const hasCF = $(table).find('th').toArray()
        .some(th => $(th).text().trim() === 'CF%');
      if (hasCF) {
        targetTable = table;
        return false; // break $.each
      }
    });

    if (!targetTable) {
      throw new Error('Could not find CF% table on NST page — structure may have changed');
    }

    // Parse the header row to find column indices by name
    const headers = $(targetTable).find('th').toArray()
      .map(th => $(th).text().trim());

    const col = name => headers.findIndex(h => h === name);
    const cf_idx   = col('CF%');
    const xgf_idx  = col('xGF%');
    const hdcf_idx = col('HDCF%');
    const sf_idx   = col('SF%');

    if (cf_idx === -1 || xgf_idx === -1) {
      throw new Error('Required columns (CF%, xGF%) not found in NST table');
    }

    // Parse each team row
    const result = {};
    $(targetTable).find('tbody tr').each((_, row) => {
      const cells = $(row).find('td').toArray();
      if (!cells.length) return;

      const teamName = $(cells[0]).text().trim();
      const abbrev   = NAME_TO_ABBREV[teamName];
      if (!abbrev) return; // unknown team name — skip

      const parseCell = idx =>
        idx !== -1 ? (parseFloat($(cells[idx]).text().trim()) || null) : null;

      result[abbrev] = {
        cfPct:   parseCell(cf_idx),
        xgfPct:  parseCell(xgf_idx),
        hdcfPct: parseCell(hdcf_idx),
        sfPct:   parseCell(sf_idx),
      };
    });

    if (!Object.keys(result).length) {
      throw new Error('No team rows parsed — NST table structure may have changed');
    }

    // Cache at Vercel edge for 3 hours; serve stale for up to 6 hours
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 's-maxage=10800, stale-while-revalidate=21600');
    res.status(200).json(result);
  } catch (err) {
    // Return empty object on failure so prediction model degrades gracefully
    console.error('scrape-stats error:', err.message);
    res.setHeader('Cache-Control', 's-maxage=300'); // short cache on error
    res.status(200).json({ _error: err.message });
  }
};
