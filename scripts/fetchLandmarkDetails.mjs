// Builds public/data/landmark-details.json: the official description and photo
// for each Chicago Landmark, from the city's Landmarks site
// (webapps1.chicago.gov/landmarksweb), keyed by the Individual Landmarks
// dataset id (uct4-hrvh, e.g. "L-349").
//
// Usage (from chiarch/): node scripts/fetchLandmarkDetails.mjs

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseAddresses } from '../src/lib/address.js';

const SITE = 'https://webapps1.chicago.gov';
const WEB = `${SITE}/landmarksweb/web`;
const OUT = path.join(process.cwd(), 'public/data/landmark-details.json');
const DELAY_MS = 1000;

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
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();

async function fetchText(url, attempts = 4) {
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return decodeBody(await res.arrayBuffer());
    } catch (err) {
      if (i === attempts) throw err;
      await sleep(DELAY_MS * 2 ** i);
    }
  }
}

async function fetchSocrata(dataset, query, attempts = 6) {
  for (let i = 1; i <= attempts; i++) {
    const data = JSON.parse(await fetchText(`https://data.cityofchicago.org/resource/${dataset}.json?${query}`));
    if (Array.isArray(data)) return data;
    await sleep(DELAY_MS * 2 ** i);
  }
  throw new Error('Socrata unavailable');
}

const normName = (s) =>
  decode(s)
    .toUpperCase()
    .replace(/\(FORMER\)/g, '')
    .replace(/&/g, ' AND ')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

// Many "More Information" links are 15+ years old. Keep only ones that still work,
// upgrading http:// to https:// where that's what responds.
async function workingUrl(url) {
  const candidates = url.startsWith('http://') ? [url.replace('http://', 'https://'), url] : [url];
  for (const u of candidates) {
    try {
      const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      if (res.ok) return res.url;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export function parseLandmarkPage(html) {
  const field = (label) => {
    const m = html.match(new RegExp(`<b>${label}:?\\s*</b>([\\s\\S]*?)<br`, 'i'));
    return m ? decode(m[1]) || null : null;
  };
  const name = decode(html.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const photo = html.match(/<table class="insideTB1">[\s\S]*?<img[^>]*src="\s*([^"]+)"[^>]*alt="([^"]*)"/i);
  const raw = html.match(/<span class="normal">([\s\S]*?)<\/span>/i)?.[1] ?? '';
  // Drop the photo links (anchors wrapping an <img>), keep ordinary links' text
  const body = raw.replace(/<a[^>]*>\s*<img[\s\S]*?<\/a>/gi, '');
  // Some pages end with "<B>More Information</B>" and a list of links
  const [main, more = ''] = body.split(/<b>\s*More Information\s*<\/b>/i);

  const absolute = (href) => new URL(href.trim(), `${WEB}/`).href;
  const moreLinks = [...more.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ label: decode(m[2]), url: absolute(m[1]) }))
    .filter((l) => l.label);
  // Styles the City links to from the description, e.g. "Spanish Revival style"
  const styleIds = [...new Set([...main.matchAll(/styledetails\.htm\?styId=(\d+)/gi)].map((m) => Number(m[1])))];

  return {
    name,
    address: field('Address'),
    yearBuilt: field('Year Built'),
    architect: field('Architect'),
    designated: field('Date Designated a Chicago Landmark'),
    description: decode(main).replace(/\s+([.,;:])/g, '$1') || null,
    moreLinks,
    styleIds,
    photo: photo ? SITE + photo[1].trim() : null,
    photoAlt: photo ? decode(photo[2]) : null,
  };
}

async function main() {
  console.log('Loading Individual Landmarks dataset (uct4-hrvh)...');
  const landmarks = await fetchSocrata('uct4-hrvh', '$select=id,name,address&$limit=5000');
  const byName = new Map(landmarks.map((l) => [normName(l.name), l.id]));
  const addrIndex = landmarks.flatMap((l) => parseAddresses(l.address).map((a) => ({ ...a, id: l.id })));
  const findByAddress = (address) => {
    for (const a of parseAddresses(address)) {
      const hit = addrIndex.find(
        (x) => x.dir === a.dir && x.street === a.street && x.lo <= a.hi && a.lo <= x.hi
      );
      if (hit) return hit.id;
    }
    return null;
  };

  const listing = await fetchText(`${WEB}/listings.htm`);
  const pages = [
    ...new Map(
      [...listing.matchAll(/landmarkdetails\.htm\?lanId=(\d+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g)]
        .map((m) => [m[1], decode(m[2])])
        .filter(([, name]) => name)
    ),
  ];
  console.log(`Fetching ${pages.length} landmark pages...`);

  const out = {};
  const unmatched = [];
  let i = 0;
  for (const [lanId, listedName] of pages) {
    await sleep(DELAY_MS);
    let page;
    try {
      page = parseLandmarkPage(await fetchText(`${WEB}/landmarkdetails.htm?lanId=${lanId}`));
    } catch (err) {
      console.warn(`  failed ${lanId} ${listedName}: ${err.message}`);
      continue;
    }
    const checked = [];
    for (const link of page.moreLinks) {
      const url = await workingUrl(link.url);
      if (url) checked.push({ ...link, url });
    }
    page.moreLinks = checked;
    const id = byName.get(normName(page.name || listedName)) ?? findByAddress(page.address);
    const record = {
      lanId: Number(lanId),
      url: `${WEB}/landmarkdetails.htm?lanId=${lanId}`,
      yearBuilt: page.yearBuilt,
      description: page.description,
      photo: page.photo,
      photoAlt: page.photoAlt,
      ...(page.moreLinks.length && { moreLinks: page.moreLinks }),
      ...(page.styleIds.length && { styleIds: page.styleIds }),
    };
    if (id && !out[id]) out[id] = record;
    else unmatched.push(`${page.name} (${page.address})`);
    if (++i % 50 === 0) console.log(`  ${i}/${pages.length}`);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({ source: `${WEB}/listings.htm`, generated: new Date().toISOString().slice(0, 10), landmarks: out })
  );
  const withDesc = Object.values(out).filter((r) => r.description).length;
  console.log(`\nSaved ${Object.keys(out).length} landmarks (${withDesc} with description) to ${OUT}`);
  console.log(`  file size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
  if (unmatched.length) console.log(`  not matched to dataset (${unmatched.length}):\n    ${unmatched.join('\n    ')}`);
}

// Run only when invoked directly (so parseLandmarkPage can be imported for testing)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
