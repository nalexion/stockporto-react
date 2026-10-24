const fs = require('fs');
let code = fs.readFileSync('src/components/IndexCharts.tsx', 'utf8');

code = code.replace(
  "onClick={() => setPeriod(p) : null}",
  "onClick={() => setPeriod(p)}"
);

fs.writeFileSync('src/components/IndexCharts.tsx', code);
