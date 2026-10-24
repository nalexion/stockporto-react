const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace("config: {\\\\n            tools:", "config: {\\n            tools:");
fs.writeFileSync('server.ts', code);
