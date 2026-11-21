// Read-only proxy for NHL EDGE goal-event tracking sprites.
// No interpolation or synthetic trajectories are generated.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET required' });
  const { gameId, eventId } = req.query || {};
  if (!/^20\d{8}$/.test(String(gameId || '')) || !/^\d{1,8}$/.test(String(eventId || '')))
    return res.status(400).json({ error: 'Invalid game or event ID' });
  const season = String(gameId).slice(0, 4);
  const url = 'https://wsr.nhle.com/sprites/' + season + '/' + gameId + '/ev' + eventId + '.json';
  try {
    const upstream = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(9000) });
    if (upstream.status === 404) return res.status(404).json({ error: 'Tracking not published for this goal' });
    if (!upstream.ok) return res.status(502).json({ error: 'Tracking source unavailable' });
    const body = await upstream.text();
    if (body.length > 3000000) return res.status(502).json({ error: 'Tracking response exceeds limit' });
    let parsed;
    try { parsed = JSON.parse(body); } catch { return res.status(502).json({ error: 'Invalid tracking response' }); }
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json(parsed);
  } catch { return res.status(502).json({ error: 'Tracking request failed' }); }
};
