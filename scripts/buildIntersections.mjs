// Builds netlify/lib/intersections.json: an index of every Chicago
// street intersection, so "Milwaukee & Damen" can be geocoded instantly and
// for free, without relying on a third-party geocoder.
//
// Source: City of Chicago street center lines (data.cityofchicago.org pr57-gg9e).
// Each segment has from/to node ids; two streets intersect where they share a node.
//
// Output: { streets: { "DAMEN": [nodeIdx, ...] }, nodes: [[lat, lng], ...] }
//
// Usage (from chiarch/): node scripts/buildIntersections.mjs

import fs from 'node:fs';
import path from 'node:path';

const DATASET = 'https://data.cityofchicago.org/resource/pr57-gg9e.json';
const OUT = path.join(process.cwd(), 'netlify/lib/intersections.json');
const PAGE = 20000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset, attempts = 6) {
  const url = new URL(DATASET);
  url.searchParams.set('$select', 'street_nam,fnode_id,tnode_id,the_geom');
  url.searchParams.set('$order', 'objectid');
  url.searchParams.set('$limit', String(PAGE));
  url.searchParams.set('$offset', String(offset));
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      const data = await res.json();
      if (Array.isArray(data)) return data;
      throw new Error(JSON.stringify(data).slice(0, 120));
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`  retry ${i} at offset ${offset}: ${err.message}`);
      await sleep(2000 * i);
    }
  }
}

const firstLine = (geom) => (geom?.type === 'MultiLineString' ? geom.coordinates[0] : geom?.coordinates);
const lastLine = (geom) => (geom?.type === 'MultiLineString' ? geom.coordinates.at(-1) : geom?.coordinates);

async function main() {
  const nodeCoords = new Map(); // node id -> [lat, lng]
  const streetNodes = new Map(); // street name -> Set(node id)

  for (let offset = 0; ; offset += PAGE) {
    const rows = await fetchPage(offset);
    console.log(`  ${offset + rows.length} segments`);
    for (const r of rows) {
      const name = r.street_nam?.trim().toUpperCase();
      const start = firstLine(r.the_geom)?.[0];
      const end = lastLine(r.the_geom)?.at(-1);
      if (!name || !start || !end) continue;
      const set = streetNodes.get(name) ?? streetNodes.set(name, new Set()).get(name);
      for (const [id, [lng, lat]] of [[r.fnode_id, start], [r.tnode_id, end]]) {
        if (!id) continue;
        set.add(id);
        if (!nodeCoords.has(id)) nodeCoords.set(id, [Number(lat.toFixed(6)), Number(lng.toFixed(6))]);
      }
    }
    if (rows.length < PAGE) break;
  }

  // Only nodes shared by 2+ streets are intersections; drop the rest to save space.
  const count = new Map();
  for (const set of streetNodes.values()) for (const id of set) count.set(id, (count.get(id) ?? 0) + 1);
  const keep = [...nodeCoords.keys()].filter((id) => count.get(id) > 1);
  const index = new Map(keep.map((id, i) => [id, i]));

  const streets = {};
  for (const [name, set] of [...streetNodes].sort(([a], [b]) => a.localeCompare(b))) {
    const ids = [...set].filter((id) => index.has(id)).map((id) => index.get(id));
    if (ids.length) streets[name] = ids;
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      source: 'https://data.cityofchicago.org/d/pr57-gg9e',
      generated: new Date().toISOString().slice(0, 10),
      streets,
      nodes: keep.map((id) => nodeCoords.get(id)),
    })
  );
  console.log(`\nSaved ${Object.keys(streets).length} streets, ${keep.length} intersections to ${OUT}`);
  console.log(`  file size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
