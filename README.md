# Chicago Architecture Explorer

A mobile-first web app to explore historic architecture in Chicago. Enter cross streets or use your location to find nearby landmarks and significant buildings.

## Features

- **Geocoding**: Enter cross streets (e.g., "Milwaukee & Damen") or use your GPS location
- **Nearby Buildings**: Find historic landmarks and CHRS-rated buildings within 400 meters
- **Interactive Map**: View buildings on an OpenStreetMap-based map
- **Building Details**: See verified facts (year built, architect, designation date) and architecture style information
- **LLM Narratives**: Get human-readable descriptions of buildings (requires API key)
- **PWA**: Installable as a mobile app

## Setup

### 1. Install dependencies

```bash
cd chiarch
npm install
```

### 2. Get API keys (optional)

- **Mapbox Geocoding**: Get a free API key from [Mapbox](https://www.mapbox.com/) (100,000 requests/month free)
- **LLM API**: Get a free API key from [Google Gemini](https://ai.google.dev/) or [OpenRouter](https://openrouter.ai/)

Create a `.env` file in the project root:

```bash
VITE_MAPBOX_KEY=your_mapbox_key_here
VITE_LLM_API_KEY=your_llm_api_key_here
VITE_LLM_ENDPOINT=https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent
```

### 3. Run the app

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Deployment

### Netlify (recommended)

1. Create a Netlify account and connect your GitHub repository
2. Set build command: `npm run build`
3. Set publish directory: `dist`
4. Add environment variables in Netlify:
   - `VITE_MAPBOX_KEY`
   - `VITE_LLM_API_KEY`
   - `VITE_LLM_ENDPOINT`

### Netlify Functions

The app expects a Netlify function at `/api/getNarrative` to handle LLM requests. Create a function in `netlify/functions/getNarrative`:

```javascript
exports.handler = async (event) => {
  const { name, address, year, architect, landmarkDate, style } = JSON.parse(event.body);

  // Call your LLM API here
  const response = await fetch(VITE_LLM_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${VITE_LLM_API_KEY}`
    },
    body: JSON.stringify({
      contents: [{
        parts: [{
          text: `Generate a friendly, engaging narrative about this historic building for architecture enthusiasts. Include its significance, architectural style, and interesting facts. Be concise but informative.

Building: ${name}
Address: ${address}
Year Built: ${year}
Architect: ${architect}
Landmark Date: ${landmarkDate}
Style: ${style}

Focus on what makes this building special and why visitors should appreciate it.`
        }]
      }]
    })
  });

  const data = await response.json();
  return {
    statusCode: 200,
    body: JSON.stringify({
      narrative: data.candidates[0].content.parts[0].text
    })
  };
};
```

## Data Sources

- **Individual Landmarks**: [data.cityofchicago.org/resource/uct4-hrvh.json](https://data.cityofchicago.org/resource/uct4-hrvh.json)
- **Chicago Historic Resources Survey**: [data.cityofchicago.org/resource/2u8t-236p.json](https://data.cityofchicago.org/resource/2u8t-236p.json)
- **Architecture Styles**: [Chicago Landmarks Style Details](https://webapps1.chicago.gov/landmarksweb/web/styledetails.htm)

## Architecture

```
[React App]
  ├─ Input: cross streets OR GPS
  ├─ Geocode: Mapbox (fallback to Nominatim)
  ├─ Query: Socrata within_circle (CORS-open)
  ├─ Display: Map + list of nearby buildings
  └─ Tap building → detail card
       ├─ LLM narrative (via Netlify function)
       ├─ Verified facts (from city data)
       └─ Style link (to landmarksweb)
```

## Free Tier Limits

- **Mapbox**: 100,000 requests/month (~3,000 searches/day) - enough for personal use
- **Gemini Flash**: 1,500 requests/day - enough for moderate usage
- **Socrata**: No limits - direct API access

## Mobile Testing

Test on iOS/Android:
1. Open in Safari/Chrome
2. Tap "Share" → "Add to Home Screen"
3. Launch from home screen for PWA experience

## License

MIT