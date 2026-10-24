const fs = require('fs');
let content = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');
content = content.split("t === '$CASH_TX'").join("t === '$$CASH_TX'");
fs.writeFileSync('src/components/GlobalValuationBar.tsx', content);
