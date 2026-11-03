const { GoogleGenerativeAI } = require("@google/generative-ai");

exports.handler = async (event) => {
  try {
    const { name, address, year, architect, landmarkDate, style } = JSON.parse(event.body);

    // Initialize Google Generative AI
    const genAI = new GoogleGenerativeAI(process.env.VITE_LLM_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Generate narrative
    const prompt = `Generate a friendly, engaging narrative about this historic building for architecture enthusiasts. Include its significance, architectural style, and interesting facts. Be concise but informative.

Building: ${name}
Address: ${address}
Year Built: ${year}
Architect: ${architect}
Landmark Date: ${landmarkDate}
Style: ${style}

Focus on what makes this building special and why visitors should appreciate it. Keep it to 2-3 paragraphs.`;

    const result = await model.generateContent(prompt);
    const narrative = result.response.text();

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
