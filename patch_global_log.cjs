const fs = require('fs');
let content = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');

const search = "setTotalValue(totalRon);";
const replace = `
        console.log("GlobalValuationBar calculation result:");
        console.log("totalRon:", totalRon);
        setTotalValue(totalRon);
`;
content = content.replace(search, replace);

const search2 = "portValue += qty * currentPrice;";
const replace2 = `
                portValue += qty * currentPrice;
                console.log("Ticker:", t, "Qty:", qty, "CurrentPrice:", currentPrice, "PortValue now:", portValue);
`;
content = content.replace(search2, replace2);

const search3 = "portValue += bal;";
const replace3 = `
              portValue += bal;
              console.log("CASH bal:", bal, "PortValue now:", portValue);
`;
content = content.replace(search3, replace3);

fs.writeFileSync('src/components/GlobalValuationBar.tsx', content);
