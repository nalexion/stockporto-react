const fs = require('fs');

const globalCode = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');
const listCode = fs.readFileSync('src/components/PortfolioList.tsx', 'utf8');

console.log("Global length:", globalCode.length);
console.log("List length:", listCode.length);

