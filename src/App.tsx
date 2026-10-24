/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useState, useEffect } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { auth } from './lib/firebase';
import Login from './components/Login';
import { LogOut, Settings } from 'lucide-react';
import { Portfolio, UserSettings, Currency } from './types';
import PortfolioList from './components/PortfolioList';
import PortfolioView from './components/PortfolioView';
import GlobalValuationBar from './components/GlobalValuationBar';
import GlobalCassTracker from './components/GlobalCassTracker';
import SettingsModal from './components/SettingsModal';
import { Briefcase } from 'lucide-react';
import { fetchUserSettings } from './lib/api';

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [selectedPortfolio, setSelectedPortfolio] = useState<Portfolio | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [globalCurrency, setGlobalCurrency] = useState<Currency>(() => {
    return (localStorage.getItem('stocks_global_currency') as Currency) || 'RON';
  });

  const handleCurrencyChange = (c: Currency) => {
    setGlobalCurrency(c);
    localStorage.setItem('stocks_global_currency', c);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (u) {
        loadSettings();
      }
    });
    return () => unsubscribe();
  }, []);

  const loadSettings = async () => {
    try {
      const settings = await fetchUserSettings();
      setUserSettings(settings);
    } catch (e) {
      console.error("Failed to load user settings:", e);
    }
  };

  if (authLoading) return <div className="min-h-screen bg-[#F8FAFC] text-[#64748B] font-mono text-sm flex justify-center items-center">Loading...</div>;
  
  if (!user) return <Login />;

  const triggerRefresh = () => setRefreshTrigger(r => r + 1);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] font-sans flex flex-col">
      <GlobalValuationBar 
        refreshTrigger={refreshTrigger} 
        currency={globalCurrency} 
        onCurrencyChange={handleCurrencyChange} 
      />
      
      <header className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between gap-8">
          <div 
            className="flex items-center gap-2.5 font-display font-bold tracking-tight text-lg cursor-pointer group whitespace-nowrap shrink-0"
            onClick={() => setSelectedPortfolio(null)}
          >
            <Briefcase size={20} className="text-[#1E40AF] transition-colors group-hover:text-[#1E3A8A]" />
            <span className="text-[#0F172A] group-hover:text-[#1E40AF] transition-colors">StocksPortofolio</span>
            <span className="text-xs font-mono tabular-nums font-medium text-[#64748B]">· v{__APP_VERSION__}</span>
          </div>
          <div className="flex items-center gap-5 whitespace-nowrap shrink-0">
            <div className="text-xs font-mono uppercase tracking-wider text-[#64748B] hidden sm:flex items-center gap-2">
              <span>Ledger</span>
              <span>/</span>
              <span className="text-[#0F172A] font-semibold">{selectedPortfolio ? selectedPortfolio.name : 'All Portfolios'}</span>
            </div>
            <div className="h-4 w-px bg-[#E2E8F0] hidden sm:block" />
            <button onClick={() => setShowSettings(true)} className="text-[#64748B] hover:text-[#1E40AF] transition-colors p-1" title="Settings">
              <Settings size={18} />
            </button>
            <button onClick={() => signOut(auth)} className="text-[#64748B] hover:text-[#0F172A] transition-colors p-1" title="Sign Out">
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <GlobalCassTracker refreshTrigger={refreshTrigger} customTaxRules={userSettings?.taxRules} />

      <main className="py-6">
        {selectedPortfolio ? (
          <PortfolioView 
            portfolio={selectedPortfolio} 
            onBack={() => setSelectedPortfolio(null)}
            onTransactionAdded={triggerRefresh}
            onPortfolioUpdated={(p) => setSelectedPortfolio(p)}
            customTaxRules={userSettings?.taxRules}
          />
        ) : (
          <PortfolioList 
            onSelect={setSelectedPortfolio} 
            onPortfolioAdded={triggerRefresh} 
            globalCurrency={globalCurrency}
          />
        )}
      </main>

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} onSaved={loadSettings} />
      )}
    </div>
  );
}
