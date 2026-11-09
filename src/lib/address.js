// Address normalization shared by the data scripts and the app, so both sides
// build identical lookup keys.

const STREET_TYPES = new Set([
  'AV', 'AVE', 'AVENUE', 'ST', 'STREET', 'BLVD', 'BOULEVARD', 'DR', 'DRIVE',
  'PL', 'PLACE', 'RD', 'ROAD', 'CT', 'COURT', 'PKWY', 'PARKWAY', 'TER',
  'TERRACE', 'WAY', 'LN', 'LANE', 'HWY', 'HIGHWAY', 'SQ', 'SQUARE', 'PLZ',
  'PLAZA', 'CIR', 'CIRCLE', 'ROW', 'WALK',
]);

const DIRS = { N: 'N', S: 'S', E: 'E', W: 'W', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W' };

const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/;

/** Upper-case street name without direction or type, e.g. "W. Aldine Avenue" -> "ALDINE". */
export function normalizeStreet(name) {
  if (!name) return '';
  const words = String(name)
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (ORDINAL.test(w) ? w.replace(ORDINAL, '$1') : w));
  if (words.length > 1 && STREET_TYPES.has(words[words.length - 1])) words.pop();
  // Joined without spaces so "LA SALLE" and "LaSalle" compare equal
  return words.join('');
}

/**
 * Parse a free-text address such as "833 W. Aldine Avenue", "410 S. Michigan Ave.",
 * "(722-722) N ELIZABETH ST" or "1-23 E MONROE ST".
 * Returns { lo, hi, dir, street } or null.
 */
export function parseAddress(text) {
  if (!text) return null;
  const m = String(text)
    .toUpperCase()
    .replace(/[()]/g, '')
    .trim()
    .match(/^(\d+)(?:\s*-\s*(\d+))?\s+(NORTH|SOUTH|EAST|WEST|[NSEW])\.?\s+(.+)$/);
  if (!m) return null;
  const lo = Number(m[1]);
  let hi = m[2] ? Number(m[2]) : lo;
  // Abbreviated ranges: "2117-39" means 2117-2139
  if (m[2] && m[2].length < m[1].length) {
    hi = Number(m[1].slice(0, m[1].length - m[2].length) + m[2]);
  }
  return { lo, hi: Math.max(lo, hi), dir: DIRS[m[3]], street: normalizeStreet(m[4]) };
}

/** All addresses in a field like "121 N LaSalle St / 118 N Clark St" or "320 E Cermak Rd & 2132 S Calumet Ave". */
export function parseAddresses(text) {
  if (!text) return [];
  return String(text)
    .split(/\s*(?:\/|&|;|\band\b)\s*/i)
    .map(parseAddress)
    .filter(Boolean);
}

/** Key for one street (direction + name), used to index address ranges. */
export const streetKey = (dir, street) => `${dir}|${normalizeStreet(street)}`;

/** CHRS form numbers lose their leading zero in the open dataset ("84211039.0"). */
export function normalizeFormNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n).padStart(9, '0');
}

/** Address lookup key for an open-dataset CHRS row (2u8t-236p). */
export function chrsRowAddressKey(row) {
  const num = Number(row.bldg_f_add);
  if (!num || !row.bldg_pre_d || !row.bldg_st_name) return null;
  return `${streetKey(row.bldg_pre_d, row.bldg_st_name)}|${num}`;
}
