const fs = require('fs');
let code = fs.readFileSync('src/components/IndexCharts.tsx', 'utf8');

code = code.replace(
  `<Line 
                 type="monotone" 
                 name="portfolioReturn"
                 dataKey="portfolioReturn" 
                 stroke="#4f46e5" 
                 strokeWidth={2} 
                 dot={false}
                 activeDot={{ r: 4, strokeWidth: 0 }}
              />`,
  `{portfolioHistory && portfolioHistory.length > 0 && (
              <Line 
                 type="monotone" 
                 name="portfolioReturn"
                 dataKey="portfolioReturn" 
                 stroke="#4f46e5" 
                 strokeWidth={2} 
                 dot={false}
                 activeDot={{ r: 4, strokeWidth: 0 }}
              />
              )}`
);

fs.writeFileSync('src/components/IndexCharts.tsx', code);
