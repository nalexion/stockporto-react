const fs = require('fs');
let gvb = fs.readFileSync('src/components/GlobalValuationBar.tsx', 'utf8');

gvb = gvb.replace(
  '<span className="text-[10px] text-rose-300 ml-4">{debugInfo}</span>',
  ''
);
gvb = gvb.replace(
  'const [debugInfo, setDebugInfo] = useState(\'\');',
  ''
);
gvb = gvb.replace(
  'setDebugInfo(debugStr);',
  ''
);
gvb = gvb.replace(
  'let debugStr = \'\';',
  ''
);
gvb = gvb.replace(
  'debugStr += port.name + \': \' + portValue.toFixed(2) + \' \' + port.currency + \' | \';',
  ''
);

fs.writeFileSync('src/components/GlobalValuationBar.tsx', gvb);
