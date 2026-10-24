import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('vite:preloadError', () => {
  if (!sessionStorage.getItem('vite_preload_reloaded')) {
    sessionStorage.setItem('vite_preload_reloaded', '1');
    window.location.reload();
  }
});

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; message: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message || 'Unexpected application error' };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A] flex flex-col items-center justify-center p-6 font-sans">
          <div className="bg-white border border-[#E2E8F0] rounded-xl p-6 max-w-md w-full text-center space-y-4">
            <h1 className="text-lg font-bold text-[#0F172A]">Application Update Required</h1>
            <p className="text-xs font-mono text-[#64748B] break-words">{this.state.message}</p>
            <button
              onClick={() => {
                sessionStorage.clear();
                window.location.replace(window.location.pathname + '?v=' + Date.now());
              }}
              className="px-4 py-2 bg-[#1E40AF] text-white text-xs font-semibold rounded-lg hover:bg-[#1E3A8A] transition-colors"
            >
              Reload Latest Version
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </StrictMode>,
);
