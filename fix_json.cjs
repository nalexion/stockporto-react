const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldParse = `    let text = response.text || '';
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
    }`;

const newParse = `    let text = response.text || '';
    
    // Robust extraction: find the first { and last }
    const startIndex = text.indexOf('{');
    const endIndex = text.lastIndexOf('}');
    if (startIndex !== -1 && endIndex !== -1 && endIndex >= startIndex) {
      text = text.substring(startIndex, endIndex + 1);
    }

    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      console.error('Failed to parse AI response as JSON. Raw text length:', text.length);
      console.error('Extracted text:', text.substring(0, 500));
      return res.status(500).json({ error: 'AI returned invalid formatting. Please try again.' });
    }`;

code = code.replace(oldParse, newParse);

// Also fix model to gemini-2.5-flash if needed, though gemini-2.5-flash is typical. Let's just fix the model string everywhere just in case.
code = code.replace(/gemini-3\.6-flash/g, 'gemini-2.5-flash');

fs.writeFileSync('server.ts', code);
