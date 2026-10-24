const fs = require('fs');
let content = fs.readFileSync('src/components/PortfolioChart.tsx', 'utf8');

const debugText = `
        <div className="text-xs text-red-500">
          DEBUG cashBal: {data.length > 0 ? (data[data.length-1].value - (data[data.length-1].invested || 0)) : 'none'}
        </div>
`;

content = content.replace(/<div className="flex bg-slate-100 p-1 rounded-lg">/, debugText + '\n<div className="flex bg-slate-100 p-1 rounded-lg">');

fs.writeFileSync('src/components/PortfolioChart.tsx', content);
