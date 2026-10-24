const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldError = `    res.status(500).json({ error: error.message || 'Failed to analyze portfolio' });`;

const newError = `    let userMsg = error.message || 'Failed to analyze portfolio';
    try {
       const parsed = JSON.parse(userMsg);
       if (parsed.error && parsed.error.message) userMsg = parsed.error.message;
    } catch(e) {}
    res.status(500).json({ error: userMsg });`;

code = code.replace(oldError, newError);

fs.writeFileSync('server.ts', code);
