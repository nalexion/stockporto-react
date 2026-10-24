const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldError = `      console.error('Failed to parse AI response as JSON. Raw text length:', text.length);
      console.error('Extracted text:', text.substring(0, 500));
      return res.status(500).json({ error: 'AI returned invalid formatting. Please try again.' });`;
      
const newError = `      console.error('Failed to parse AI response as JSON. Raw text length:', text.length);
      console.error('Extracted text:', text.substring(0, 1500)); // Log more
      console.error('Parse Error:', e.message);
      
      // Try to clean the text
      try {
         let cleaned = text.replace(/\\n/g, "\\\\n").replace(/\\r/g, "\\\\r").replace(/\\t/g, "\\\\t");
         cleaned = cleaned.replace(/,[ \\t\\r\\n]*([}\\]])/g, '$1');
         json = JSON.parse(cleaned);
      } catch(e2) {
         return res.status(500).json({ error: 'AI returned invalid formatting: ' + e.message + '\\nText: ' + text.substring(0, 200) });
      }`;

code = code.replace(oldError, newError);
fs.writeFileSync('server.ts', code);
