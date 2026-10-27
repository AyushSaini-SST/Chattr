import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { getApiError } from '../services/api.js';
import Brand from '../components/Brand.jsx';

export default function AuthPage({ mode }) {
  const isRegister = mode === 'register';
  const { user, loading, login, register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', email: '', displayName: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (loading) return <div className="auth-loading">Opening your space…</div>;
  if (user) return <Navigate to="/" replace />;

  function update(event) { setForm((current) => ({ ...current, [event.target.name]: event.target.value })); }
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (isRegister) await register(form);
      else await login({ identifier: form.username, password: form.password });
      navigate(location.state?.from || '/', { replace: true });
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card"><Brand className="auth-brand" /><div className="auth-eyebrow">A LITTLE SPACE TO CONNECT</div><h1>{isRegister ? 'Find your people.' : 'Welcome back.'}</h1><p className="auth-intro">{isRegister ? 'Create your account and make yourself at home.' : 'Pick up where a good conversation left off.'}</p>
    <form className="auth-form" onSubmit={submit} aria-busy={busy}>
      {isRegister && <><label>Display name<input name="displayName" value={form.displayName} onChange={update} autoComplete="name" maxLength="60" required disabled={busy} placeholder="How people will know you" /></label><label>Username<input name="username" value={form.username} onChange={update} autoComplete="username" minLength="3" maxLength="24" pattern="[A-Za-z0-9_]+" required disabled={busy} placeholder="Choose a username" /></label><label>Email address<input name="email" type="email" value={form.email} onChange={update} autoComplete="email" maxLength="254" required disabled={busy} placeholder="you@example.com" /></label></>}
      {!isRegister && <label>Username or email<input name="username" value={form.username} onChange={update} autoComplete="username" required disabled={busy} placeholder="Your username or email" /></label>}
      <label>Password<input name="password" type="password" value={form.password} onChange={update} autoComplete={isRegister ? 'new-password' : 'current-password'} minLength={isRegister ? 10 : 1} maxLength="128" required disabled={busy} placeholder={isRegister ? 'At least 10 characters' : 'Your password'} /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="auth-submit" disabled={busy}>{busy ? 'One moment…' : isRegister ? 'Create your account' : 'Sign in'}<span>→</span></button>
    </form><div className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Chattr?'} <Link to={isRegister ? '/login' : '/register'}>{isRegister ? 'Sign in' : 'Create an account'}</Link></div><div className="auth-footnote">A calmer corner for the conversations that matter.</div></section><div className="auth-art" aria-hidden="true">
    <svg className="auth-doodles" viewBox="0 0 600 640" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <g className="doodle d-bubble-big"><path d="M120 110c0-26 24-46 56-46h110c32 0 56 20 56 46v52c0 26-24 46-56 46H214l-42 34 6-36c-34-4-58-24-58-48z" /><path d="M160 112h120M160 142h84" strokeDasharray="4 6" /></g>
      <g className="doodle d-bubble-small"><path d="M372 190c0-16 14-28 32-28h70c18 0 32 12 32 28v30c0 16-14 28-32 28h-40l-28 22 4-24c-22-2-38-14-38-28z" /><circle cx="412" cy="206" r="2.5" fill="currentColor" /><circle cx="438" cy="206" r="2.5" fill="currentColor" /><circle cx="464" cy="206" r="2.5" fill="currentColor" /></g>
      <g className="doodle d-plane"><path d="M70 330l200-78-62 150-34-54z" /><path d="M208 348l62-96M174 348l-40 34" /><path d="M20 290c20 10 44 4 60-10" strokeDasharray="3 7" /></g>
      <g className="doodle d-cup"><path d="M330 330h120v58c0 28-24 50-54 50h-12c-30 0-54-22-54-50z" /><path d="M450 346c22 0 34 10 34 24s-12 24-34 24" /><path d="M314 450h152" /><path d="M360 300c0-10 10-10 10-20s-10-10-10-20M392 300c0-10 10-10 10-20s-10-10-10-20" strokeDasharray="4 5" /></g>
      <g className="doodle d-envelope"><rect x="110" y="470" width="150" height="100" rx="8" /><path d="M110 480l75 56 75-56M110 568l56-46M260 568l-56-46" /></g>
      <g className="doodle d-pencil"><path d="M480 468l-96 96-30 8 8-30 96-96z" /><path d="M444 476l24 24M354 574l10-12" /><path d="M480 468l12-12 24 24-12 12" /></g>
      <g className="doodle d-stars"><path d="M520 90l6 16 16 6-16 6-6 16-6-16-16-6 16-6zM60 200l4 10 10 4-10 4-4 10-4-10-10-4 10-4zM540 320l4 10 10 4-10 4-4 10-4-10-10-4 10-4z" /></g>
      <g className="doodle d-sun"><circle cx="520" cy="560" r="26" /><path d="M520 514v-14M520 620v-14M474 560h-14M580 560h-14M487 527l-10-10M563 593l-10-10M487 593l-10 10M563 527l-10 10" /></g>
      <path className="doodle d-squiggle" d="M60 610c20-18 40 18 60 0s40 18 60 0 40 18 60 0 40 18 60 0" />
      <path className="doodle d-heart" d="M304 62c-10-18-40-14-40 10 0 20 24 32 40 44 16-12 40-24 40-44 0-24-30-28-40-10z" />
    </svg>
    <div className="auth-quote"><span>notes from a quiet corner</span><h2>Say the small<br />things too.</h2><p>Post a thought, pass a note, pick up a conversation where you left it. No feed that shouts, no counters that nag. Just your people, on paper.</p></div>
  </div></main>;
}
