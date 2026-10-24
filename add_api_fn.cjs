const fs = require('fs');
let code = fs.readFileSync('src/lib/api.ts', 'utf8');

const newFn = `
export interface PortfolioAnalysisResult {
  riskLevel: string;
  diversificationScore: number;
  keyObservations: string[];
  actionableRecommendations: string[];
  sectorBreakdownEstimate: {
    sectorName: string;
    percentage: number;
    commentary: string;
  }[];
}

export async function analyzePortfolio(holdings: any[], currency: string, totalValue: number): Promise<PortfolioAnalysisResult> {
  const res = await fetch('/api/advisor/analyze-portfolio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ holdings, currency, totalValue }),
  });
  if (!res.ok) {
    throw new Error('Failed to analyze portfolio');
  }
  return res.json();
}
`;

fs.appendFileSync('src/lib/api.ts', newFn);
