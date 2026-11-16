// Builds public/data/buildings.json: every historic building the app can show,
// merged and de-duplicated from three City of Chicago datasets plus the CHRS
// style/architect data (data/chrs-details.json, from fetchChrsDetails.mjs).
//
// The app searches this file locally, so a search needs no API calls.
//
// Usage (from chiarch/): node scripts/buildBuildings.mjs

import fs from 'node:fs';
import path from 'node:path';
import { mergeBuildings } from './lib/merge.mjs';

const SOCRATA = 'https://data.cityofchicago.org/resource';
const CHRS_DETAILS = path.join(process.cwd(), 'data/chrs-details.json');
const OUT = path.join(process.cwd(), 'public/data/buildings.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Socrata intermittently answers HTTP 200 with {"message":"Service unavailable"}
async function fetchAll(dataset, select, attempts = 8) {
  const url = new URL(`${SOCRATA}/${dataset}.json`);
  url.searchParams.set('$select', select);
  url.searchParams.set('$limit', '50000');
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
      const data = await res.json();
      if (Array.isArray(data)) return data;
      throw new Error(JSON.stringify(data).slice(0, 100));
    } catch (err) {
      if (i === attempts) throw err;
      console.warn(`  retry ${i} for ${dataset}: ${err.message}`);
      await sleep(1500 * i);
    }
  }
}

const round = (n) => Number(n.toFixed(6));

async function main() {
  const chrsDetails = JSON.parse(fs.readFileSync(CHRS_DETAILS, 'utf8'));

  console.log('Fetching datasets...');
  const landmarks = await fetchAll('uct4-hrvh', 'id,name,address,date_built,architect,landmark,the_geom');
  const chrs = await fetchAll(
    '2u8t-236p',
    'objectid,form_number,landmarkna,decade,startyear,endyear,color,demolished,bldg_f_add,bldg_t_add,bldg_pre_d,bldg_st_name,bldg_st_type,latitude,longitude'
  );
  const nrhp = await fetchAll('bqx3-yhry', 'objectid,name,address,nhl_nr,individual,the_geom');
  console.log(`  ${landmarks.length} landmarks, ${chrs.length} CHRS rows, ${nrhp.length} National Register entries`);

  const { buildings, districts, stats } = mergeBuildings({ chrsDetails, landmarks, chrs, nrhp });
  console.log('Merge:', stats);

  // Compact output: short keys, nulls dropped, styles/types as indexes
  const styles = chrsDetails.styles;
  const types = [...new Set(buildings.map((b) => b.type).filter(Boolean))].sort();
  const compact = buildings.map((b) => {
    const o = {
      k: b.key,
      la: round(b.lat),
      lo: round(b.lng),
      n: b.name,
      h: b.historicName,
      a: b.address,
      y: b.yearBuilt,
      ar: b.architect,
      s: b.styles.length ? b.styles.map((s) => styles.indexOf(s)) : null,
      t: b.type ? types.indexOf(b.type) : null,
      c: b.chrsColor,
      l: b.landmarkId,
      ld: b.landmarkDate,
      nr: b.nationalRegister,
    };
    for (const k of Object.keys(o)) if (o[k] === null || o[k] === undefined || o[k] === '') delete o[k];
    return o;
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(
    OUT,
    JSON.stringify({
      generated: new Date().toISOString().slice(0, 10),
      sources: [
        'https://data.cityofchicago.org/d/uct4-hrvh',
        'https://data.cityofchicago.org/d/2u8t-236p',
        'https://data.cityofchicago.org/d/bqx3-yhry',
        chrsDetails.source,
      ],
      styles,
      types,
      buildings: compact,
      districts: districts.map((d) => ({ n: d.name, nr: d.nationalRegister, b: d.bbox.map(round) })),
    })
  );

  const count = (p) => buildings.filter(p).length;
  console.log(`\nSaved ${buildings.length} buildings, ${districts.length} districts to ${OUT}`);
  console.log(
    `  with style ${count((b) => b.styles.length)}, architect ${count((b) => b.architect)}, year ${count((b) => b.yearBuilt)}, type ${count((b) => b.type)}, National Register ${count((b) => b.nationalRegister)}`
  );
  console.log(`  file size: ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
