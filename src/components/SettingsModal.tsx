import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { TaxConfig, DEFAULT_TAX_RULES } from '../config/taxRules';
import { fetchUserSettings, updateUserSettings } from '../lib/api';

interface SettingsModalProps {
  onClose: () => void;
  onSaved?: () => void;
}

export default function SettingsModal({ onClose, onSaved }: SettingsModalProps) {
  const [taxRules, setTaxRules] = useState<TaxConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    async function loadSettings() {
      try {
        const settings = await fetchUserSettings();
        if (settings && settings.taxRules && settings.taxRules.length > 0) {
          setTaxRules(settings.taxRules);
        } else {
          setTaxRules([...DEFAULT_TAX_RULES]);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
        setTaxRules([...DEFAULT_TAX_RULES]);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateUserSettings({ taxRules });
      if (onSaved) onSaved(); onClose();
    } catch (err) {
      console.error("Failed to save settings:", err);
      alert("Failed to save settings");
      setSaving(false);
    }
  };

  const addYear = () => {
    const nextYear = Math.max(...taxRules.map(r => r.year), new Date().getFullYear()) + 1;
    const latestRule = [...taxRules].sort((a, b) => b.year - a.year)[0] || DEFAULT_TAX_RULES[0];
    
    setTaxRules([
      ...taxRules, 
      { 
        year: nextYear, 
        residentShortTerm: latestRule.residentShortTerm, 
        residentLongTerm: latestRule.residentLongTerm, 
        nonResident: latestRule.nonResident, 
        dividend: latestRule.dividend 
      }
    ].sort((a, b) => b.year - a.year));
  };

  const removeYear = (year: number) => {
    setTaxRules(taxRules.filter(r => r.year !== year));
  };

  const updateRule = (year: number, field: keyof TaxConfig, value: number) => {
    setTaxRules(taxRules.map(r => r.year === year ? { ...r, [field]: value } : r));
  };

  return (
    <div className="fixed inset-0 bg-[#0F172A]/40 backdrop-blur-xs flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl border border-[#E2E8F0] shadow-xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-6 border-b border-[#E2E8F0]">
          <h2 className="text-xl font-display font-semibold tracking-tight text-[#0F172A]">Application Settings</h2>
          <button onClick={onClose} className="p-2 text-[#64748B] hover:text-[#0F172A] rounded-lg hover:bg-[#F1F5F9] transition-colors">
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="text-center py-12 text-[#64748B]">Loading settings...</div>
          ) : (
            <div className="space-y-8">
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-display font-semibold tracking-tight text-[#0F172A]">Tax Configurations</h3>
                  <button 
                    onClick={addYear}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#EFF6FF] border border-[#BFDBFE] text-[#1E40AF] text-sm font-medium rounded-lg hover:bg-[#DBEAFE] transition-colors"
                  >
                    <Plus size={16} /> Add Year
                  </button>
                </div>
                
                <p className="text-sm text-[#64748B] mb-6">
                  Configure tax rates for different years. All values are represented as decimals (e.g., 10% = 0.10).
                  The application will fallback to the most recent previous year if a specific year isn't configured.
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="border-b border-[#E2E8F0]">
                        <th className="pb-3 font-semibold text-[#475569] text-sm">Year</th>
                        <th className="pb-3 font-semibold text-[#475569] text-sm">Resident (Short Term)</th>
                        <th className="pb-3 font-semibold text-[#475569] text-sm">Resident (Long Term)</th>
                        <th className="pb-3 font-semibold text-[#475569] text-sm">Non-Resident</th>
                        <th className="pb-3 font-semibold text-[#475569] text-sm">Dividend Tax</th>
                        <th className="pb-3 font-semibold text-[#475569] text-sm text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E2E8F0]">
                      {[...taxRules].sort((a, b) => b.year - a.year).map((rule) => (
                        <tr key={rule.year} className="group">
                          <td className="py-3 pr-4">
                            <input 
                              type="number" 
                              value={rule.year}
                              onChange={(e) => updateRule(rule.year, 'year', parseInt(e.target.value) || rule.year)}
                              className="w-20 px-2 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded text-sm font-mono tabular-nums text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <input 
                              type="number" 
                              step="0.01"
                              value={rule.residentShortTerm}
                              onChange={(e) => updateRule(rule.year, 'residentShortTerm', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded text-sm font-mono tabular-nums text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <input 
                              type="number" 
                              step="0.01"
                              value={rule.residentLongTerm}
                              onChange={(e) => updateRule(rule.year, 'residentLongTerm', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded text-sm font-mono tabular-nums text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <input 
                              type="number" 
                              step="0.01"
                              value={rule.nonResident}
                              onChange={(e) => updateRule(rule.year, 'nonResident', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded text-sm font-mono tabular-nums text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
                            />
                          </td>
                          <td className="py-3 pr-4">
                            <input 
                              type="number" 
                              step="0.01"
                              value={rule.dividend}
                              onChange={(e) => updateRule(rule.year, 'dividend', parseFloat(e.target.value) || 0)}
                              className="w-24 px-2 py-1.5 bg-[#F8FAFC] border border-[#CBD5E1] rounded text-sm font-mono tabular-nums text-[#0F172A] focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF] outline-none"
                            />
                          </td>
                          <td className="py-3 text-right">
                            <button 
                              onClick={() => removeYear(rule.year)}
                              className="p-1.5 text-[#64748B] hover:text-[#E11D48] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Delete Year"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          )}
        </div>
        
        <div className="p-6 border-t border-[#E2E8F0] flex justify-end gap-3 bg-[#F8FAFC]">
          <button 
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-[#475569] hover:bg-[#E2E8F0] bg-[#F1F5F9] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center gap-2 px-5 py-2 bg-[#1E40AF] hover:bg-[#1E3A8A] text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? 'Saving...' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
