/**
 * Vercel Serverless Function — NHL API Proxy
 *
 * Routes: /api/nhl/** via vercel.json rewrite
 * Proxies all requests server-side to https://api-web.nhle.com/v1/**
 *
 * Why: api-web.nhle.com does not send CORS headers for browser requests
 * from localhost or non-NHL origins. Proxying through Vercel avoids this
 * entirely because the request goes server → NHL API (no browser CORS check).
 */
module.exports = async function handler(req, res) {
  // req.query.path is the catch-all segment array, e.g. ['standings', 'now']
  if (req.method && req.method !== 'GET') return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'GET required.' } });
  const { path = '' } = req.query || {};
  const pathStr = Array.isArray(path) ? path.join('/') : String(path);
  if (!pathStr || pathStr.length > 200 || !pathStr.split('/').every(part => /^[A-Za-z0-9-]+$/.test(part)))
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid NHL API path.' } });

  // Forward all query params except the internal 'path' param
  const forwarded = new URLSearchParams();
  for (const [k, v] of Object.entries(req.query || {})) {
    if (k === 'path') continue;
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(k)) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query parameter.' } });
    for (const item of (Array.isArray(v) ? v : [v])) {
      if (typeof item !== 'string' || item.length > 200) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query value.' } });
      forwarded.append(k, item);
    }
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
    res.status(502).json({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'NHL data is temporarily unavailable.' } });
  }
};
