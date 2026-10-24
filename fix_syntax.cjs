const fs = require('fs');
let content = fs.readFileSync('src/components/PortfolioView.tsx', 'utf8');

const oldStr = `          {globalEstimatedTaxRon > 0 && (
            <p className="text-xs text-slate-400 mt-1 border-t border-slate-50 pt-1">
              Est. Tax: <span className="font-medium text-slate-500">{globalEstimatedTaxRon.toFixed(2)} RON</span>
            </p>
            {harvestableLossRon > 0 && (
              <p className="text-[10px] text-emerald-600 mt-1 font-medium">
                TLH Savings: +{(harvestableLossRon * 0.16).toFixed(2)} RON
              </p>
            )}
          )}`;

const newStr = `          {globalEstimatedTaxRon > 0 && (
            <p className="text-xs text-slate-400 mt-1 border-t border-slate-50 pt-1">
              Est. Tax: <span className="font-medium text-slate-500">{globalEstimatedTaxRon.toFixed(2)} RON</span>
            </p>
          )}
          {harvestableLossRon > 0 && (
            <p className="text-[10px] text-emerald-600 mt-1 font-medium border-t border-slate-50 pt-1">
              TLH Savings: +{(harvestableLossRon * 0.16).toFixed(2)} RON
            </p>
          )}`;

content = content.replace(oldStr, newStr);
fs.writeFileSync('src/components/PortfolioView.tsx', content);
