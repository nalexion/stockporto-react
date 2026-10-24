const fs = require('fs');
let code = fs.readFileSync('src/components/IndexCharts.tsx', 'utf8');

const importRegex = /import React, \{ useState, useEffect \} from 'react';/;
code = code.replace(importRegex, "import React, { useState, useEffect } from 'react';\nimport { TradeLot } from '../types';\nimport { generatePortfolioHistory } from '../lib/chartUtils';");

const propsRegex = /interface IndexChartsProps \{\n  portfolioHistory\?: any\[\];\n\}/;
code = code.replace(propsRegex, "interface IndexChartsProps {\n  portfolioHistory?: any[];\n  lots?: TradeLot[];\n}");

const componentSigRegex = /export default function IndexCharts\(\{ portfolioHistory = \[\] \}: IndexChartsProps\) \{/;
code = code.replace(componentSigRegex, "export default function IndexCharts({ portfolioHistory = [], lots }: IndexChartsProps) {");

const loadDataOld = `    async function loadData() {
      setLoading(true);
      setError(false);
      try {
        const symbol = INDEX_CONFIG[region].symbol;
        let fetched = await fetchHistorical(symbol, period);
        
        if (!fetched || fetched.length === 0) {
          setError(true);
          setData([]);
        } else {
          let baseIndexPrice = 0;
          let basePortfolioValue = 0;`;

const loadDataNew = `    async function loadData() {
      setLoading(true);
      setError(false);
      try {
        let historyToUse = portfolioHistory;
        if (lots && lots.length > 0 && (!portfolioHistory || portfolioHistory.length === 0)) {
           historyToUse = await generatePortfolioHistory(lots, period);
        }
      
        const symbol = INDEX_CONFIG[region].symbol;
        let fetched = await fetchHistorical(symbol, period);
        
        if (!fetched || fetched.length === 0) {
          setError(true);
          setData([]);
        } else {
          let baseIndexPrice = 0;
          let basePortfolioValue = 100; // Base TWR`;

code = code.replace(loadDataOld, loadDataNew);

const oldPortValueLogic = `          const formatted = fetched.map((d: any, index: number) => {
            const dateStr = d.date.split('T')[0];
            let portValue = 0;
            if (portfolioHistory && portfolioHistory.length > 0) {
               const match = portfolioHistory.find(p => p.date === dateStr);
               if (match) {
                 portValue = match.value;
               } else {
                 for (let i = portfolioHistory.length - 1; i >= 0; i--) {
                   if (portfolioHistory[i].date <= dateStr) {
                     portValue = portfolioHistory[i].value;
                     break;
                   }
                 }
                 if (!portValue && portfolioHistory.length > 0) portValue = portfolioHistory[0].value;
               }
            }

            if (index === 0) {
              baseIndexPrice = d.close;
              basePortfolioValue = portValue;
            }

            return {`;

const newPortValueLogic = `          const formatted = fetched.map((d: any, index: number) => {
            const dateStr = d.date.split('T')[0];
            let portValue = 100; // default to 100 TWR base
            let hasHistory = false;
            
            if (historyToUse && historyToUse.length > 0) {
               hasHistory = true;
               const match = historyToUse.find(p => p.date === dateStr);
               if (match) {
                 portValue = match.twr || 100;
               } else {
                 for (let i = historyToUse.length - 1; i >= 0; i--) {
                   if (historyToUse[i].date <= dateStr) {
                     portValue = historyToUse[i].twr || 100;
                     break;
                   }
                 }
                 if (!portValue && historyToUse.length > 0) portValue = historyToUse[0].twr || 100;
               }
            }

            if (index === 0) {
              baseIndexPrice = d.close;
              basePortfolioValue = hasHistory ? portValue : 100;
            }

            return {`;

code = code.replace(oldPortValueLogic, newPortValueLogic);

const oldDeps = `  }, [region, period, portfolioHistory]);`;
const newDeps = `  }, [region, period, portfolioHistory, lots]);`;
code = code.replace(oldDeps, newDeps);

const oldLine = `{portfolioHistory && portfolioHistory.length > 0 && (
              <Line 
                 type="monotone" 
                 name="portfolioReturn"
                 dataKey="portfolioReturn" `;

const newLine = `{(portfolioHistory && portfolioHistory.length > 0) || (lots && lots.length > 0) ? (
              <Line 
                 type="monotone" 
                 name="portfolioReturn"
                 dataKey="portfolioReturn" `;

code = code.replace(oldLine, newLine);
code = code.replace(`)}`, `) : null}`); // replace the closing tag of the Line condition

fs.writeFileSync('src/components/IndexCharts.tsx', code);
