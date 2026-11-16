// Merges the three City of Chicago datasets into one list of buildings
// (used at build time by scripts/buildBuildings.mjs):
//   - Individual Landmarks (uct4-hrvh)
//   - Chicago Historic Resources Survey, Red & Orange (2u8t-236p)
//   - National Register of Historic Places (bqx3-yhry)
// enriched with data/chrs-details.json (style, architect, type).

import { normalizeFormNumber, chrsRowAddressKey, parseAddresses, streetKey } from '../../src/lib/address.js';

export function haversine(lat1, lng1, lat2, lng2) {
  const k = Math.PI / 180;
  const dLat = (lat2 - lat1) * k;
  const dLng = (lng2 - lng1) * k;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * k) * Math.cos(lat2 * k) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Outer-ring points of a (Multi)Polygon / Point. */
function outerRing(geom) {
  if (!geom) return [];
  if (geom.type === 'Point') return [geom.coordinates];
  if (geom.type === 'Polygon') return geom.coordinates[0] ?? [];
  if (geom.type === 'MultiPolygon') return geom.coordinates.flatMap((p) => p[0] ?? []);
  return [];
}

function centroid(geom) {
  const ring = outerRing(geom);
  if (!ring.length) return null;
  const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

function bbox(geom) {
  const ring = outerRing(geom);
  if (!ring.length) return null;
  const lats = ring.map((p) => p[1]);
  const lngs = ring.map((p) => p[0]);
  return [Math.min(...lats), Math.min(...lngs), Math.max(...lats), Math.max(...lngs)];
}

const KEEP_UPPER = new Set(['II', 'III', 'IV', 'YMCA', 'YWCA', 'CTA', 'USA', 'US', 'IIT', 'KAM', 'AME', 'CME']);

/** "BURNHAM, D.H., & CO." -> "Burnham, D.H., & Co.";  "MCKIM, MEAD & WHITE" -> "McKim, Mead & White" */
export function titleCase(s) {
  if (!s) return s;
  return s.toLowerCase().replace(/[a-z0-9.'’-]+/g, (w) => {
    const up = w.toUpperCase();
    if (KEEP_UPPER.has(up.replace(/\W/g, ''))) return up;
    if (/^([a-z]\.)+$/.test(w)) return up; // initials: d.h.
    if (/^\d/.test(w)) return w;
    let out = w.charAt(0).toUpperCase() + w.slice(1);
    out = out.replace(/^Mc([a-z])/, (_, c) => `Mc${c.toUpperCase()}`);
    // O'Brien, Smith-Jones; but not possessives like People's
    out = out.replace(/([-'’])([a-z])(?=[a-z])/g, (_, p, c) => p + c.toUpperCase());
    return out;
  });
}

/** Survey lists people surname-first: "Ohlhaber, William" -> "William Ohlhaber". Firms are left alone. */
export function naturalName(s) {
  if (!s) return s;
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 2 || !parts[1] || /&|\b(co|inc|company|associates|sons|bros)\b\.?/i.test(s)) return s;
  return `${parts[1]} ${parts[0]}`;
}

const looksLikeAddress = (s) => !s || s === 'null' || /^\d/.test(s.trim());

const formatChrsAddress = (r) => {
  const range = r.bldg_t_add && r.bldg_t_add !== r.bldg_f_add ? `${r.bldg_f_add}-${r.bldg_t_add}` : r.bldg_f_add;
  return titleCase([range, r.bldg_pre_d, r.bldg_st_name, r.bldg_st_type].filter(Boolean).join(' '));
};

const sameSide = (x, num) => x.lo % 2 !== x.hi % 2 || x.lo % 2 === num % 2;

/**
 * @returns {{ buildings: object[], districts: object[], stats: object }}
 * Building fields: key, name, historicName, address, yearBuilt, architect,
 *   styles (CHRS style names), type, chrsColor, landmarkId, landmarkDate,
 *   nationalRegister ('NR' | 'NHL'), lat, lng
 */
export function mergeBuildings({ chrsDetails, landmarks, chrs, nrhp }) {
  const record = (form) => {
    const rec = form && chrsDetails.records[form];
    if (!rec) return null;
    const [styleIdx = [], architect = null, historicName = null, typeIdx = null] = rec;
    return {
      styles: styleIdx.map((i) => chrsDetails.styles[i]).filter(Boolean),
      architect,
      historicName,
      type: typeIdx === null ? null : chrsDetails.types[typeIdx] ?? null,
    };
  };

  const out = new Map();
  const byForm = new Map();
  const stats = { landmarks: 0, chrs: 0, chrsMergedIntoLandmark: 0, chrsDuplicateFootprints: 0, nrMatched: 0, nrAdded: 0 };

  // 1. Individual Landmarks
  for (const lm of landmarks) {
    const c = centroid(lm.the_geom);
    if (!c) continue;
    const form = chrsDetails.landmarks[lm.id] ?? null;
    const survey = record(form);
    const b = {
      key: `L:${lm.id}`,
      name: lm.name?.replace(/\s+/g, ' ').trim(),
      historicName: survey?.historicName ? titleCase(survey.historicName) : null,
      address: lm.address,
      yearBuilt: lm.date_built || null,
      architect: lm.architect && lm.architect !== 'Unknown' ? lm.architect : survey?.architect ? naturalName(titleCase(survey.architect)) : null,
      styles: survey?.styles ?? [],
      type: survey?.type ? titleCase(survey.type) : null,
      chrsColor: null,
      landmarkId: lm.id,
      landmarkDate: lm.landmark ? lm.landmark.slice(0, 10) : null,
      nationalRegister: null,
      lat: c.lat,
      lng: c.lng,
    };
    out.set(b.key, b);
    if (form) byForm.set(form, b.key);
    stats.landmarks++;
  }

  // 2. CHRS survey buildings (merged into a landmark when they're the same building)
  const landmarkAddrs = [...out.values()].flatMap((b) =>
    parseAddresses(b.address).map((a) => ({ ...a, street: streetKey(a.dir, a.street), key: b.key }))
  );
  for (const r of chrs) {
    if (r.demolished === 'Y') continue;
    const lat = parseFloat(r.latitude);
    const lng = parseFloat(r.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const fn = normalizeFormNumber(r.form_number);
    const addrKey = chrsRowAddressKey(r);
    const form = (fn && chrsDetails.records[fn] ? fn : null) ?? (addrKey && chrsDetails.byAddress[addrKey]) ?? fn;
    const num = Number(r.bldg_f_add);
    const street = streetKey(r.bldg_pre_d, r.bldg_st_name);

    // Same building? Landmarks absorb survey rows within 150 m; survey rows
    // sharing a form number (often a row of identical houses) stay separate
    // unless they're footprints of one building (< 15 m apart).
    const near = (key) => {
      const b = key && out.get(key);
      return b && haversine(b.lat, b.lng, lat, lng) < (b.landmarkId ? 150 : 15) ? key : null;
    };
    const existingKey =
      near(form && byForm.get(form)) ||
      near(num && landmarkAddrs.find((x) => x.street === street && x.lo <= num && num <= x.hi && sameSide(x, num))?.key);
    if (existingKey) {
      const existing = out.get(existingKey);
      if (existing.landmarkId) stats.chrsMergedIntoLandmark++;
      else stats.chrsDuplicateFootprints++;
      existing.chrsColor ??= r.color || null;
      continue;
    }

    const survey = record(form);
    const decade = r.decade && r.decade !== '0' ? `${r.decade}s` : null;
    const s = Number(r.startyear);
    const e = Number(r.endyear);
    const years = s > 0 ? (e > s ? `${s}-${e}` : String(s)) : null;
    const b = {
      key: form && !out.has(`C:${form}`) ? `C:${form}` : `C:${form ?? 'x'}:${r.objectid}`,
      name: survey?.historicName ? titleCase(survey.historicName) : looksLikeAddress(r.landmarkna) ? null : titleCase(r.landmarkna),
      historicName: null,
      address: formatChrsAddress(r),
      yearBuilt: years ?? decade,
      architect: survey?.architect ? naturalName(titleCase(survey.architect)) : null,
      styles: survey?.styles ?? [],
      type: survey?.type ? titleCase(survey.type) : null,
      chrsColor: r.color || null,
      landmarkId: null,
      landmarkDate: null,
      nationalRegister: null,
      lat,
      lng,
    };
    out.set(b.key, b);
    if (form && !byForm.has(form)) byForm.set(form, b.key);
    stats.chrs++;
  }

  // 3. National Register: tag matching buildings, add the rest, collect districts
  const all = [...out.values()];
  const addrIndex = new Map(); // street -> [{lo, hi, b}]
  for (const b of all) {
    for (const a of parseAddresses(b.address)) {
      const k = streetKey(a.dir, a.street);
      if (!addrIndex.has(k)) addrIndex.set(k, []);
      addrIndex.get(k).push({ lo: a.lo, hi: a.hi, b });
    }
  }
  const districts = [];
  for (const nr of nrhp) {
    const code = nr.nhl_nr === 'NHL' ? 'NHL' : 'NR';
    if (nr.individual === 'D') {
      const box = bbox(nr.the_geom);
      if (box) districts.push({ name: nr.name, nationalRegister: code, bbox: box });
      continue;
    }
    const c = centroid(nr.the_geom);
    let match = null;
    for (const a of parseAddresses(nr.address)) {
      match ??= (addrIndex.get(streetKey(a.dir, a.street)) ?? []).find((x) => x.lo <= a.hi && a.lo <= x.hi)?.b;
    }
    if (!match && c) {
      match = all
        .map((b) => ({ b, d: haversine(c.lat, c.lng, b.lat, b.lng) }))
        .filter((x) => x.d < 20)
        .sort((x, y) => x.d - y.d)[0]?.b;
    }
    if (match) {
      if (match.nationalRegister !== 'NHL') match.nationalRegister = code;
      stats.nrMatched++;
    } else if (c) {
      out.set(`N:${nr.objectid ?? nr.name}`, {
        key: `N:${nr.objectid ?? nr.name}`,
        name: nr.name?.replace(/\s+/g, ' ').trim(),
        historicName: null,
        address: nr.address,
        yearBuilt: null,
        architect: null,
        styles: [],
        type: null,
        chrsColor: null,
        landmarkId: null,
        landmarkDate: null,
        nationalRegister: code,
        lat: c.lat,
        lng: c.lng,
      });
      stats.nrAdded++;
    }
  }

  return { buildings: [...out.values()], districts, stats };
}
