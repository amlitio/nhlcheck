/**
 * Vercel Serverless Function — NHL API Proxy
 *
 * Routes: /api/nhl/**
 * Proxies all requests server-side to https://api-web.nhle.com/v1/**
 *
 * Why: api-web.nhle.com does not send CORS headers for browser requests
 * from localhost or non-NHL origins. Proxying through Vercel avoids this
 * entirely because the request goes server → NHL API (no browser CORS check).
 */
module.exports = async function handler(req, res) {
  // req.query.path is the catch-all segment array, e.g. ['standings', 'now']
  const { path = [] } = req.query;
  const pathStr = Array.isArray(path) ? path.join('/') : String(path);

  // Forward all query params except the internal 'path' param
  const forwarded = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query)) {
    if (k !== 'path') forwarded.append(k, v);
  }
  const qs = forwarded.toString();
  const targetUrl = `https://api-web.nhle.com/v1/${pathStr}${qs ? '?' + qs : ''}`;

  try {
    const upstream = await fetch(targetUrl, {
      headers: {
        Accept: 'application/json',
        // Identify ourselves politely to the NHL API
        'User-Agent': 'NHLCheck/2.0 (github.com/amlitio/nhlcheck)',
      },
    });

    const body = await upstream.text();

    res.setHeader('Content-Type', 'application/json');
    // Cache at Vercel edge for 60 s; serve stale for up to 5 min after that
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.status(upstream.status).end(body);
  } catch (err) {
    res.status(500).json({ error: `Proxy error: ${err.message}`, target: targetUrl });
  }
};
