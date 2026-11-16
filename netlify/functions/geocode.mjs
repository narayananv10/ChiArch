// POST /api/geocode  { q: "Milwaukee & Damen" }  ->  { lat, lng, label, source }
//
// 1. Cross streets: instant lookup in the city street-centerline index (free, no API)
// 2. Mapbox, bounded to Chicago (if MAPBOX_TOKEN is set)
// 3. OpenStreetMap Nominatim, bounded to Chicago

import { findIntersection, splitCrossStreets } from '../lib/intersections.mjs';

// Chicago bounding box: west, south, east, north
const BBOX = [-87.9402, 41.6445, -87.5239, 42.023];
const USER_AGENT = 'ChiArch/0.1 (https://github.com/narayananv10/ChiArch)';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

const inChicago = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && lng >= BBOX[0] && lng <= BBOX[2] && lat >= BBOX[1] && lat <= BBOX[3];

async function mapbox(q, token) {
  const url = new URL(`https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json`);
  url.searchParams.set('access_token', token);
  url.searchParams.set('bbox', BBOX.join(','));
  url.searchParams.set('limit', '1');
  // Mapbox only parses "X and Y" as an intersection when restricted to addresses
  if (splitCrossStreets(q)) url.searchParams.set('types', 'address');
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Mapbox HTTP ${res.status}`);
  const data = await res.json();
  const f = data?.features?.[0];
  const [lng, lat] = f?.center ?? [];
  return inChicago(lat, lng) ? { lat, lng, label: f.place_name, source: 'mapbox' } : null;
}

async function nominatim(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', /chicago/i.test(q) ? q : `${q}, Chicago, IL`);
  url.searchParams.set('format', 'json');
  url.searchParams.set('limit', '1');
  url.searchParams.set('viewbox', BBOX.join(','));
  url.searchParams.set('bounded', '1');
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) return null;
  const lat = parseFloat(data[0].lat);
  const lng = parseFloat(data[0].lon);
  return inChicago(lat, lng) ? { lat, lng, label: data[0].display_name, source: 'nominatim' } : null;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let q;
  try {
    ({ q } = await req.json());
  } catch {
    return json({ error: 'bad_request' }, 400);
  }
  if (typeof q !== 'string' || !q.trim() || q.length > 200) return json({ error: 'bad_request' }, 400);
  q = q.trim();

  const crossing = findIntersection(q);
  if (crossing) return json({ ...crossing, source: 'intersection' });

  const errors = [];
  if (process.env.MAPBOX_TOKEN) {
    try {
      const hit = await mapbox(q, process.env.MAPBOX_TOKEN);
      if (hit) return json(hit);
    } catch (err) {
      errors.push(err.message);
    }
  }
  try {
    const hit = await nominatim(q);
    if (hit) return json(hit);
  } catch (err) {
    errors.push(err.message);
  }

  if (errors.length) console.error('Geocoding upstream errors:', errors);
  return json({ error: 'not_found' }, 404);
};

export const config = {
  path: '/api/geocode',
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
