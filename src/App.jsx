import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import landmarkStyles from './data/landmarkStyles.json';

// Fix for default marker icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

function App() {
  const [location, setLocation] = useState('');
  const [center, setCenter] = useState(null);
  const [buildings, setBuildings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [narrative, setNarrative] = useState('');
  const [narrativeLoading, setNarrativeLoading] = useState(false);

  // Geocode location using server-side function (with fallback to Nominatim)
  const geocodeLocation = async (address) => {
    try {
      // Try server-side geocode first
      const response = await fetch('/api/geocode', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ q: address })
      });

      if (response.ok) {
        const data = await response.json();
        return {
          lat: data.lat,
          lng: data.lng
        };
      }

      // Fallback to Nominatim
      const response2 = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`
      );
      const data = await response2.json();
      if (data && data.length > 0) {
        return {
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        };
      }

      throw new Error('Location not found');
    } catch (err) {
      throw new Error(`Geocoding failed: ${err.message}`);
    }
  };

  // Get coordinates from building safely
  const getLatLng = (building) => {
    if (building.latitude && building.longitude) {
      return {
        lat: parseFloat(building.latitude),
        lng: parseFloat(building.longitude)
      };
    }
    const coords = building.the_geom?.coordinates?.[0]?.[0]?.[0];
    if (Array.isArray(coords) && coords.length >= 2 && typeof coords[0] === 'number') {
      return { lng: coords[0], lat: coords[1] };
    }
    return null;
  };

  // Haversine distance in meters
  const haversineDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  // Get buildings from Socrata within a circle
  const getBuildings = async (lat, lng) => {
    try {
      const radius = 400; // meters
      const response = await fetch(
        `https://data.cityofchicago.org/resource/uct4-hrvh.json?$where=within_circle(the_geom,${lat},${lng},${radius})&$limit=20`
      );
      const data = await response.json();

      // Also get CHRS buildings
      const chrsResponse = await fetch(
        `https://data.cityofchicago.org/resource/2u8t-236p.json?$where=within_circle(the_geom,${lat},${lng},${radius})&$limit=20`
      );
      const chrsData = await chrsResponse.json();

      // Merge and filter out buildings without coordinates
      const allBuildings = [...data, ...chrsData]
        .map(b => {
          const coords = getLatLng(b);
          return coords ? { ...b, coords } : null;
        })
        .filter(b => b !== null)
        .map(b => ({
          ...b,
          distance: haversineDistance(lat, lng, b.coords.lat, b.coords.lng)
        }))
        .sort((a, b) => a.distance - b.distance);

      return allBuildings;
    } catch (err) {
      throw new Error(`Failed to fetch buildings: ${err.message}`);
    }
  };

  // Get style for a building
  const getBuildingStyle = (building) => {
    const name = building.name || building.landmarkna;
    if (!name) return null;

    // Normalize name for matching
    const normalizedName = name.toLowerCase().replace(/^the\s+/, '').trim();

    // Try exact match first
    for (const [styleName, styleData] of Object.entries(landmarkStyles)) {
      const normalizedStyle = styleName.toLowerCase();
      if (normalizedName === normalizedStyle) {
        return styleData;
      }
    }

    // Try partial match (building name contains style name)
    for (const [styleName, styleData] of Object.entries(landmarkStyles)) {
      const normalizedStyle = styleName.toLowerCase();
      if (normalizedName.includes(normalizedStyle)) {
        return styleData;
      }
    }

    return null;
  };

    // Get narrative from LLM
    const getNarrative = async (building) => {
      try {
        setNarrativeLoading(true);
        const style = getBuildingStyle(building);
        const response = await fetch('/api/getNarrative', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: building.name || building.landmarkna,
            address: building.address || `${building.bldg_f_add} ${building.bldg_st_name}`,
            year: building.date_built || building.decade,
            architect: building.architect || 'Unknown',
            landmarkDate: building.landmark || building.valid_date,
            style: style ? style.name : null,
            color: building.color
          })
        });

        const data = await response.json();
        setNarrative(data.narrative);
      } catch (err) {
        setError(`Failed to get narrative: ${err.message}`);
      } finally {
        setNarrativeLoading(false);
      }
    };

  const handleSearch = async () => {
    if (!location.trim()) return;

    setLoading(true);
    setError(null);
    setBuildings([]);
    setSelectedBuilding(null);
    setNarrative('');

    try {
      const coords = await geocodeLocation(location);
      setCenter(coords);

      const buildings = await getBuildings(coords.lat, coords.lng);
      setBuildings(buildings);

      if (buildings.length > 0) {
        setSelectedBuilding(buildings[0]);
        await getNarrative(buildings[0]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleUseLocation = () => {
    if (navigator.geolocation) {
      setLoading(true);
      setError(null);

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const { latitude, longitude } = position.coords;
          setCenter({ lat: latitude, lng: longitude });

          try {
            const buildings = await getBuildings(latitude, longitude);
            setBuildings(buildings);

            if (buildings.length > 0) {
              setSelectedBuilding(buildings[0]);
              await getNarrative(buildings[0]);
            }
          } catch (err) {
            setError(err.message);
          } finally {
            setLoading(false);
          }
        },
        (err) => {
          setError(`Geolocation failed: ${err.message}`);
          setLoading(false);
        }
      );
    } else {
      setError('Geolocation is not supported by your browser');
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>Chicago Architecture Explorer</h1>
        <p>Find historic buildings and landmarks near you</p>
      </header>

      <div className="search-container">
        <div className="search-inputs">
          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Enter cross streets (e.g., Milwaukee & Damen)"
            disabled={loading}
          />
          <button onClick={handleSearch} disabled={loading || !location.trim()}>
            {loading ? 'Searching...' : 'Search'}
          </button>
          <button onClick={handleUseLocation} disabled={loading}>
            {loading ? 'Loading...' : '📍 Use My Location'}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
      </div>

      {center && (
        <div className="results-container">
          <div className="map-container">
            <MapContainer
              center={[center.lat, center.lng]}
              zoom={16}
              style={{ height: '400px', width: '100%' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <Marker position={[center.lat, center.lng]} icon={new L.Icon.Default({ iconSize: [24, 24] })}>
                <Popup>Your location</Popup>
              </Marker>
              {buildings.map((building, index) => (
                <Marker
                  key={index}
                  position={[building.coords.lat, building.coords.lng]}
                >
                  <Popup>
                    <strong>{building.name || building.landmarkna}</strong><br />
                    {building.address || `${building.bldg_f_add} ${building.bldg_st_name}`}<br />
                    {building.date_built || building.decade}
                  </Popup>
                </Marker>
              ))}
            </MapContainer>
          </div>

          <div className="buildings-list">
            <h3>Nearby Buildings ({buildings.length})</h3>
            {buildings.length === 0 ? (
              <p>No historic buildings found nearby.</p>
            ) : (
              <ul>
                {buildings.map((building, index) => (
                  <li
                    key={index}
                    className={selectedBuilding === building ? 'selected' : ''}
                    onClick={() => {
                      setSelectedBuilding(building);
                      getNarrative(building);
                    }}
                  >
                    <strong>{building.name || building.landmarkna}</strong><br />
                    <small>{building.address || `${building.bldg_f_add} ${building.bldg_st_name}`}</small><br />
                    <small>{building.date_built || building.decade}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {selectedBuilding && (
            <div className="building-detail">
              <h3>{selectedBuilding.name || selectedBuilding.landmarkna}</h3>

              <div className="narrative-section">
                <h4>About this building</h4>
                {narrativeLoading ? (
                  <p>Generating narrative...</p>
                ) : (
                  <p>{narrative || 'No narrative available'}</p>
                )}
              </div>

              <div className="facts-section">
                <h4>Verified Facts</h4>
                <ul>
                  <li><strong>Address:</strong> {selectedBuilding.address || `${selectedBuilding.bldg_f_add} ${selectedBuilding.bldg_st_name}`}</li>
                  <li><strong>Year Built:</strong> {selectedBuilding.date_built || selectedBuilding.decade}</li>
                  <li><strong>Architect:</strong> {selectedBuilding.architect || 'Unknown'}</li>
                  {selectedBuilding.landmark && <li><strong>Landmark Designation:</strong> {new Date(selectedBuilding.landmark).toLocaleDateString()}</li>}
                  {selectedBuilding.color && <li><strong>CHRS Rating:</strong> {selectedBuilding.color}</li>}
                </ul>
              </div>

              {getBuildingStyle(selectedBuilding) && (
                <div className="style-section">
                  <h4>About this architecture style</h4>
                  <p>
                    <a
                      href={getBuildingStyle(selectedBuilding).url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View {getBuildingStyle(selectedBuilding).name} details
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default App;