const fs = require('fs');
let code = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

// fix double import
code = code.replace("import PortfolioChart from './PortfolioChart';\nimport PortfolioChart from './PortfolioChart';", "import PortfolioChart from './PortfolioChart';");

// add quotesMap state
code = code.replace("const [fxHistory, setFxHistory] = useState<Record<string, number>>({});", "const [fxHistory, setFxHistory] = useState<Record<string, number>>({});\n  const [quotesMap, setQuotesMap] = useState<Record<string, any>>({});");

// set QuotesMap
code = code.replace("setFxHistory(fxRates);", "setFxHistory(fxRates);\n    setQuotesMap(quotes);");

// pass quotesMap
code = code.replace("<PortfolioChart lots={lots} portfolio={portfolio} />", "<PortfolioChart lots={lots} portfolio={portfolio} quotes={quotesMap} />");

fs.writeFileSync('src/components/PortfolioView.tsx', code);
