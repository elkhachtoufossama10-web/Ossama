// Minimal server-side relays for public APIs that send no CORS headers (no secrets involved).
// 1) NOAA Aviation Weather Center METAR API.
// Only bounding-box METAR queries are allowed; responses are cached for 5 minutes to respect AWC's limits
// (https://aviationweather.gov/data/api/ asks clients to stay under 100 requests/minute).
const UPSTREAM = 'https://aviationweather.gov/api/data/metar';
const USER_AGENT = `earth-observatory/0.1 (${process.env.CONTACT || 'educational weather explorer'})`;
const cache = new Map();

/** fetch with one retry: upstream connections occasionally stall */
async function fetchRetry(url) {
  for (let i = 0; ; i++) {
    try {
      return await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10000) });
    } catch (e) {
      if (i >= 1) throw e;
    }
  }
}
let windowStart = Date.now();
let count = 0;

export async function handleMetar(reqUrl, res) {
  const u = new URL(reqUrl, 'http://local');
  const bbox = u.searchParams.get('bbox') || '';
  const parts = bbox.split(',').map(Number);
  const valid = parts.length === 4 && parts.every(Number.isFinite) &&
    parts[0] >= -90 && parts[2] <= 90 && parts[0] < parts[2] && parts[1] >= -180 && parts[3] <= 180 && parts[1] < parts[3] &&
    parts[2] - parts[0] <= 8 && parts[3] - parts[1] <= 12;
  if (!valid) return send(res, 400, { error: 'bbox must be "minLat,minLon,maxLat,maxLon" spanning at most 8°×12°' });
  const key = parts.map((p) => p.toFixed(2)).join(',');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < 5 * 60e3) return send(res, 200, hit.body, true);
  if (Date.now() - windowStart > 60e3) { windowStart = Date.now(); count = 0; }
  if (++count > 60) return send(res, 429, { error: 'rate limited' });
  try {
    const r = await fetchRetry(`${UPSTREAM}?bbox=${key}&format=json`);
    if (r.status === 204) { cache.set(key, { t: Date.now(), body: '[]' }); return send(res, 200, '[]', true); }
    if (!r.ok) return send(res, 502, { error: `upstream HTTP ${r.status}` });
    const body = await r.text();
    JSON.parse(body); // refuse to relay anything that is not JSON
    cache.set(key, { t: Date.now(), body });
    if (cache.size > 500) cache.delete(cache.keys().next().value);
    send(res, 200, body, true);
  } catch (e) {
    send(res, 502, { error: 'upstream unavailable' });
  }
}

function send(res, status, body, raw = false) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(raw ? body : JSON.stringify(body));
}

// Open-Meteo publishes model run metadata (run time, update interval) as static JSON without CORS headers.
const META_ALLOWED = new Set(['ecmwf_ifs025']);
const metaCache = new Map();
export async function handleModelMeta(reqUrl, res) {
  const model = new URL(reqUrl, 'http://local').searchParams.get('model') || '';
  if (!META_ALLOWED.has(model)) return send(res, 400, { error: 'unknown model' });
  const hit = metaCache.get(model);
  if (hit && Date.now() - hit.t < 5 * 60e3) return send(res, 200, hit.body, true);
  try {
    const r = await fetchRetry(`https://api.open-meteo.com/data/${model}/static/meta.json`);
    if (!r.ok) return send(res, 502, { error: `upstream HTTP ${r.status}` });
    const body = await r.text();
    JSON.parse(body);
    metaCache.set(model, { t: Date.now(), body });
    send(res, 200, body, true);
  } catch {
    send(res, 502, { error: 'upstream unavailable' });
  }
}
