const fs = require('fs');
let code = fs.readFileSync('src/components/IndexCharts.tsx', 'utf8');

code = code.replace(
  "formatter={(value: number, name: string) => [",
  "formatter={(value: number, name: string, props: any) => ["
);

fs.writeFileSync('src/components/IndexCharts.tsx', code);
