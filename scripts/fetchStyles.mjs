// Builds public/data/styles.json from the city's Architectural Style Guide
// (webapps1.chicago.gov/landmarksweb/web/styles.htm): a summary, common
// characteristics and an example photo per style, plus a mapping from the
// CHRS survey's style names (e.g. "CLASSICAL REVIVAL") to guide entries
// (e.g. "Classical Revival/Beaux-Arts").
//
// Usage (from chiarch/): node scripts/fetchStyles.mjs

import fs from 'node:fs';
import path from 'node:path';

const SITE = 'https://webapps1.chicago.gov';
const WEB = `${SITE}/landmarksweb/web`;
const CHRS_DATA = path.join(process.cwd(), 'data/chrs-details.json');
const OUT = path.join(process.cwd(), 'public/data/styles.json');
const DELAY_MS = 1000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The city's pages are served as Windows-1252, not UTF-8
function decodeBody(buf) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('windows-1252').decode(buf);
  }
}

const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
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

function parseStylePage(html) {
  const name = decode(html.match(/<h1>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
  const block = html.match(/<table class="width100TB">([\s\S]*?)<table class="insideTB3">/i)?.[1] ?? '';
  const photo = block.match(/<img[^>]*src="\s*([^"]+)"[^>]*alt="([^"]*)"/i);
  const text = block.replace(/<a[\s\S]*?<\/a>/gi, '');
  const [intro, ...rest] = text.split(/<P>|<UL>/i);
  const characteristics = [...rest.join(' ').matchAll(/<LI[^>]*>([\s\S]*?)(?=<LI|<\/UL>|$)/gi)]
    .map((m) => decode(m[1]))
    .filter(Boolean);
  return {
    name,
    summary: decode(intro) || null,
    characteristics,
    photo: photo ? SITE + photo[1].trim() : null,
    photoAlt: photo ? decode(photo[2]) : null,
  };
}

const norm = (s) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** Guide entry for a CHRS style name: exact, one half of "A/B", or "Prairie" -> "Prairie School". */
const ALIASES = { "WORKMAN'S COTTAGE": "Worker's Cottage" };

function matchGuide(chrsStyle, guide) {
  const c = norm(ALIASES[chrsStyle] ?? chrsStyle);
  return (
    guide.find((g) => norm(g.name) === c) ??
    guide.find((g) => g.name.split('/').some((part) => norm(part) === c)) ??
    guide.find((g) => norm(g.name).startsWith(`${c} `)) ??
    null
  );
}

async function main() {
  const list = await fetchText(`${WEB}/styles.htm`);
  const ids = [...new Set([...list.matchAll(/styledetails\.htm\?styId=(\d+)/g)].map((m) => m[1]))];
  console.log(`Fetching ${ids.length} style pages...`);

  const guide = [];
  for (const id of ids) {
    await sleep(DELAY_MS);
    const page = parseStylePage(await fetchText(`${WEB}/styledetails.htm?styId=${id}`));
    if (!page.name) continue;
    guide.push({ id: Number(id), url: `${WEB}/styledetails.htm?styId=${id}`, ...page });
    console.log(`  ✓ ${page.name} (${page.characteristics.length} characteristics)`);
  }

  const chrsStyles = fs.existsSync(CHRS_DATA) ? JSON.parse(fs.readFileSync(CHRS_DATA, 'utf8')).styles : [];
  const chrsToGuide = {};
  for (const s of chrsStyles) {
    const g = matchGuide(s, guide);
    if (g) chrsToGuide[s] = g.id;
  }
  const unmapped = chrsStyles.filter((s) => !(s in chrsToGuide));

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      source: `${WEB}/styles.htm`,
      generated: new Date().toISOString().slice(0, 10),
      guide: Object.fromEntries(guide.map((g) => [g.id, g])),
      chrsToGuide,
    })
  );
  console.log(`\nSaved ${guide.length} styles to ${OUT}`);
  console.log(`CHRS styles mapped: ${Object.keys(chrsToGuide).length}/${chrsStyles.length}`);
  if (unmapped.length) console.log(`No guide page for: ${unmapped.join(', ')}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
