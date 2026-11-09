// Geocode Chicago cross streets ("Milwaukee & Damen") from a prebuilt index of
// city street center lines. See scripts/buildIntersections.mjs.

import index from './intersections.json' with { type: 'json' };

const DIRECTIONS = new Set(['N', 'S', 'E', 'W', 'NORTH', 'SOUTH', 'EAST', 'WEST']);
const TYPES = new Set([
  'AV', 'AVE', 'AVENUE', 'ST', 'STREET', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE', 'PL',
  'PLACE', 'RD', 'ROAD', 'CT', 'COURT', 'PKWY', 'PARKWAY', 'TER', 'TERRACE', 'WAY',
  'LN', 'LANE', 'HWY', 'SQ', 'PLZ', 'CIR', 'ROW', 'EXPY', 'EXPRESSWAY',
]);
const ALIASES = {
  MLK: 'DR MARTIN LUTHER KING JR',
  'MARTIN LUTHER KING': 'DR MARTIN LUTHER KING JR',
  'KING': 'DR MARTIN LUTHER KING JR',
  LSD: 'LAKE SHORE',
  'LAKE SHORE DRIVE': 'LAKE SHORE',
  'CONGRESS': 'IDA B WELLS',
};

const compact = (s) => s.replace(/[^A-Z0-9]/g, '');

// compact name -> official names, e.g. "LASALLE" -> ["LA SALLE"]
const byCompact = new Map();
for (const name of Object.keys(index.streets)) {
  const key = compact(name);
  byCompact.set(key, [...(byCompact.get(key) ?? []), name]);
}

const ordinal = (n) => {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}TH`;
  return `${n}${{ 1: 'ST', 2: 'ND', 3: 'RD' }[n % 10] ?? 'TH'}`;
};

/** "N. Milwaukee Ave" -> "MILWAUKEE"; "18" -> "18TH"; "LaSalle St" -> "LASALLE" */
export function normalizeStreetInput(text) {
  let words = text
    .toUpperCase()
    .replace(/[.,']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && DIRECTIONS.has(words[0])) words = words.slice(1);
  if (words.length > 1 && TYPES.has(words.at(-1))) words = words.slice(0, -1);
  const phrase = words.map((w) => (/^\d+$/.test(w) ? ordinal(Number(w)) : w)).join(' ');
  return ALIASES[phrase] ?? phrase;
}

function streetNames(input) {
  const key = compact(normalizeStreetInput(input));
  if (!key) return [];
  if (byCompact.has(key)) return byCompact.get(key);
  // Fall back to a unique partial match, e.g. "MARTIN LUTHER KING JR" -> "DR MARTIN LUTHER KING JR"
  if (key.length < 5) return [];
  const partial = [...byCompact.keys()].filter((k) => k.includes(key));
  return partial.length === 1 ? byCompact.get(partial[0]) : [];
}

/** Split "Milwaukee & Damen" / "LaSalle and Madison" / "18th / Halsted" into two streets. */
export function splitCrossStreets(query) {
  const cleaned = query
    .replace(/,?\s*(chicago)?\s*,?\s*(il|illinois)?\s*(\d{5})?\s*$/i, '')
    .trim();
  const parts = cleaned.split(/\s*(?:&|\+|\/|@|\band\b|\bat\b)\s*/i).filter(Boolean);
  return parts.length === 2 ? parts : null;
}

const distanceM = ([lat1, lng1], [lat2, lng2]) => {
  const k = Math.PI / 180;
  const x = (lng2 - lng1) * k * Math.cos(((lat1 + lat2) / 2) * k);
  const y = (lat2 - lat1) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
};

/**
 * Returns { lat, lng, label, matches } for the crossing of two streets, or null.
 * Divided roads meet at several nearby nodes; those are averaged. If two streets
 * cross in more than one place (e.g. a diagonal), `matches` > 1 and the first
 * crossing is returned.
 */
export function findIntersection(query) {
  const parts = splitCrossStreets(query);
  if (!parts) return null;
  const [a, b] = parts.map(streetNames);
  if (!a.length || !b.length || a.some((n) => b.includes(n))) return null;

  const nodesA = new Set(a.flatMap((n) => index.streets[n]));
  const shared = [...new Set(b.flatMap((n) => index.streets[n]))].filter((i) => nodesA.has(i));
  if (!shared.length) return null;

  // Cluster nodes within 150 m of each other
  const clusters = [];
  for (const i of shared) {
    const p = index.nodes[i];
    const c = clusters.find((cl) => distanceM(cl[0], p) < 150);
    if (c) c.push(p);
    else clusters.push([p]);
  }
  const first = clusters[0];
  return {
    lat: first.reduce((s, p) => s + p[0], 0) / first.length,
    lng: first.reduce((s, p) => s + p[1], 0) / first.length,
    label: `${a[0]} & ${b[0]}`,
    matches: clusters.length,
  };
}
