exports.handler = async (event) => {
  try {
    const { name, address, year, architect, landmarkDate, style } = JSON.parse(event.body);

    // Generate narrative prompt
    const prompt = `Generate a narrative about this building based ONLY on the verified facts provided. Do NOT add any information not explicitly stated in the facts.

VERIFIED FACTS:
- Name: ${name}
- Address: ${address}
- Year Built: ${year}
- Architect: ${architect}
- Landmark Date: ${landmarkDate}
- Style: ${style || 'Unknown'}
- CHRS Rating: ${color || 'Not rated'}

INSTRUCTIONS:
- Use ONLY the information provided above
- Do NOT speculate or add details not in the facts
- Focus on the architectural significance of the verified features
- If information is missing, say "This information is not available"
- Keep it factual and educational
- Maximum 2-3 paragraphs`;

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