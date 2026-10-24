const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const endpoint = `
app.post('/api/advisor/analyze-portfolio', async (req, res) => {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured.' });
    }

    const { holdings, currency, totalValue } = req.body;
    if (!holdings || !Array.isArray(holdings) || holdings.length === 0) {
      return res.status(400).json({ error: 'Holdings array is required' });
    }

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    const holdingsStr = holdings.map(h => 
      \`- \${h.ticker}: \${h.shares} shares, Current Value: \${h.value.toFixed(2)} \${currency} (\${((h.value/totalValue)*100).toFixed(1)}% of portfolio)\`
    ).join('\\n');

    const prompt = \`As an expert wealth manager and risk analyst, analyze the following stock portfolio.
The portfolio is denominated in \${currency} and has a total value of \${totalValue.toFixed(2)} \${currency}.

Holdings:
\${holdingsStr}

Provide a comprehensive portfolio-wide risk and diversification analysis.\`;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
      config: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            riskLevel: { type: Type.STRING, description: "Overall Risk Level (e.g., 'Low', 'Moderate', 'High', 'Aggressive')" },
            diversificationScore: { type: Type.INTEGER, description: "Score from 0 to 100 indicating how well diversified the portfolio is" },
            keyObservations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "3 to 5 key bullet points observing the portfolio's allocation, concentration, and potential risks."
            },
            actionableRecommendations: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: "2 to 4 actionable recommendations to improve the portfolio's risk/reward profile or diversification."
            },
            sectorBreakdownEstimate: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  sectorName: { type: Type.STRING },
                  percentage: { type: Type.INTEGER, description: "Estimated percentage of portfolio in this sector" },
                  commentary: { type: Type.STRING, description: "Short commentary on this sector's weight" }
                }
              }
            }
          },
          required: ["riskLevel", "diversificationScore", "keyObservations", "actionableRecommendations", "sectorBreakdownEstimate"]
        }
      }
    });

    const text = response.text;
    const json = JSON.parse(text);
    res.json(json);
  } catch (error: any) {
    console.error('Portfolio analysis error:', error);
    res.status(500).json({ error: error.message || 'Failed to analyze portfolio' });
  }
});
`;

code = code.replace("app.listen(PORT", endpoint + "\napp.listen(PORT");
fs.writeFileSync('server.ts', code);
