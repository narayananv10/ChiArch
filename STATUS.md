# Project Status

_Last updated: 2026-11-10_

An honest snapshot of where the Chicago Architecture Explorer stands. Update it as things change.

## Goal

A phone-friendly companion for walking around Chicago: when you see an interesting building, tap "Use My Location" (or enter cross streets) and get every historic building nearby with **when it was built, who designed it, its architecture style**, and some context.

## Working (on the `data-enrichment` branch)

- Cross-street geocoding from a prebuilt index of City street center lines: instant, free, and handles diagonal streets (e.g. Milwaukee & Damen)
- Place names and addresses through Mapbox (optional), then Nominatim, bounded to Chicago
- GPS location, with clear messages when permission is denied
- Nearby search over ~9,000 prebuilt, de-duplicated buildings: well under a second, with no runtime calls to the City's API
- Style, architect, building type and historic name from the CHRS search database, joined by form number or address
- Official descriptions and photos for 287 Chicago Landmarks
- City style-guide summaries and characteristics for 24 styles
- National Register / National Historic Landmark status, plus nearby NR districts
- Template summary for every non-landmark building, built from City records (no AI, no API calls, no running cost)
- Building type for ~75% of buildings (e.g. 2-3 Flat, Church, Commercial)
- "More information" links (checked to still work) and styles from the City's landmark pages
- The geocode function validates input, is rate-limited per IP, and returns clear errors; `npm run dev` runs it locally
- Tested end to end in headless Chrome at phone size (search, GPS, details, photo, errors)

## Partial / known gaps

| Area | Detail |
|---|---|
| Coverage | Style is known for ~42% of buildings and architect for ~30%. The City never recorded them for the rest. |
| Post-1940 buildings | Only shown if they're Chicago Landmarks or on the National Register. |
| Landmarks without descriptions | 30 Landmarks site pages (mostly bridges, monuments and some Bronzeville buildings) don't match a dataset record. |
| Districts | NR districts are matched by bounding box, so "nearby" is approximate. Chicago Landmark Districts aren't included yet. |
| Two crossings | If two streets cross in more than one place, the geocoder returns the first. |
| Netlify rate limit untested | The geocode rate limit only runs on Netlify; it needs a deploy preview to verify. |
| Photos | Loaded directly from the City's server (allowed today, but could change). |

## Not built

- Offline support / service worker (the data files would cache well, which makes this a good next step)
- Tests in the repo (only ad-hoc scripts so far)
- UI/UX pass for on-foot use

## Next up

1. Test the Netlify deploy preview on a phone (real GPS, rate limit)
2. UI/UX pass for on-foot use
3. Offline support
