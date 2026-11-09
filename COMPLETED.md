# Project Status

_Last updated: 2026-11-09_

An honest snapshot of where the Chicago Architecture Explorer stands. Update this as things change.

## Goal

A phone-friendly companion for walking around Chicago: when you see an interesting building, tap "Use My Location" (or enter cross streets) and get every historic building nearby with **when it was built, who designed it, its architecture style**, and some context.

## Working

- Cross-street geocoding through a Netlify function (Mapbox bounded to Chicago, then Nominatim)
- GPS location through the browser Geolocation API
- 400 m radius search against two City of Chicago Socrata datasets (Individual Landmarks, CHRS Red/Orange)
- Leaflet map with markers and a distance-sorted list
- Detail card showing dataset facts (address, year/decade, architect where available, landmark date, CHRS color)
- LLM narrative through OpenRouter, with a prompt limited to the provided facts (requires `OPENROUTER_API_KEY`)
- Netlify config (build, Node 20, `/api/*` redirects, security headers)
- Web manifest, so it can be added to a phone's home screen

## Partial or broken

| Area | Problem |
|---|---|
| Architecture style | No style data in either dataset. The app matches the building *name* against style names, which almost never works. |
| Architect | Only present for Individual Landmarks; CHRS buildings always show "Unknown". |
| Narrative without an API key | The function throws and the UI shows "No narrative available". The front end doesn't check `response.ok`. |
| Duplicates | Buildings in both datasets can appear twice; there is no deduplication. |
| Narrative race | Tapping buildings quickly can show the wrong building's narrative if replies arrive out of order. |
| Socrata reliability | The API sometimes returns "Service unavailable"; the app doesn't detect it and shows zero results. |
| Geocode edge case | `geocode.cjs` has no guard for malformed Mapbox/Nominatim responses. |
| Local dev | `npm run dev` doesn't run the functions; you need `netlify dev`. |
| Map marker icons | Loaded from unpkg Leaflet 1.7.1 while the project uses 1.9.4. |

## Not built

- Offline support / service worker (despite earlier docs claiming it)
- Narrative caching (the same building costs an LLM call every time it's viewed)
- Rate limiting on the public `/api/getNarrative` endpoint
- Tests
- License file

## Next up

1. Add richer data sources: style, architect, and building type from the city's full CHRS search database (joins on `form_number`), plus National Register status (`bqx3-yhry`)
2. Fix the reliability issues above
3. UI/UX pass for on-foot use
