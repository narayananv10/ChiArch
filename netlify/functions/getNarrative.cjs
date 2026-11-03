exports.handler = async (event) => {
  try {
    const { name, address, year, architect, landmarkDate, style } = JSON.parse(event.body);

    // Generate narrative prompt
    const prompt = `Generate a friendly, engaging narrative about this historic building for architecture enthusiasts. Include its significance, architectural style, and interesting facts. Be concise but informative.

Building: ${name}
Address: ${address}
Year Built: ${year}
Architect: ${architect}
Landmark Date: ${landmarkDate}
Style: ${style || 'Unknown'}

Focus on what makes this building special and why visitors should appreciate it. Keep it to 2-3 paragraphs.`;

    // Call OpenRouter with Gemini Flash latest
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
      },
      body: JSON.stringify({
        model: '~google/gemini-flash-latest',
        messages: [{
          role: 'user',
          content: prompt
        }],
        max_tokens: 1000
      })
    });

    const data = await response.json();
    const narrative = data.choices[0].message.content;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        narrative: narrative
      })
    };
  } catch (error) {
    console.error("Error:", error);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({
        error: "Failed to generate narrative"
      })
    };
  }
};