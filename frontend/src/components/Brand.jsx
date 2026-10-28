import { Link } from 'react-router-dom';

export default function Brand({ className = '' }) {
  return <Link className={['brand', className].filter(Boolean).join(' ')} to="/" aria-label="Chattr home">
    <span className="brand-mark" aria-hidden="true">
      <svg className="brand-mark-icon" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M7 40c1-7 5-11 12-12h3c6 1 9 5 10 12H7Z" fill="currentColor" opacity=".76" />
        <path d="M26 40c1-7 4-11 10-12h2c5 1 8 5 9 12H26Z" fill="currentColor" />
        <path d="M13 17c0-6 3-10 8-10s8 4 8 10v3c0 5-4 9-8 9s-8-4-8-9v-3Z" fill="currentColor" />
        <path d="M29 18c0-6 3-10 8-10s8 4 8 10v3c0 5-4 9-8 9s-8-4-8-9v-3Z" fill="currentColor" opacity=".84" />
        <path d="M10 15c1-7 5-11 11-11 4 0 7 2 9 6-3-1-5-1-7 0-4 2-8 2-13 5Z" fill="currentColor" />
        <path d="M27 14c2-6 6-9 11-9 4 0 7 2 9 6-4-1-7 0-10 2-3 2-6 2-10 1Z" fill="currentColor" opacity=".84" />
        <path d="M23 10c2-3 5-4 8-3" stroke="#E3AD4F" strokeWidth="2" strokeLinecap="round" />
        <path d="M23 7c.7-1.5 1.5-2.4 2.6-3M31 7c.8-1.4 1.6-2.2 2.7-2.8" stroke="#E3AD4F" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="25" cy="4" r="1.2" fill="#E3AD4F" />
      </svg>
      <i className="brand-mark-gold-dot" />
    </span>
    <span className="brand-wordmark">chattr</span>
  </Link>;
}
