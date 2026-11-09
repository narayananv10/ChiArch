// Builds data/chrs-details.json: architecture style, architect, historic
// name and (with --details) building type for Chicago Historic Resources Survey
// (CHRS) buildings, plus links from Individual Landmarks to their CHRS record.
//
// Why: the open CHRS dataset (data.cityofchicago.org 2u8t-236p) has location,
// decade and color rating but no style or architect. The city's full CHRS
// search app (webapps1.chicago.gov/landmarksweb/search) has both. Records are
// joined by CHRS form number (zero-padded to 9 digits), falling back to
// address for open-dataset rows whose form number is 0 or doesn't match.
//
// Usage (from chiarch/):
//   node scripts/fetchChrsDetails.mjs            # styles + architects (~36 requests)
//   node scripts/fetchChrsDetails.mjs --details  # also each building's type (~1 request per building; resumable)

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseAddress,
  parseAddresses,
  streetKey,
  normalizeFormNumber,
  chrsRowAddressKey,
} from '../src/lib/address.js';

const BASE = 'https://webapps1.chicago.gov/landmarksweb/search';
const SOCRATA = 'https://data.cityofchicago.org/resource';
const OUT = path.join(process.cwd(), 'data/chrs-details.json');
const DETAIL_CACHE = path.join(process.cwd(), 'scripts/.cache/chrs-detail-cache.json');
const DELAY_MS = 1000; // be polite to the city's server
const WITH_DETAILS = process.argv.includes('--details');

// The city's pages are served as Windows-1252, not UTF-8 (e.g. "façade")
function decodeBody(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchText(url, options = {}, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { ...options, signal: AbortSignal.timeout(300_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeBody(await res.arrayBuffer());
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`  retry ${i} for ${url}: ${err.message}`);
      await sleep(DELAY_MS * 2 ** i);
    }
  }
}

// Socrata intermittently answers HTTP 200 with {"message":"Service unavailable"}
async function fetchSocrata(dataset, query, attempts = 6) {
  const url = `${SOCRATA}/${dataset}.json?${query}`;
  for (let i = 1; i <= attempts; i++) {
    const data = JSON.parse(await fetchText(url));
    if (Array.isArray(data)) return data;
    if (i === attempts) throw new Error(`Socrata error: ${JSON.stringify(data)}`);
    await sleep(DELAY_MS * 2 ** i);
  }
}

// Style names come from the search form's <select name="style">
async function getStyles() {
  const html = await fetchText(`${BASE}/home.htm`);
  const start = html.indexOf('name="style"');
  const end = html.indexOf('</select>', start);
  return [...html.slice(start, end).matchAll(/<option value="([^"]*)"/g)]
    .map((m) => decode(m[1]))
    .filter((v) => v && v !== 'All');
}

// Result rows: address, historic name, decade, architect, community
async function search(style = 'All') {
  const body = new URLSearchParams({
    architect: 'All',
    streetName: 'All',
    year: 'All',
    community: 'All',
    style,
  });
  const html = await fetchText(`${BASE}/searchresult.htm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const rows = [];
  for (const [, tr] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const link = tr.match(/searchdetail\.htm\?pin=(\d*)&(?:amp;)?formNumber=(\d+)/);
    // Real buildings have 9-digit form numbers; a few 2-digit entries are
    // district-wide placeholders spanning hundreds of addresses, so skip them.
    if (!link || link[2].length !== 9) continue;
    const [address, name, decade, architect, community] = [
      ...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g),
    ].map((m) => decode(m[1]));
    rows.push({ pin: link[1], formNumber: link[2], address, name, decade, architect, community });
  }
  return rows;
}

// Detail page is a table of <th>Label:</th><td>value</td> rows
export function parseDetail(html) {
  const field = (label) => {
    const m = html.match(new RegExp(`<th>\\s*${label}:\\s*</th>\\s*<td>([\\s\\S]*?)</td>`, 'i'));
    return (m && decode(m[1])) || null;
  };
  // (The page also has "Constructed: Started in", but the City leaves it blank.)
  return { type: field('Type'), majorTenant: field('Major Tenant') };
}

async function fetchDetail(pin, formNumber) {
  return parseDetail(await fetchText(`${BASE}/searchdetail.htm?pin=${pin}&formNumber=${formNumber}`));
}

async function main() {
  // 1. Full survey (one request, ~17k rows) for architect + historic name
  console.log('Fetching full CHRS survey...');
  const all = await search('All');
  const survey = new Map(); // formNumber -> entry
  const byStreet = new Map(); // "N|CLARK" -> [{lo, hi, formNumber}]
  for (const r of all) {
    if (!survey.has(r.formNumber)) survey.set(r.formNumber, { ...r, styles: [] });
    const a = parseAddress(r.address);
    if (a) {
      const k = streetKey(a.dir, a.street);
      if (!byStreet.has(k)) byStreet.set(k, []);
      byStreet.get(k).push({ lo: a.lo, hi: a.hi, formNumber: r.formNumber });
    }
  }
  console.log(`  ${all.length} rows, ${survey.size} unique buildings`);

  // Odd and even numbers are on opposite sides of a Chicago street, so a range
  // like 1214-1218 must not match 1215. Prefer the narrowest matching range.
  const findByAddress = (dir, street, num) => {
    const candidates = (byStreet.get(streetKey(dir, street)) ?? []).filter(
      (x) =>
        x.lo <= num &&
        num <= x.hi &&
        (x.lo % 2 !== x.hi % 2 || x.lo % 2 === num % 2)
    );
    candidates.sort((a, b) => a.hi - a.lo - (b.hi - b.lo));
    return candidates[0]?.formNumber ?? null;
  };

  // 2. One search per style to tag styles
  const styles = await getStyles();
  console.log(`Tagging ${styles.length} styles...`);
  for (const style of styles) {
    await sleep(DELAY_MS);
    const rows = await search(style);
    for (const r of rows) {
      const e = survey.get(r.formNumber) ?? survey.set(r.formNumber, { ...r, styles: [] }).get(r.formNumber);
      if (!e.styles.includes(style)) e.styles.push(style);
    }
    console.log(`  ${style}: ${rows.length}`);
  }

  // 3. Join the open CHRS dataset
  console.log('Joining open CHRS dataset (2u8t-236p)...');
  const open = await fetchSocrata(
    '2u8t-236p',
    '$select=form_number,bldg_f_add,bldg_pre_d,bldg_st_name&$limit=50000'
  );
  const used = new Set();
  const byAddress = {};
  let viaForm = 0;
  let viaAddress = 0;
  for (const row of open) {
    const fn = normalizeFormNumber(row.form_number);
    if (fn && survey.has(fn)) {
      used.add(fn);
      viaForm++;
      continue;
    }
    const key = chrsRowAddressKey(row);
    const match = key && findByAddress(row.bldg_pre_d, row.bldg_st_name, Number(row.bldg_f_add));
    if (match) {
      byAddress[key] = match;
      used.add(match);
      viaAddress++;
    }
  }
  console.log(`  ${open.length} rows: ${viaForm} by form number, ${viaAddress} by address, ${open.length - viaForm - viaAddress} unmatched`);

  // 4. Link Individual Landmarks to CHRS (for style + de-duplication)
  console.log('Linking Individual Landmarks (uct4-hrvh)...');
  const landmarksData = await fetchSocrata('uct4-hrvh', '$select=id,name,address&$limit=5000');
  const landmarks = {};
  for (const lm of landmarksData) {
    let match = null;
    for (const a of parseAddresses(lm.address)) {
      for (const num of new Set([a.lo, a.hi])) {
        match ??= findByAddress(a.dir, a.street, num);
      }
    }
    if (match) {
      landmarks[lm.id] = match;
      used.add(match);
    }
  }
  console.log(`  ${Object.keys(landmarks).length}/${landmarksData.length} landmarks linked`);

  // 5. Optional: building type from each detail page
  if (WITH_DETAILS) {
    fs.mkdirSync(path.dirname(DETAIL_CACHE), { recursive: true });
    const cache = fs.existsSync(DETAIL_CACHE) ? JSON.parse(fs.readFileSync(DETAIL_CACHE, 'utf8')) : {};
    const todo = [...used].filter((fn) => survey.get(fn)?.pin && !(fn in cache));
    console.log(`Fetching details for ${todo.length} buildings (${Object.keys(cache).length} cached)...`);
    let n = 0;
    for (const fn of todo) {
      await sleep(DELAY_MS / 2);
      try {
        cache[fn] = await fetchDetail(survey.get(fn).pin, fn);
      } catch (err) {
        console.warn(`  failed ${fn}: ${err.message}`);
        continue;
      }
      // Safety check: if parsing breaks, stop early instead of crawling everything for nothing
      if (++n === 50 && !todo.slice(0, 50).some((f) => cache[f]?.type)) {
        throw new Error('First 50 detail pages had no building type: the page layout may have changed');
      }
      if (n % 100 === 0) {
        fs.writeFileSync(DETAIL_CACHE, JSON.stringify(cache));
        console.log(`  ${n}/${todo.length}`);
      }
    }
    fs.writeFileSync(DETAIL_CACHE, JSON.stringify(cache));
    for (const fn of used) Object.assign(survey.get(fn), cache[fn] ?? {});
  } else if (fs.existsSync(DETAIL_CACHE)) {
    // Reuse details from an earlier --details run
    const cache = JSON.parse(fs.readFileSync(DETAIL_CACHE, 'utf8'));
    for (const fn of used) Object.assign(survey.get(fn), cache[fn] ?? {});
  }

  // 6. Compact output: shared lookup tables + one short array per building.
  // record = [styleIdx[], architect, historicName, typeIdx, majorTenant]
  const usedEntries = [...used].sort().map((fn) => survey.get(fn));
  const types = [...new Set(usedEntries.map((e) => e.type).filter(Boolean))].sort();
  const records = {};
  for (const e of usedEntries) {
    const rec = [
      e.styles.map((s) => styles.indexOf(s)),
      e.architect || null,
      e.name || null,
      e.type ? types.indexOf(e.type) : null,
      e.majorTenant || null,
    ];
    while (rec.length && (rec.at(-1) === null || (Array.isArray(rec.at(-1)) && !rec.at(-1).length))) rec.pop();
    if (rec.length) records[e.formNumber] = rec;
  }

  const out = {
    source: `${BASE}/home.htm`,
    generated: new Date().toISOString().slice(0, 10),
    fields: ['styles', 'architect', 'historicName', 'type', 'majorTenant'],
    styles,
    types,
    records,
    byAddress,
    landmarks,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));

  const count = (pred) => usedEntries.filter(pred).length;
  console.log(`\nSaved ${Object.keys(records).length} records to ${OUT}`);
  console.log(`  with style: ${count((e) => e.styles.length)}, with architect: ${count((e) => e.architect)}, with type: ${count((e) => e.type)}`);
  console.log(`  file size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

// Run only when invoked directly (so parseDetail can be imported for testing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
