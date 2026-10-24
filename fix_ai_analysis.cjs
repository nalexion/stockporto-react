const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// 1. Change temperature
code = code.replace("temperature: 0.2,", "temperature: 0.7,\n        maxOutputTokens: 2048,");

// 2. Make prompt more constrained
code = code.replace(
  "Provide a comprehensive portfolio-wide risk and diversification analysis.`;",
  "Provide a concise portfolio-wide risk and diversification analysis. Keep all commentary brief and to the point.`;"
);

// 3. Robust JSON parsing
const oldJsonParse = `    const text = response.text;
    const json = JSON.parse(text);
    res.json(json);`;

const newJsonParse = `    let text = response.text || '';
    if (text.startsWith('\`\`\`json')) {
      text = text.replace(/^\`\`\`json\\n/, '').replace(/\\n\`\`\`$/, '');
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse AI response as JSON. Raw text length:', text.length);
      console.error('Text snippet:', text.substring(0, 500));
      return res.status(500).json({ error: 'AI returned invalid formatting. Please try again.' });
    }
    res.json(json);`;

code = code.replace(oldJsonParse, newJsonParse);

fs.writeFileSync('server.ts', code);
