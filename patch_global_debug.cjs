const fs = require('fs');

let content = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');

// We will add a state to store debug info
content = content.replace(
  "const [error, setError] = useState(false);",
  "const [error, setError] = useState(false);\n  const [debugInfo, setDebugInfo] = useState('');"
);

// We will accumulate debug info
content = content.replace(
  "let totalRon = 0;",
  "let totalRon = 0;\n        let debugStr = '';"
);

content = content.replace(
  "if (port.currency === 'RON') totalRon += portValue;",
  "debugStr += port.name + ': ' + portValue.toFixed(2) + ' ' + port.currency + ' | ';\n          if (port.currency === 'RON') totalRon += portValue;"
);

content = content.replace(
  "setTotalValue(totalRon);",
  "setDebugInfo(debugStr);\n        setTotalValue(totalRon);"
);

// Render it
content = content.replace(
  '<span className="text-lg font-medium tracking-wide">{format(displayValue, displayCurrency)}</span>',
  '<span className="text-lg font-medium tracking-wide">{format(displayValue, displayCurrency)} <span className="text-[10px] text-rose-300 ml-4">{debugInfo}</span></span>'
);

fs.writeFileSync('src/components/GlobalValuationBar.tsx', content);
