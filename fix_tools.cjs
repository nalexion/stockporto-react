const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(
  /tools:\s*\[\{\s*googleSearch:\s*\{\}\s*\}\],\s*config:\s*\{/,
  "config: {\\n            tools: [{ googleSearch: {} }],"
);
fs.writeFileSync('server.ts', code);
