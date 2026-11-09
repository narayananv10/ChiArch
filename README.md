# Chicago Architecture Explorer

A mobile-first web app for looking up historic buildings near you while walking around Chicago. Enter cross streets or use your phone's location, and it lists the landmark and historic-survey buildings within 400 m, with the facts the City of Chicago publishes about them.

**Status: early prototype.** The core search → map → details flow works, but several features are partial or unreliable. See [COMPLETED.md](COMPLETED.md) for an honest breakdown.

## What it does today

- **Find a location** from cross streets (e.g. "Milwaukee & Damen") or the browser's GPS.
- **Fetch nearby buildings** (400 m radius, up to 20 from each dataset) from two City of Chicago open datasets:
  - [Individual Landmarks](https://data.cityofchicago.org/d/uct4-hrvh): name, address, year built, architect, designation date (~400 buildings)
  - [Chicago Historic Resources Survey – Red and Orange Buildings](https://data.cityofchicago.org/d/2u8t-236p): address, decade, color rating (~9,300 buildings; **no architect or style** in this dataset)
- **Show them** on an OpenStreetMap/Leaflet map and in a list sorted by distance.
- **Building detail card** with the facts from the dataset, plus a short LLM-written description (Gemini Flash via OpenRouter) built only from those facts.

## What it does not do (yet)

- **Architecture style is mostly missing.** Neither dataset has a style field. The app currently tries to match the *building name* against style names, which almost never matches.
- **No offline support.** There is a web manifest, so "Add to Home Screen" gives an app-like shortcut, but there is no service worker and nothing is cached.
- **Narratives need a paid API key.** Without `OPENROUTER_API_KEY` the request fails and the card shows "No narrative available".
- **No automated tests.**

## Setup

```bash
cd chiarch
npm install
```

### Environment variables

| Variable | Required? | Used for |
|---|---|---|
| `OPENROUTER_API_KEY` | Needed for narratives | LLM descriptions (paid, see costs below) |
| `MAPBOX_TOKEN` | Optional | Geocoding; falls back to OpenStreetMap Nominatim |

On Netlify, set these in the site's environment settings. Locally, put them in `chiarch/.env` (it's gitignored).

### Running locally

```bash
npm run dev          # Vite only, at http://localhost:5173
```

`npm run dev` does **not** run the Netlify functions, so locally:
- geocoding falls back to Nominatim directly from the browser, and
- narratives fail.

To run the functions too, use the Netlify CLI: `npx netlify dev`.

## Deployment (Netlify)

`netlify.toml` already sets the build command (`npm run build`), the publish directory (`dist`), Node 20, and the `/api/*` → function redirects. Connect the repo in Netlify and add the environment variables above.

Serverless functions in `netlify/functions/`:
- `geocode.cjs` → `/api/geocode`: Mapbox (bounded to Chicago), then Nominatim
- `getNarrative.cjs` → `/api/getNarrative`: calls OpenRouter `~google/gemini-flash-latest`

## How it fits together

```
[React app]
  ├─ cross streets ─▶ /api/geocode (Mapbox → Nominatim) ─┐
  ├─ GPS ────────────────────────────────────────────────┤
  │                                                      ▼
  ├─ Socrata within_circle(400 m) on uct4-hrvh + 2u8t-236p  (called from the browser)
  ├─ map + distance-sorted list
  └─ tap a building ─▶ detail card
        ├─ facts from the dataset
        ├─ /api/getNarrative (OpenRouter LLM)
        └─ style link (only when the name-based match happens to hit)
```

## Running costs (approximate)

| Service | Free allowance | What this app uses |
|---|---|---|
| Netlify | Free plan: 300 credits/month | Static site + 2 small functions; personal use should stay free |
| Mapbox geocoding | 100,000 requests/month | 1 per cross-street search |
| OpenRouter (Gemini Flash) | **None. Pay per token** | 1 call per building viewed, about $0.002–0.004 each |
| City of Chicago Socrata API | Free (throttled without an app token) | 2 calls per search |
| Nominatim | Free; usage policy limits it to about 1 request/second | Fallback geocoder |

## Utility scripts

- `scripts/fetchStyles.mjs`: scrapes style names and URLs from the city's Landmarks site into `src/data/landmarkStyles.json`. (`scripts/fetchStyles.js` is an older duplicate.)

## Tech stack

Vite, React 18, Leaflet / react-leaflet, Netlify Functions.

## License

No license file has been added yet.
