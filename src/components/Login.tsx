import { useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';
import { Briefcase } from 'lucide-react';

export default function Login() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: import("react").FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        await createUserWithEmailAndPassword(auth, email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] flex flex-col justify-center items-center p-6">
      <div className="bg-white p-8 rounded-xl border border-[#E2E8F0] max-w-md w-full">
        <div className="flex justify-center items-center gap-2.5 text-[#1E40AF] mb-8">
          <Briefcase size={30} />
          <h1 className="text-2xl font-display font-bold tracking-tight text-[#0F172A] flex items-baseline gap-1.5">
            StocksPortofolio <span className="text-xs font-mono tabular-nums font-medium text-[#64748B]">· v{__APP_VERSION__}</span>
          </h1>
        </div>
        
        <h2 className="text-xl font-display font-semibold tracking-tight text-center mb-6 text-[#0F172A]">
          {isLogin ? 'Sign In to Your Account' : 'Create a New Account'}
        </h2>

        {error && (
          <div className="bg-[#FFF1F2] border border-[#FECDD3] text-[#BE123C] p-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1">Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={e => setEmail(e.target.value)} 
              className="w-full px-4 py-2 rounded-lg border border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF]" 
              required 
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[#334155] mb-1">Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              className="w-full px-4 py-2 rounded-lg border border-[#CBD5E1] text-[#0F172A] focus:outline-none focus:ring-2 focus:ring-[#1E40AF] focus:border-[#1E40AF]" 
              required 
              minLength={6}
            />
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-[#1E40AF] text-white py-2.5 rounded-lg hover:bg-[#1E3A8A] transition-colors disabled:opacity-50 font-medium"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Sign Up')}
          </button>
        </form>

        <div className="mt-6 text-center text-sm text-[#64748B]">
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <button 
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-[#1E40AF] hover:underline font-medium"
          >
            {isLogin ? 'Sign Up' : 'Sign In'}
          </button>
        </div>
      </div>
    </div>
  );
}
