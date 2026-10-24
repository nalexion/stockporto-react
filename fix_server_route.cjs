const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Find the index of app.post('/api/advisor/analyze-portfolio'
const routeStart = code.indexOf("app.post('/api/advisor/analyze-portfolio'");
if (routeStart !== -1) {
  // Find the end of this route. It ends right before app.listen(PORT
  const routeEnd = code.indexOf("app.listen(PORT", routeStart);
  if (routeEnd !== -1) {
    const routeCode = code.substring(routeStart, routeEnd);
    // Remove it from its current place
    code = code.substring(0, routeStart) + code.substring(routeEnd);
    
    // Insert it before async function startServer()
    const startServerIdx = code.indexOf("async function startServer()");
    if (startServerIdx !== -1) {
      code = code.substring(0, startServerIdx) + routeCode + "\n" + code.substring(startServerIdx);
    }
  }
}

fs.writeFileSync('server.ts', code);
