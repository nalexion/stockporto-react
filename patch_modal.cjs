const fs = require('fs');

let content = fs.readFileSync('src/components/TransactionModal.tsx', 'utf8');

// Add existingTickers to props
content = content.replace(
  'export default function TransactionModal({ portfolio, editLot, onClose, onSuccess }: { portfolio: Portfolio, editLot?: TradeLot, onClose: () => void, onSuccess: () => void }) {',
  'export default function TransactionModal({ portfolio, editLot, existingTickers = [], onClose, onSuccess }: { portfolio: Portfolio, editLot?: TradeLot, existingTickers?: string[], onClose: () => void, onSuccess: () => void }) {'
);

// Add confirmDelete state
content = content.replace(
  'const [submitting, setSubmitting] = useState(false);',
  'const [submitting, setSubmitting] = useState(false);\n  const [confirmDelete, setConfirmDelete] = useState(false);'
);

// Update handleDelete
content = content.replace(
  `  async function handleDelete() {
    if (!editLot) return;
    if (!window.confirm('Are you sure you want to delete this transaction?')) return;
    setSubmitting(true);
    await deleteLot(editLot.id);
    setSubmitting(false);
    onSuccess();
  }`,
  `  async function handleDelete() {
    if (!editLot) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSubmitting(true);
    await deleteLot(editLot.id);
    setSubmitting(false);
    onSuccess();
  }`
);

// Update Delete button UI
content = content.replace(
  `<button type="button" onClick={handleDelete} disabled={submitting} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium flex items-center gap-2">
                <Trash2 size={16} /> Delete
              </button>`,
  `<button type="button" onClick={handleDelete} disabled={submitting} className="px-4 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium flex items-center gap-2">
                <Trash2 size={16} /> {confirmDelete ? 'Click to Confirm' : 'Delete'}
              </button>`
);

// Update Ticker input based on transactionType
content = content.replace(
  `              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-600 mb-1">Ticker Symbol</label>
                <input
                  type="text"
                  required
                  value={ticker}
                  onChange={e => setTicker(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                  placeholder="e.g. AAPL"
                />
              </div>`,
  `              <div className="col-span-2">
                <label className="block text-sm font-medium text-slate-600 mb-1">Ticker Symbol</label>
                {transactionType === 'DIVIDEND' && existingTickers.length > 0 ? (
                  <select
                    value={ticker}
                    onChange={e => setTicker(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none uppercase bg-white"
                  >
                    <option value="">Select a ticker...</option>
                    {existingTickers.map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={ticker}
                    onChange={e => setTicker(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-4 py-2 focus:ring-2 focus:ring-indigo-500 outline-none uppercase"
                    placeholder="e.g. AAPL"
                  />
                )}
              </div>`
);


fs.writeFileSync('src/components/TransactionModal.tsx', content);
