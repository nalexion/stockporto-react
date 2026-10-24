const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioList.tsx', 'utf8');

code = code.replace(
  "const [loadingStats, setLoadingStats] = useState(true);",
  "const [loadingStats, setLoadingStats] = useState(true);\n  const [allLots, setAllLots] = useState<TradeLot[]>([]);"
);

code = code.replace(
  "setPortfolios(ports);",
  "setPortfolios(ports);\n      setAllLots(lots);"
);

code = code.replace(
  "<IndexCharts />",
  "<IndexCharts lots={allLots} />"
);

fs.writeFileSync('src/components/PortfolioList.tsx', code);
