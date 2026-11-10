# Chicago Architecture Explorer

A mobile-first web app for looking up historic buildings near you while walking around Chicago. Enter cross streets or use your phone's location, and it lists the historic buildings within 400 m: when each was built, who designed it, its architectural style, and the City's official description where one exists.

**Status: working prototype, not yet deployed from this branch.** See [STATUS.md](STATUS.md) for what works, what's partial, and what's next.

## What it does

- **Find a location** from cross streets ("Milwaukee & Damen", "LaSalle and Madison", "18th / Halsted") or the phone's GPS.
- **List historic buildings within 400 m**, nearest first, on a map and in a list. Searches run locally against prebuilt data, so they take well under a second and don't depend on the City's API being up.
- **Building details**, all from City of Chicago records:
  - year built, architect, architectural style, building type, historic name
  - Chicago Landmark designation date, National Register / National Historic Landmark status
  - Chicago Historic Resources Survey rating (Red / Orange)
  - for Chicago Landmarks: the official description and photo from the Commission on Chicago Landmarks
  - for each style: the City's style-guide summary and common characteristics
- **A one- or two-sentence summary** for every other building, filled into a fixed template from the facts above (no AI), e.g. *"An Italianate commercial building constructed in the 1880s, designed by William Ohlhaber."*
- **Nearby historic districts** (National Register).

### Coverage

About 9,000 buildings. Coverage is uneven because the City's records are:

| Field | Share of buildings |
|---|---|
| Year or decade built | ~94% |
| Building type (e.g. 2-3 Flat, Church, Commercial) | ~75% |
| Architectural style | ~42% |
| Architect | ~30% |
| Official description + photo | 287 Chicago Landmarks |

The Historic Resources Survey covers buildings built before 1940, so newer buildings only appear if they're Chicago Landmarks or on the National Register.

## Data sources

| Source | What it provides |
|---|---|
| [Individual Landmarks](https://data.cityofchicago.org/d/uct4-hrvh) | Chicago Landmarks: name, address, year, architect, designation date |
| [Historic Resources Survey – Red & Orange](https://data.cityofchicago.org/d/2u8t-236p) | ~9,300 survey buildings: location, decade, rating |
| [CHRS search database](https://webapps1.chicago.gov/landmarksweb/search/home.htm) | Style, architect, building type, historic name (not in the open dataset) |
| [Landmarks website](https://webapps1.chicago.gov/landmarksweb/web/listings.htm) | Official descriptions and photos |
| [Architectural Style Guide](https://webapps1.chicago.gov/landmarksweb/web/styles.htm) | Style summaries and characteristics |
| [National Register of Historic Places](https://data.cityofchicago.org/d/bqx3-yhry) | NR / NHL listings and districts |
| [Street center lines](https://data.cityofchicago.org/d/pr57-gg9e) | Cross-street geocoding index |

The data is prebuilt into `public/data/` and `netlify/lib/` by the scripts below and committed to the repo. Rebuild it occasionally (new landmarks are designated a few times a year).

```bash
npm run data                # survey styles/architects, landmark descriptions, style guide, merged buildings.json
npm run data:types          # also building types from each survey record (~6,500 requests, roughly an hour; resumable)
npm run data:intersections  # cross-street index for the geocoder
```

The scripts pause between requests to the City's servers.

## Setup

```bash
cd chiarch
npm install
npm run dev     # http://localhost:5173, including the /api functions
```

`npm run dev` also serves the Netlify geocode function at `/api/geocode` through a small Vite plugin, so you don't need the Netlify CLI. The rate limit only applies on Netlify.

### Environment variables

| Variable | Required? | Used for |
|---|---|---|
| `MAPBOX_TOKEN` | Optional | Geocoding place names and addresses. Cross streets never need it; without it, place names fall back to OpenStreetMap Nominatim |

That's the only one. On Netlify, set it in the site's environment settings. Locally, put it in `chiarch/.env` (gitignored).

## Deployment (Netlify)

`netlify.toml` sets the build command, publish directory (`dist`), Node 22, and the esbuild function bundler. There's one function, which declares its own path and rate limit in code:

- `netlify/functions/geocode.mjs` → `/api/geocode` (30 requests/min per IP): cross-street index, then Mapbox, then Nominatim, all bounded to Chicago

## How it fits together

```
[React app] ── loads once ──▶ /data/buildings.json, styles.json, landmark-details.json
  ├─ cross streets ─▶ /api/geocode ─▶ intersection index → Mapbox → Nominatim
  ├─ GPS
  ├─ nearby search: local distance filter over buildings.json
  └─ tap a building
        ├─ Chicago Landmark? official description + photo + links
        └─ otherwise: template summary from the facts (no API call)
```

## Running costs (approximate)

| Service | Free allowance | What this app uses |
|---|---|---|
| Netlify | Free plan: 300 credits/month | Static site + 1 small function |
| Mapbox (optional) | 100,000 requests/month | Place-name searches only |
| Nominatim | Free; ~1 request/second policy | Fallback for place names |
| City of Chicago data | Free | Only when rebuilding the data, not at runtime |

## Tech stack

Vite, React 18, Leaflet / react-leaflet, Netlify Functions (v2).

## License

No license file has been added yet. The building data and photos come from the City of Chicago.
