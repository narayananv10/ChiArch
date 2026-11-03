exports.handler = async (event) => {
  try {
    const { q } = JSON.parse(event.body);

    // Try Mapbox first
    const mapboxKey = process.env.MAPBOX_TOKEN;
    if (mapboxKey) {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${mapboxKey}`
      );
      const data = await response.json();
      if (data.features && data.features.length > 0) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*"
          },
          body: JSON.stringify({
            lat: data.features[0].center[1],
            lng: data.features[0].center[0]
          })
        };
      }
    }

    // Fallback to Nominatim
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`
    );
    const data = await response.json();
    if (data && data.length > 0) {
      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*"
        },
        body: JSON.stringify({
          lat: parseFloat(data[0].lat),
          lng: parseFloat(data[0].lon)
        })
      };
    }

    throw new Error('Location not found');
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Geocoding failed"
      })
    };
  }
};