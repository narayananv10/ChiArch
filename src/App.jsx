import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import './App.css';
import { getNearby, getLandmarkDetails, narrativeFacts, displayName, preload, RADIUS_M } from './lib/buildings.js';

// Bundle Leaflet's marker images instead of hotlinking a different version from a CDN
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow });

const formatDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) : null;

const formatDistance = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);

const NARRATIVE_ERRORS = {
  not_configured: null, // feature off: show nothing
  daily_limit: 'AI descriptions have hit their daily limit. Try again tomorrow.',
  rate_limited: "You're going a bit fast. Wait a minute and tap the building again.",
  default: "Couldn't generate a description right now.",
};

async function geocode(q) {
  const res = await fetch('/api/geocode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  const data = await res.json().catch(() => null);
  if (res.ok && Number.isFinite(data?.lat) && Number.isFinite(data?.lng)) return data;
  if (res.status === 404) throw new Error(`Couldn't find "${q}" in Chicago. Try cross streets like "Milwaukee & Damen".`);
  if (res.status === 429) throw new Error('Too many searches in a short time. Wait a minute and try again.');
  throw new Error('Location search is unavailable right now.');
}

function Recenter({ center }) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], Math.max(map.getZoom(), 16));
  }, [center, map]);
  return null;
}

function App() {
  const [location, setLocation] = useState('');
  const [center, setCenter] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [districts, setDistricts] = useState([]);
  const [dataDate, setDataDate] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);
  const [details, setDetails] = useState(null); // official landmark details
  const [narrative, setNarrative] = useState({ status: 'idle', text: '' });

  const selectionId = useRef(0); // ignore responses for buildings no longer selected
  const narrativeCache = useRef(new Map());

  useEffect(preload, []);

  const showNear = async (coords) => {
    setCenter(coords);
    const result = await getNearby(coords.lat, coords.lng);
    setBuildings(result.buildings);
    setDistricts(result.districts);
    setDataDate(result.generated);
    if (result.buildings.length) select(result.buildings[0]);
  };

  const resetResults = () => {
    setError(null);
    setBuildings([]);
    setDistricts([]);
    setSelected(null);
    setDetails(null);
    setNarrative({ status: 'idle', text: '' });
  };

  const handleSearch = async (e) => {
    e?.preventDefault();
    const q = location.trim();
    if (!q) return;
    setLoading(true);
    resetResults();
    try {
      await showNear(await geocode(q));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUseLocation = () => {
    if (!navigator.geolocation) {
      setError('Location is not supported by this browser.');
      return;
    }
    setLoading(true);
    resetResults();
    navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          await showNear({ lat: coords.latitude, lng: coords.longitude });
        } catch (err) {
          setError(err.message);
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. Enable it in your browser settings, or type cross streets instead.'
            : `Couldn't get your location (${err.message}).`
        );
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  };

  const select = async (building) => {
    const id = ++selectionId.current;
    setSelected(building);
    setDetails(null);
    setNarrative({ status: 'idle', text: '' });

    // Prefer the official landmark description over an AI one
    let official = null;
    try {
      official = await getLandmarkDetails(building.landmarkId);
    } catch {
      /* fall through to AI */
    }
    if (id !== selectionId.current) return;
    if (official?.description) {
      setDetails(official);
      return;
    }

    const cached = narrativeCache.current.get(building.key);
    if (cached) {
      setNarrative({ status: 'done', text: cached });
      return;
    }

    setNarrative({ status: 'loading', text: '' });
    try {
      const res = await fetch('/api/getNarrative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(narrativeFacts(building)),
      });
      const data = await res.json().catch(() => null);
      if (id !== selectionId.current) return;
      if (res.ok && data?.narrative) {
        narrativeCache.current.set(building.key, data.narrative);
        setNarrative({ status: 'done', text: data.narrative });
      } else {
        const code = res.status === 429 && !data?.error ? 'rate_limited' : data?.error;
        const message = code in NARRATIVE_ERRORS ? NARRATIVE_ERRORS[code] : NARRATIVE_ERRORS.default;
        setNarrative({ status: message ? 'error' : 'off', text: message ?? '' });
      }
    } catch {
      if (id === selectionId.current) setNarrative({ status: 'error', text: NARRATIVE_ERRORS.default });
    }
  };

  const yearText = details?.yearBuilt || selected?.yearBuilt;
  // Survey style first; otherwise the style the City's landmark page links to
  const styles = selected?.styles.length ? selected.styles : details?.styles ?? [];

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chicago Architecture Explorer</h1>
        <p>Find historic buildings and landmarks near you</p>
      </header>

      <div className="search-container">
        <form className="search-inputs" onSubmit={handleSearch}>
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Cross streets, e.g. Milwaukee & Damen"
            disabled={loading}
            enterKeyHint="search"
          />
          <button type="submit" disabled={loading || !location.trim()}>
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button type="button" onClick={handleUseLocation} disabled={loading}>
            📍 Use My Location
          </button>
        </form>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
      </div>

      {center && (
        <div className="results-container">
          <div className="map-container">
            <MapContainer center={[center.lat, center.lng]} zoom={16} style={{ height: '400px', width: '100%' }}>
              <Recenter center={center} />
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <CircleMarker center={[center.lat, center.lng]} radius={8} pathOptions={{ color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }}>
                <Popup>You are here</Popup>
              </CircleMarker>
              {buildings.map((b) => (
                <Marker key={b.key} position={[b.lat, b.lng]} eventHandlers={{ click: () => select(b) }}>
                  <Popup>
                    <strong>{displayName(b)}</strong>
                    <br />
                    {b.yearBuilt}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          <div className="buildings-list">
            <h3>
              Nearby Buildings ({buildings.length}) <small>within {RADIUS_M} m</small>
            </h3>
            {districts.length > 0 && (
              <p className="districts">
                <strong>Historic districts nearby:</strong> {districts.map((d) => d.name).join(', ')}
              </p>
            )}
            {buildings.length === 0 ? (
              <p>No historic buildings found within {RADIUS_M} m.</p>
            ) : (
              <ul>
                {buildings.map((b) => (
                  <li key={b.key} className={selected?.key === b.key ? 'selected' : ''} onClick={() => select(b)}>
                    <strong>{displayName(b)}</strong>
                    <br />
                    <small>
                      {[b.name ? b.address : null, b.yearBuilt, b.styles[0]?.name].filter(Boolean).join(' · ')}
                    </small>
                    <br />
                    <small>{formatDistance(b.distance)} away</small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selected && (
            <div className="building-detail">
              <h3>{displayName(selected)}</h3>
              {selected.historicName && selected.historicName !== selected.name && (
                <p className="historic-name">Historically: {selected.historicName}</p>
              )}

              {details?.photo && (
                <figure className="building-photo">
                  <img src={details.photo} alt={details.photoAlt || displayName(selected)} loading="lazy" />
                  <figcaption>Photo: Commission on Chicago Landmarks</figcaption>
                </figure>
              )}

              <div className="narrative-section">
                <h4>About this building</h4>
                {details?.description ? (
                  <>
                    <p>{details.description}</p>
                    <p className="source">
                      Official description from the Commission on Chicago Landmarks.{' '}
                      <a href={details.url} target="_blank" rel="noopener noreferrer">
                        View on the City&apos;s Landmarks site →
                      </a>
                    </p>
                    {details.moreLinks?.length > 0 && (
                      <div className="more-info">
                        <strong>More information</strong>
                        <ul>
                          {details.moreLinks.map((l) => (
                            <li key={l.url}>
                              <a href={l.url} target="_blank" rel="noopener noreferrer">
                                {l.label}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                ) : narrative.status === 'loading' ? (
                  <p>Writing a description...</p>
                ) : narrative.status === 'done' ? (
                  <>
                    <p>{narrative.text}</p>
                    <p className="source">AI-written summary of the facts below. Check the facts for anything important.</p>
                  </>
                ) : narrative.status === 'error' ? (
                  <p className="muted">{narrative.text}</p>
                ) : (
                  <p className="muted">No description available.</p>
                )}
              </div>

              <div className="facts-section">
                <h4>Verified facts</h4>
                <ul>
                  {selected.address && (
                    <li>
                      <strong>Address:</strong> {selected.address}
                    </li>
                  )}
                  <li>
                    <strong>Year built:</strong> {yearText || 'Not recorded'}
                  </li>
                  <li>
                    <strong>Architect:</strong> {selected.architect || 'Not recorded'}
                  </li>
                  <li>
                    <strong>Style:</strong> {styles.map((s) => s.name).join(', ') || 'Not recorded'}
                  </li>
                  {selected.type && (
                    <li>
                      <strong>Building type:</strong> {selected.type}
                    </li>
                  )}
                  {selected.landmarkDate && (
                    <li>
                      <strong>Chicago Landmark since:</strong> {formatDate(selected.landmarkDate)}
                    </li>
                  )}
                  {selected.nationalRegister && (
                    <li>
                      <strong>National:</strong> {selected.nationalRegister}
                    </li>
                  )}
                  {selected.chrsMeaning && (
                    <li>
                      <strong>Historic Resources Survey:</strong> {selected.chrsMeaning}
                    </li>
                  )}
                </ul>
              </div>

              {styles
                .filter((s) => s.guide)
                .map((s) => (
                  <div className="style-section" key={s.name}>
                    <h4>About the {s.name} style</h4>
                    {s.guide.summary && <p>{s.guide.summary}</p>}
                    {s.guide.characteristics?.length > 0 && (
                      <>
                        <p>
                          <strong>Common characteristics:</strong>
                        </p>
                        <ul>
                          {s.guide.characteristics.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <p className="source">
                      From the City&apos;s{' '}
                      <a href={s.guide.url} target="_blank" rel="noopener noreferrer">
                        Architectural Style Guide
                      </a>
                    </p>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      <footer className="app-footer">
        Data: City of Chicago (Landmarks, Historic Resources Survey, National Register listings)
        {dataDate && `, updated ${dataDate}`}. Map © OpenStreetMap contributors.
      </footer>
    </div>
  );
}

export default App;
