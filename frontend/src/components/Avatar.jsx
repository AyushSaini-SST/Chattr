import { useRef, useState } from 'react';
import { mediaCrossOrigin, mediaUrl } from '../services/api.js';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { resolveAvatarUrl } from '../features/auth/userState.js';

function initialsFor(name) {
  return String(name || '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('') || '?';
}

export default function Avatar({ src = '', userId, name = '', alt, className = '', size = 36, title, loading = 'lazy', showPresence = false, online = false }) {
  const { user: currentUser } = useAuth();
  const currentSrc = resolveAvatarUrl(currentUser, userId, src);
  const currentSrcRef = useRef(currentSrc);
  currentSrcRef.current = currentSrc;
  const [imageState, setImageState] = useState({ src: '', failed: false, loaded: false });
  const loaded = imageState.src === currentSrc && imageState.loaded;
  const failed = imageState.src === currentSrc && imageState.failed;
  const accessibleName = alt || (name ? `${name}'s profile photo` : 'Profile photo');
  const sizeValue = typeof size === 'number' ? `${size}px` : size;
  return <span className={`avatar chattr-avatar${loaded ? ' image-loaded' : ''} ${className}`.trim()} style={{ '--avatar-size': sizeValue }} role="img" aria-label={accessibleName} title={title}>
    <span className="avatar-fallback" aria-hidden="true">{initialsFor(name)}</span>
    {currentSrc && !failed && <img key={currentSrc} className="avatar-image" src={mediaUrl(currentSrc)} crossOrigin={mediaCrossOrigin(currentSrc)} alt="" loading={loading} decoding="async" onLoad={() => { if (currentSrcRef.current === currentSrc) setImageState({ src: currentSrc, failed: false, loaded: true }); }} onError={() => { if (currentSrcRef.current === currentSrc) setImageState({ src: currentSrc, failed: true, loaded: false }); }} />}
    {showPresence && <i className={`avatar-presence${online ? ' online' : ''}`} aria-label={online ? 'Online' : 'Offline'} />}
  </span>;
}
