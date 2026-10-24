const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(/gemini-2\.5-flash/g, 'gemini-3.6-flash');

fs.writeFileSync('server.ts', code);
