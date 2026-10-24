const fs = require('fs');
let code = fs.readFileSync('src/components/IndexCharts.tsx', 'utf8');
if (!code.includes("portfolioHistory && portfolioHistory.length > 0")) {
   console.log("Not found");
} else {
   console.log("Found");
}
