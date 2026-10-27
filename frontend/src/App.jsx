import { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Bell, BellOff, Bookmark, Compass, Download, Hash, Home, LogOut, MessageCircle, Moon, Search, Settings, Sun, Users, X } from 'lucide-react';
import { io } from 'socket.io-client';
import Cropper from 'react-easy-crop';
import AuthPage from './pages/AuthPage.jsx';
import ExplorePage from './pages/ExplorePage.jsx';
import SocialPage, { PostDetail } from './pages/SocialPage.jsx';
import MessagesPage from './pages/MessagesPage.jsx';
import NotificationsPage from './pages/NotificationsPage.jsx';
import { useAuth } from './features/auth/AuthContext.jsx';
import { isCurrentUser } from './features/auth/userState.js';
import { api, getApiError } from './services/api.js';
import { imageSelectionError, PROFILE_IMAGE_MAX_BYTES } from './utils/imageValidation.js';
import { createCroppedAvatarFile } from './utils/cropImage.js';
import Avatar from './components/Avatar.jsx';
import Brand from './components/Brand.jsx';
import { publishFollowRelationshipChange, subscribeToFollowRelationshipChanges } from './features/users/followSync.js';

const navItems = [
  ['/', 'Home', Home], ['/explore', 'Explore', Compass], ['/messages', 'Messages', MessageCircle],
  ['/notifications', 'Notifications', Bell], ['/saved', 'Saved', Bookmark], ['/profile', 'Profile', Users], ['/settings', 'Settings', Settings],
];
const navColorClass = {
  '/': 'nav-home',
  '/explore': 'nav-explore',
  '/messages': 'nav-messages',
  '/notifications': 'nav-notifications',
  '/saved': 'nav-saved',
  '/profile': 'nav-profile',
  '/settings': 'nav-settings',
};

function Sidebar() {
  const { user, logout } = useAuth();
  const [error, setError] = useState('');
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    api.get('/api/notifications').then(({ data }) => setUnread(data.unreadCount)).catch(() => {});
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', { withCredentials: true });
    socket.on('notification:new', () => setUnread((count) => count + 1));
    socket.on('notifications:count', ({ unreadCount }) => setUnread(unreadCount));
    return () => socket.disconnect();
  }, []);
  async function signOut() { try { await logout(); } catch (requestError) { setError(getApiError(requestError)); } }
  return <aside className="sidebar"><Brand /><div className="workspace-label">YOUR SPACE</div><nav className="main-nav" aria-label="Main navigation">
    {navItems.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link ${navColorClass[to]}${isActive ? ' active' : ''}`}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{to === '/notifications' && unread > 0 && <i className="nav-count">{unread > 99 ? '99+' : unread}</i>}</NavLink>)}
  </nav><div className="sidebar-bottom"><div className="sidebar-note"><span className="note-dot" />Your corner of the internet, thoughtfully connected.</div>{error && <p className="inline-error">{error}</p>}<div className="profile-chip"><Avatar className="avatar-you" src={user.avatarUrl} name={user.displayName} userId={user._id} size={34} /><div className="profile-chip-copy"><strong>{user.displayName}</strong><span>@{user.username}</span></div><button className="signout-button" onClick={signOut} aria-label="Sign out"><LogOut size={15} /></button></div></div></aside>;
}

function ThemeButton({ theme, onToggle }) {
  const Icon = theme === 'light' ? Moon : Sun;
  return <button className="icon-button" onClick={onToggle} aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}><Icon size={18} /></button>;
}

function Topbar({ title }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState({ users: [], posts: [] });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setResults({ users: [], posts: [] }); setSearchError(''); setSearchLoading(false); return undefined; }
    let alive = true;
    const timer = setTimeout(async () => {
      setSearchLoading(true); setSearchError('');
      try { const { data } = await api.get(`/api/search?q=${encodeURIComponent(term)}`); if (alive) setResults(data); }
      catch (requestError) { if (alive) setSearchError(getApiError(requestError)); }
      finally { if (alive) setSearchLoading(false); }
    }, 220);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);
  function goTo(path) { setSearchOpen(false); setQuery(''); navigate(path); }
  return <header className="topbar"><div className="topbar-context"><div className="mobile-brand"><Brand /></div><div className="breadcrumbs">Chattr <span>/</span> <strong>{title}</strong></div></div><div className="topbar-actions"><form className={`search-control${searchOpen ? ' open' : ''}`} role="search" onClick={() => { if (!searchOpen) setSearchOpen(true); }} onSubmit={(event) => { event.preventDefault(); setSearchOpen(true); }}><button type="button" className="search-expand" onClick={() => setSearchOpen(true)} aria-label="Open search"><Search size={16} /></button><input value={query} onKeyDown={(event) => { if (event.key === 'Escape') setSearchOpen(false); }} onFocus={() => setSearchOpen(true)} onChange={(event) => { setQuery(event.target.value); setResults({ users: [], posts: [] }); setSearchOpen(true); }} placeholder="Search people and posts" aria-label="Search people and posts" /><kbd>⌘ K</kbd>{searchOpen && <button type="button" className="search-close" onClick={() => setSearchOpen(false)} aria-label="Close search"><X size={15} /></button>}{searchOpen && (query.trim().length > 0) && <div className="search-results" role="region" aria-label="Search results">{searchLoading ? <div className="search-state">Searching Chattr…</div> : searchError ? <div className="search-state search-error">{searchError}</div> : query.trim().length < 2 ? <div className="search-state">Type at least 2 characters.</div> : !results.users.length && !results.posts.length ? <div className="search-state">No people or posts found.</div> : <><div className="search-group-label">PEOPLE</div>{results.users.length ? results.users.map((person) => <button type="button" className="search-result" key={person._id} onClick={() => goTo(`/u/${person.username}`)}><Avatar className="search-avatar" src={person.avatarUrl} name={person.displayName} userId={person._id} size={34} /><span><strong>{person.displayName}</strong><small>@{person.username}{person.isPrivate ? ' · Private' : ''}</small></span></button>) : <div className="search-state compact">No matching people.</div>}<div className="search-group-label">POSTS</div>{results.posts.length ? results.posts.map((post) => <button type="button" className="search-result search-post-result" key={post._id} onClick={() => goTo(`/p/${post._id}`)}><span><strong>{post.author.displayName}</strong><small>{post.text}</small></span></button>) : <div className="search-state compact">No matching posts.</div>}</>}</div>}</form><ThemeButton theme={document.documentElement.dataset.theme || 'light'} onToggle={() => window.dispatchEvent(new Event('toggle-theme'))} /><NavLink to="/profile" className="avatar-link" title={user.displayName} aria-label={`Open ${user.displayName}'s profile`}><Avatar className="avatar-top" src={user.avatarUrl} name={user.displayName} userId={user._id} size={31} loading="eager" /></NavLink></div></header>;
}

function HomeRightRail({ className = '', showSuggestions = true }) {
  const [suggestions, setSuggestions] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversationId, setSelectedConversationId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const suggestionsRequestVersion = useRef(0);
  useEffect(() => {
    let alive = true;
    async function refreshSuggestions() {
      const requestVersion = ++suggestionsRequestVersion.current;
      try {
        const { data } = await api.get('/api/users/suggestions');
        if (alive && requestVersion === suggestionsRequestVersion.current) setSuggestions(data.users);
        return data.users;
      } catch (requestError) {
        if (alive && requestVersion === suggestionsRequestVersion.current) setError(getApiError(requestError));
        throw requestError;
      }
    }
    async function refreshConversations() {
      try {
        const { data } = await api.get('/api/messages');
        if (alive) setConversations(data.conversations);
      } catch (requestError) { if (alive) setError(getApiError(requestError)); }
    }
    const socket = io(import.meta.env.VITE_API_URL || 'http://localhost:5000', { withCredentials: true });
    socket.on('conversation:update', refreshConversations);
    if (showSuggestions) socket.on('account:blocks:update', () => { refreshSuggestions().catch(() => {}); });
    socket.on('conversation:unavailable', ({ conversationId }) => {
      refreshConversations();
      setSelectedConversationId((current) => current === conversationId ? null : current);
    });
    const handleFollowChange = ({ detail }) => {
      setError('');
      if (detail?.following || detail?.requestPending) {
        setSuggestions((current) => current.filter((person) => person.username !== detail.username));
      }
      refreshSuggestions().catch(() => {});
    };
    const unsubscribeFollowChanges = showSuggestions ? subscribeToFollowRelationshipChanges(handleFollowChange) : () => {};
    Promise.allSettled([showSuggestions ? refreshSuggestions() : Promise.resolve(null), api.get('/api/messages')])
      .then(([, conversationResult]) => {
        if (!alive) return;
        if (conversationResult.status === 'fulfilled') setConversations(conversationResult.value.data.conversations);
        else setError(getApiError(conversationResult.reason));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; suggestionsRequestVersion.current += 1; unsubscribeFollowChanges(); socket.disconnect(); };
  }, [showSuggestions]);
  async function toggleFollow(person) {
    setError('');
    try {
      const { data } = await api.request({ method: person.isFollowing || person.hasPendingFollowRequest ? 'delete' : 'post', url: `/api/users/${person.username}/follow` });
      publishFollowRelationshipChange({ username: person.username, following: Boolean(data.following), requestPending: Boolean(data.requestPending) });
    } catch (requestError) { setError(getApiError(requestError)); }
  }
  return <aside className={['right-rail', 'home-right-rail', className].filter(Boolean).join(' ')}>
    {showSuggestions && <section className="rail-card home-widget people-suggestions-widget"><div className="rail-card-header"><div><span className="section-kicker">MEET THE COMMUNITY</span><h3>People to follow</h3></div><Users size={18} strokeWidth={1.7} /></div>{loading ? <div className="home-widget-state">Finding people…</div> : suggestions.length ? <div className="suggestion-list">{suggestions.map((person) => <div className="suggestion-row" key={person._id}><NavLink className="avatar-profile-link" to={`/u/${person.username}`} aria-label={`Open ${person.displayName} profile`}><Avatar className="avatar-you" src={person.avatarUrl} name={person.displayName} userId={person._id} size={34} /></NavLink><NavLink className="suggestion-identity" to={`/u/${person.username}`}><strong>{person.displayName}</strong><span>@{person.username}{person.isPrivate ? ' · Private' : person.headline ? ` · ${person.headline}` : ''}</span></NavLink><button className={`suggestion-follow${person.isFollowing ? ' following' : ''}${person.hasPendingFollowRequest ? ' requested' : ''}`} onClick={() => toggleFollow(person)} aria-label={`${person.hasPendingFollowRequest ? 'Cancel follow request to' : person.isFollowing ? 'Unfollow' : 'Follow'} ${person.displayName}`}>{person.isFollowing ? 'Following' : person.hasPendingFollowRequest ? 'Requested' : 'Follow'}</button></div>)}</div> : <div className="home-widget-state">No people to suggest yet. Check back as the community grows.</div>}{error && <p className="inline-error" role="alert">{error}</p>}<NavLink className="rail-link" to="/explore">Explore people <span>→</span></NavLink></section>}
    <section className="rail-card home-widget recent-conversations-widget"><div className="rail-card-header"><div><span className="section-kicker">PICK UP WHERE YOU LEFT OFF</span><h3>Recent conversations</h3></div><MessageCircle size={18} strokeWidth={1.7} /></div>{loading ? <div className="home-widget-state">Loading conversations…</div> : conversations.length ? <div className="recent-conversations">{conversations.slice(0, 3).map((conversation) => <button className="recent-conversation" key={conversation._id} onClick={() => setSelectedConversationId(conversation._id)}><Avatar className="conversation-avatar" src={conversation.participant.avatarUrl} name={conversation.participant.displayName} userId={conversation.participant._id} size={36} /><span className="recent-conversation-copy"><strong>{conversation.participant.displayName}</strong><span>{conversation.lastMessage || 'Start a conversation'}</span></span>{conversation.unreadCount > 0 && <i className="recent-unread" aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 9 ? '9+' : conversation.unreadCount}</i>}</button>)}</div> : <div className="home-widget-state">No conversations yet. Find someone to say hello to.</div>}<NavLink className="rail-link" to="/messages">View all conversations <span aria-hidden="true">→</span></NavLink></section>
    {selectedConversationId && <section className="rail-card quick-chat-card" aria-label="Quick chat"><MessagesPage key={selectedConversationId} initialConversationId={selectedConversationId} quickChat onQuickChatClose={() => setSelectedConversationId(null)} onConversationsChange={setConversations} /></section>}
  </aside>;
}

function PageHeading({ eyebrow, title, subtitle, icon: Icon, className = '' }) {
  return <section className={`page-heading${className ? ` ${className}` : ''}`}><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div><div className="heading-illustration"><div className="illustration-ring ring-one" /><div className="illustration-ring ring-two" /><Icon size={26} strokeWidth={1.4} /></div></section>;
}

function HomePageLayout({ title, subtitle, Icon }) {
  return <main className="main-content">
    <Topbar title={title} />
    <div className="content-grid home-content-grid">
      <section className="feed-column home-main-column" aria-label="Your feed and post composer">
        <PageHeading eyebrow="YOUR COMMUNITY" title="Home" subtitle={subtitle} icon={Icon} className="home-page-heading" />
        <SocialPage mode="following" />
      </section>
      <HomeRightRail className="home-page-right-rail" />
    </div>
  </main>;
}

function ExplorePageLayout({ title, subtitle, Icon }) {
  return <main className="main-content">
    <Topbar title={title} />
    <PageHeading eyebrow="DISCOVERY" title="Explore" subtitle="Find accounts and public conversations." icon={Icon} className="explore-page-heading" />
    <div className="content-grid explore-content-grid">
      <section className="feed-column explore-main-column" aria-label="Explore people and public posts"><ExplorePage /></section>
      <HomeRightRail className="explore-right-rail" showSuggestions={false} />
    </div>
  </main>;
}

function ProfileRelationshipModal({ username, kind, onClose }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [actionUser, setActionUser] = useState('');
  const [actionError, setActionError] = useState('');
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);
  async function load(nextCursor = null) {
    if (nextCursor) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const suffix = nextCursor ? `?cursor=${encodeURIComponent(nextCursor)}` : '';
      const { data } = await api.get(`/api/users/${encodeURIComponent(username)}/${kind}${suffix}`);
      setUsers((current) => nextCursor ? [...current, ...data.users] : data.users);
      setCursor(data.nextCursor || null);
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); setLoadingMore(false); }
  }
  useEffect(() => { load(); }, [username, kind]);
  async function toggleFollow(person) {
    setActionUser(person._id); setActionError('');
    try {
      const method = person.isFollowing || person.hasPendingFollowRequest ? 'delete' : 'post';
      const { data } = await api.request({ method, url: `/api/users/${encodeURIComponent(person.username)}/follow` });
      setUsers((current) => current.map((item) => item._id === person._id ? {
        ...item, isFollowing: Boolean(data.following), hasPendingFollowRequest: Boolean(data.requestPending),
      } : item));
    } catch (requestError) { setActionError(getApiError(requestError)); }
    finally { setActionUser(''); }
  }
  return <div className="profile-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="profile-relationship-modal" role="dialog" aria-modal="true" aria-labelledby="profile-list-title" aria-busy={loading || loadingMore}>
      <header><div><span className="section-kicker">COMMUNITY</span><h2 id="profile-list-title">{kind === 'followers' ? 'Followers' : 'Following'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="Close list"><X size={17} /></button></header>
      {actionError && <p className="inline-error" role="alert">{actionError}</p>}
      {error && users.length === 0 ? <div className="profile-list-state"><p role="alert">{error}</p><button className="outline-button" onClick={() => load(cursor || null)}>Try again</button></div>
        : loading && users.length === 0 ? <div className="profile-list-state" role="status">Loading {kind}…</div>
          : users.length === 0 ? <div className="profile-list-state"><strong>No {kind} yet</strong><span>This list is empty for now.</span>{cursor && <button className="outline-button profile-list-more" disabled={loadingMore} onClick={() => load(cursor)}>{loadingMore ? 'Loading…' : error ? 'Retry loading more' : 'Load more'}</button>}</div>
            : <div className="profile-relationship-list">
              {error && <p className="inline-error" role="alert">{error}</p>}
              {users.map((person) => <article className="profile-relationship-row" key={person._id}>
              <button className="profile-list-person" onClick={() => { onClose(); navigate(`/u/${person.username}`); }}>
                <Avatar className="avatar-you" src={person.avatarUrl} name={person.displayName} userId={person._id} size={40} />
                <span className="profile-list-identity"><strong>{person.displayName}</strong><small>@{person.username}</small></span>
              </button>
              {!isCurrentUser(user, person._id) && <button className={`outline-button profile-list-follow${person.isFollowing ? ' is-following' : ''}`} disabled={actionUser === person._id} onClick={() => toggleFollow(person)}>
                {actionUser === person._id ? 'Saving…' : person.isFollowing ? 'Following' : person.hasPendingFollowRequest ? 'Requested' : 'Follow'}
              </button>}
            </article>)}
              {cursor && <button className="outline-button profile-list-more" disabled={loadingMore} onClick={() => load(cursor)}>{loadingMore ? 'Loading…' : error ? 'Retry loading more' : 'Load more'}</button>}
            </div>}
    </section>
  </div>;
}

function ProfileHero({ profile, isSelf = false, onEdit, onFollow, onMessage, onBlock, busy = false }) {
  const [listKind, setListKind] = useState('');
  return <section className="profile-hero">
    <Avatar className="profile-hero-avatar profile-large" src={profile.avatarUrl} name={profile.displayName} userId={profile._id} size="clamp(88px,11vw,116px)" />
    <div className="profile-hero-main">
      <div className="profile-hero-top">
        <div className="profile-identity"><h2>{profile.displayName}</h2><span>@{profile.username}</span></div>
        <div className="profile-actions" aria-label={isSelf ? 'Profile actions' : 'Relationship actions'}>
          {isSelf && onEdit && <button className="primary-button profile-edit-button" onClick={onEdit}>Edit Profile</button>}
          {!isSelf && profile.isBlockedByMe ? <button type="button" className="outline-button profile-block-button is-unblock" onClick={onBlock} disabled={busy}>{busy ? 'Updating…' : 'Unblock'}</button> : !isSelf && <>
            <button className={`outline-button profile-follow-button${profile.isFollowing ? ' is-following' : profile.hasPendingFollowRequest ? ' is-requested' : ''}`} onClick={onFollow} disabled={busy}>{busy ? 'Updating…' : profile.isFollowing ? 'Unfollow' : profile.hasPendingFollowRequest ? 'Cancel request' : 'Follow'}</button>
            <button className={`primary-button profile-message-button${profile.isPrivate ? ' private-profile-message-button' : ''}`} onClick={onMessage}>Message</button>
            <button type="button" className="outline-button profile-block-button" onClick={onBlock} disabled={busy}>Block</button>
          </>}
        </div>
      </div>
      {profile.canViewDetails ? <>
        <div className="profile-stat-row"><button type="button" onClick={() => setListKind('followers')}><strong>{profile.followerCount ?? 0}</strong> followers</button><button type="button" onClick={() => setListKind('following')}><strong>{profile.followingCount ?? 0}</strong> following</button></div>
        {profile.headline && <p className="profile-headline">{profile.headline}</p>}
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        {profile.profileLink && <a className="profile-link" href={profile.profileLink} target="_blank" rel="noreferrer">{profile.profileLink}</a>}
        {profile.isPrivate && <span className="profile-privacy-label">Private profile</span>}
      </> : <p className="profile-private-note">{profile.isBlockedByMe ? 'You blocked this account. Unblock it to view the profile again.' : 'This profile is private. Follow to see profile details and posts.'}</p>}
    </div>
    {listKind && <ProfileRelationshipModal username={profile.username} kind={listKind} onClose={() => setListKind('')} />}
  </section>;
}

function ProfileEditModal({ profile, onClose, onSaved, onAvatarSaved }) {
  const [form, setForm] = useState({ displayName: profile.displayName, bio: profile.bio || '', headline: profile.headline || '', profileLink: profile.profileLink || '', isPrivate: Boolean(profile.isPrivate), messagePreference: profile.messagePreference || 'followers' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [avatarNotice, setAvatarNotice] = useState('');
  const [cropSource, setCropSource] = useState('');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState(null);
  const [cropBusy, setCropBusy] = useState(false);
  useEffect(() => () => { if (cropSource) URL.revokeObjectURL(cropSource); }, [cropSource]);
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape' || busy || avatarBusy || cropBusy) return;
      if (cropSource) { setCropSource(''); setCroppedArea(null); }
      else onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [avatarBusy, busy, cropBusy, cropSource, onClose]);
  function update(event) {
    const { name, value, checked, type } = event.target;
    setForm((current) => ({ ...current, [name]: type === 'checkbox' ? checked : value }));
  }
  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.patch('/api/users/me', form);
      await onSaved(data.user);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setBusy(false);
    }
  }
  function selectAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = imageSelectionError(file, PROFILE_IMAGE_MAX_BYTES);
    if (validationError) { setCropSource(''); setError(validationError); return; }
    setError(''); setCrop({ x: 0, y: 0 }); setZoom(1); setCroppedArea(null); setCropSource(URL.createObjectURL(file));
  }
  async function applyCrop() {
    if (!cropSource || !croppedArea) return;
    setCropBusy(true); setError('');
    try {
      const croppedFile = await createCroppedAvatarFile(cropSource, croppedArea);
      const validationError = imageSelectionError(croppedFile, PROFILE_IMAGE_MAX_BYTES);
      if (validationError) { setError(validationError); return; }
      const uploaded = await uploadAvatar(croppedFile);
      if (uploaded) { setCropSource(''); setCroppedArea(null); setAvatarNotice('Profile photo updated.'); }
    } catch (cropError) {
      setError(cropError.message || 'Could not crop this photo. Please try another image.');
    } finally { setCropBusy(false); }
  }
  function cancelCrop() {
    if (cropBusy) return;
    setCropSource(''); setCroppedArea(null); setError('');
  }
  async function uploadAvatar(file) {
    if (!file || avatarBusy) return false;
    setAvatarBusy(true); setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      const { data } = await api.post('/api/users/me/avatar', body);
      await onAvatarSaved(data.user);
      return true;
    } catch (requestError) { setError(getApiError(requestError)); return false; }
    finally { setAvatarBusy(false); }
  }
  return <div className="profile-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !avatarBusy && !cropBusy) onClose(); }}>
    <section className="profile-edit-modal" role="dialog" aria-modal="true" aria-labelledby="profile-edit-title">
      <header><div><span className="section-kicker">YOUR PROFILE</span><h2 id="profile-edit-title">{cropSource ? 'Crop profile photo' : 'Edit profile'}</h2></div><button type="button" className="icon-button" onClick={cropSource ? cancelCrop : onClose} disabled={busy || avatarBusy || cropBusy} aria-label={cropSource ? 'Cancel photo crop' : 'Close edit profile'}><X size={17} /></button></header>
      {cropSource ? <section className="avatar-crop-flow" aria-label="Crop profile photo">
        <p>Move and zoom your photo to fit the circle.</p>
        <div className="avatar-crop-stage"><Cropper image={cropSource} crop={crop} zoom={zoom} aspect={1} cropShape="round" showGrid={false} minZoom={1} maxZoom={4} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_area, pixels) => setCroppedArea(pixels)} /></div>
        <label className="avatar-crop-zoom">Zoom <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} aria-label="Zoom profile photo" /></label>
        <label className="outline-button profile-photo-select avatar-crop-replace">Choose another image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectAvatar} disabled={cropBusy} /></label>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="profile-modal-actions"><button type="button" className="outline-button" onClick={cancelCrop} disabled={cropBusy || avatarBusy}>Cancel</button><button type="button" className="primary-button" onClick={applyCrop} disabled={cropBusy || avatarBusy || !croppedArea}>{cropBusy || avatarBusy ? 'Cropping & uploading…' : 'Apply Crop & Upload'}</button></div>
      </section> : <form className="profile-form" onSubmit={save} aria-busy={busy}>
        <section className="profile-avatar-editor" aria-label="Profile photo">
          <Avatar className="profile-avatar-preview" src={profile.avatarUrl} name={profile.displayName} size="clamp(64px,18vw,76px)" loading="eager" />
          <div className="profile-avatar-controls"><strong>Profile photo</strong><p>JPG, PNG, WebP, or GIF up to 5 MB.</p><label className="outline-button profile-photo-select">Choose image<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectAvatar} disabled={avatarBusy || busy} /></label>{avatarNotice && <p className="success-message" role="status">{avatarNotice}</p>}</div>
        </section>
        <fieldset className="profile-form-group"><legend>Profile details</legend>
          <label>Display name<input name="displayName" value={form.displayName} onChange={update} maxLength="60" required /></label>
          <label>Headline<input name="headline" value={form.headline} onChange={update} maxLength="100" placeholder="A short line about what you do" /></label>
          <label>Bio<textarea name="bio" value={form.bio} onChange={update} maxLength="280" rows="4" placeholder="A little about you" /></label>
          <label>External link<input name="profileLink" type="url" value={form.profileLink} onChange={update} placeholder="https://example.com" /></label>
        </fieldset>
        <fieldset className="profile-form-group profile-preferences-group"><legend>Privacy and messaging</legend>
          <label>Who can message you<select name="messagePreference" value={form.messagePreference} onChange={update}><option value="everyone">Everyone can send a request</option><option value="followers">Followers can message</option><option value="nobody">No new messages</option></select></label>
          <label className="privacy-toggle"><input name="isPrivate" type="checkbox" checked={form.isPrivate} onChange={update} /><span>Private profile <small>Only your followers can view your posts and profile details.</small></span></label>
        </fieldset>
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="profile-modal-actions"><button type="button" className="outline-button" onClick={onClose} disabled={busy || avatarBusy}>Cancel</button><button className="primary-button" disabled={busy || avatarBusy}>{busy ? 'Saving…' : 'Save profile'}</button></div>
      </form>}
    </section>
  </div>;
}

function ProfilePage() {
  const { user, updateCurrentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [followRequests, setFollowRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get(`/api/users/${user.username}`).then(({ data }) => { if (alive) setProfile(data.user); })
      .catch((requestError) => { if (alive) setError(getApiError(requestError)); })
      .finally(() => { if (alive) setLoading(false); });
    api.get('/api/users/follow-requests').then(({ data }) => { if (alive) setFollowRequests(data.requests); })
      .catch((requestError) => { if (alive) setRequestError(getApiError(requestError)); });
    return () => { alive = false; };
  }, [user.username]);
  async function saveProfile(updatedUser) {
    setProfile((current) => ({ ...current, ...updatedUser }));
    updateCurrentUser(updatedUser);
    setNotice('Your profile has been updated.');
    setEditing(false);
  }
  async function saveAvatar(updatedUser) {
    setProfile((current) => ({ ...current, ...updatedUser }));
    updateCurrentUser(updatedUser);
  }
  async function decideRequest(requestId, decision) {
    setRequestError('');
    try {
      await api.patch(`/api/users/follow-requests/${requestId}`, { decision });
      setFollowRequests((current) => current.filter((request) => request._id !== requestId));
      if (decision === 'approve') setProfile((current) => ({ ...current, followerCount: current.followerCount + 1 }));
    } catch (requestError) { setRequestError(getApiError(requestError)); }
  }
  if (loading) return <div className="feed-loading">Opening your profile…</div>;
  if (error || !profile) return <div className="social-empty"><h3>Profile unavailable.</h3><p>{error || 'We could not load your profile.'}</p></div>;
  return <div className="profile-page">
    <ProfileHero profile={profile} isSelf onEdit={() => setEditing(true)} />
    {(followRequests.length > 0 || requestError) && <section className="profile-follow-requests" aria-labelledby="profile-follow-requests-title">
      <header><div><span className="section-kicker">PRIVATE PROFILE</span><h2 id="profile-follow-requests-title">Follow requests</h2><p>Review people who want to see your private posts.</p></div></header>
      {requestError && <p className="inline-error" role="alert">{requestError}</p>}
      {followRequests.map((request) => <div className="follow-request-row" key={request._id}><Avatar className="avatar-you" src={request.follower.avatarUrl} name={request.follower.displayName} userId={request.follower._id} size={34} /><div><strong>{request.follower.displayName}</strong><span>@{request.follower.username}</span></div><button className="outline-button" onClick={() => decideRequest(request._id, 'reject')}>Reject</button><button className="primary-button" onClick={() => decideRequest(request._id, 'approve')}>Approve</button></div>)}
    </section>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    <div className="profile-posts-section"><SocialPage mode="profile" username={profile.username} /></div>
    {editing && <ProfileEditModal profile={profile} onClose={() => setEditing(false)} onSaved={saveProfile} onAvatarSaved={saveAvatar} />}
  </div>;
}
function BlockedAccountsPanel() {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [unblocking, setUnblocking] = useState('');
  const [notice, setNotice] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get('/api/users/blocked').then(({ data }) => { if (active) setUsers(data.users); })
      .catch((requestError) => { if (active) setError(getApiError(requestError)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retryKey]);
  async function unblock(username) {
    setUnblocking(username); setError(''); setNotice('');
    try { await api.delete(`/api/users/${username}/block`); setUsers((current) => current.filter((person) => person.username !== username)); setNotice(`@${username} has been unblocked.`); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setUnblocking(''); }
  }
  return <section className="settings-card settings-blocked-section" aria-labelledby="blocked-accounts-title" aria-busy={loading || Boolean(unblocking)}>
    <header className="settings-section-heading"><div><span className="section-kicker">ACCOUNT SAFETY</span><h2 id="blocked-accounts-title">Blocked accounts</h2><p>People you block can’t contact you or view your profile and posts.</p></div></header>
    {error && <div className="settings-blocked-error" role="alert"><p>{error}</p><button className="outline-button" onClick={() => setRetryKey((key) => key + 1)}>Try again</button></div>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {loading ? <div className="settings-state" role="status">Loading blocked accounts…</div> : !error && users.length ? <div className="blocked-people-list">{users.map((person) => <div className="blocked-person" key={person._id}><Avatar className="avatar-you" src={person.avatarUrl} name={person.displayName} userId={person._id} size={40} /><div><strong>{person.displayName}</strong><span>@{person.username}</span></div><button className="outline-button" onClick={() => unblock(person.username)} disabled={Boolean(unblocking)}>{unblocking === person.username ? 'Unblocking…' : 'Unblock'}</button></div>)}</div> : !error ? <div className="settings-state settings-empty">You haven’t blocked anyone.</div> : null}
  </section>;
}

function QuietHoursPanel() {
  const { user, updateCurrentUser } = useAuth();
  const stored = user.quietHours || {};
  const [enabled, setEnabled] = useState(Boolean(stored.enabled));
  const [start, setStart] = useState(stored.start || '22:00');
  const [end, setEnd] = useState(stored.end || '07:00');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function save(event) {
    event.preventDefault();
    setSaving(true); setError(''); setNotice('');
    try {
      const timezoneOffset = -new Date().getTimezoneOffset();
      const { data } = await api.patch('/api/users/me', { quietHours: { enabled, start, end, timezoneOffset } });
      updateCurrentUser(data.user);
      setNotice(enabled ? `Quiet hours on from ${start} to ${end}. Notifications still arrive, just without the live ping.` : 'Quiet hours are off.');
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setSaving(false); }
  }
  return <section className="settings-card settings-quiet-card" aria-labelledby="quiet-hours-title">
    <form onSubmit={save} aria-busy={saving}>
      <div className="settings-section-heading"><div><span className="section-kicker">PEACE AND QUIET</span><h2 id="quiet-hours-title">Quiet hours</h2><p>During this window Chattr keeps new notifications in your inbox without the realtime nudge. Times use this device's clock.</p></div><BellOff size={18} strokeWidth={1.7} aria-hidden="true" /></div>
      <div className="quiet-hours-controls">
        <label className="privacy-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={saving} /><span>Turn on quiet hours</span></label>
        <label>From<input type="time" value={start} onChange={(event) => setStart(event.target.value)} disabled={saving || !enabled} required /></label>
        <label>Until<input type="time" value={end} onChange={(event) => setEnd(event.target.value)} disabled={saving || !enabled} required /></label>
        <button className="outline-button" disabled={saving}>{saving ? 'Saving…' : 'Save quiet hours'}</button>
      </div>
      {notice && <p className="success-message" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </form>
  </section>;
}

function ExportDataPanel() {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function download() {
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.get('/api/users/me/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `chattr-export-${user.username}.json`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('Your export is downloading.');
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  return <section className="settings-card settings-action-card settings-export-card"><div className="settings-section-heading"><div><span className="section-kicker">YOUR DATA</span><h2>Export my data</h2><p>Download a JSON file with your profile, posts, comments, saved posts, follows and messages.</p></div><button type="button" className="outline-button" onClick={download} disabled={busy}><Download size={15} aria-hidden="true" /> {busy ? 'Preparing…' : 'Download JSON'}</button></div>{notice && <p className="success-message" role="status">{notice}</p>}{error && <p className="inline-error" role="alert">{error}</p>}</section>;
}

function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || (localStorage.getItem('chattr-theme') === 'dark' ? 'dark' : 'light'));
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  useEffect(() => {
    const syncTheme = () => setTheme((current) => current === 'light' ? 'dark' : 'light');
    window.addEventListener('toggle-theme', syncTheme);
    return () => window.removeEventListener('toggle-theme', syncTheme);
  }, []);
  function chooseTheme(nextTheme) {
    if (nextTheme !== theme) window.dispatchEvent(new Event('toggle-theme'));
  }
  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try { await logout(); navigate('/login', { replace: true }); }
    catch (requestError) { setSignOutError(getApiError(requestError)); setSigningOut(false); }
  }
  return <div className="settings-page">
    <header className="settings-intro"><div><span className="section-kicker">YOUR PREFERENCES</span><h1>Settings</h1><p>Choose how Chattr looks and manage your account.</p></div><div className="settings-account"><Avatar className="avatar-you" src={user.avatarUrl} name={user.displayName} userId={user._id} size={34} /><div><strong>{user.displayName}</strong><span>@{user.username}</span></div></div></header>
    <section className="settings-card settings-theme-card" aria-labelledby="settings-theme-title"><div className="settings-section-heading"><div><span className="section-kicker">APPEARANCE</span><h2 id="settings-theme-title">Theme</h2><p>Your selection is saved on this device and applies across Chattr.</p></div><span className="settings-theme-status" aria-live="polite">{theme === 'dark' ? 'Dark mode selected' : 'Light mode selected'}</span></div><div className="settings-theme-options">
      <button type="button" className={`settings-theme-choice${theme === 'light' ? ' selected' : ''}`} aria-pressed={theme === 'light'} onClick={() => chooseTheme('light')}><span className="theme-preview theme-preview-light"><i /><i /><i /></span><span><strong>Light</strong><small>Bright and clear</small></span><span className="theme-radio" /></button>
      <button type="button" className={`settings-theme-choice${theme === 'dark' ? ' selected' : ''}`} aria-pressed={theme === 'dark'} onClick={() => chooseTheme('dark')}><span className="theme-preview theme-preview-dark"><i /><i /><i /></span><span><strong>Dark</strong><small>Easy on the eyes</small></span><span className="theme-radio" /></button>
    </div></section>
    <section className="settings-card settings-action-card"><div className="settings-section-heading"><div><span className="section-kicker">PROFILE</span><h2>Edit your profile</h2><p>Update your name, bio, profile link, privacy, and messaging preferences.</p></div><NavLink className="primary-button settings-edit-profile" to="/profile">Edit Profile <span>→</span></NavLink></div></section>
    <section className="settings-card settings-action-card settings-session-card"><div className="settings-section-heading"><div><span className="section-kicker">ACCOUNT ACCESS</span><h2>Sign out</h2><p>End your current Chattr session on this device.</p></div><button type="button" className="settings-signout-button" onClick={signOut} disabled={signingOut}><LogOut size={15} />{signingOut ? 'Signing out…' : 'Sign Out'}</button></div>{signOutError && <p className="inline-error" role="alert">{signOutError}</p>}</section>
    <QuietHoursPanel />
    <ExportDataPanel />
    <BlockedAccountsPanel />
  </div>;
}

function PublicProfilePage({ username }) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [composing, setComposing] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api.get(`/api/users/${username}`).then(({ data }) => { if (alive) setProfile(data.user); })
      .catch((requestError) => { if (alive) setError(getApiError(requestError)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [username]);
  async function toggleFollow() {
    setBusy(true);
    setError('');
    try {
      const method = profile.isFollowing || profile.hasPendingFollowRequest ? 'delete' : 'post';
      const { data } = await api.request({ method, url: `/api/users/${username}/follow` });
      setProfile((current) => ({ ...current, ...data, isFollowing: Boolean(data.following),
        hasPendingFollowRequest: Boolean(data.requestPending), canViewDetails: !current.isPrivate || Boolean(data.following) }));
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  async function sendMessage(event) {
    event.preventDefault();
    if (!message.trim()) return;
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/api/messages/${username}`, { text: message.trim() });
      setMessage('');
      setComposing(false);
      setNotice(data.status === 'pending' ? 'Message request sent.' : 'Message sent.');
      if (data.status === 'accepted') navigate('/messages');
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  async function toggleBlock() {
    const currentlyBlocked = Boolean(profile.isBlockedByMe);
    if (!currentlyBlocked && !window.confirm(`Block @${profile.username}? They will not be able to view your profile or contact you.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (currentlyBlocked) {
        await api.delete(`/api/users/${username}/block`);
        setProfile((current) => ({ ...current, isBlockedByMe: false }));
        const { data } = await api.get(`/api/users/${username}`);
        setProfile(data.user);
        setNotice(`@${username} has been unblocked.`);
      } else {
        await api.post(`/api/users/${username}/block`);
        setProfile((current) => ({ ...current, isBlockedByMe: true, canViewDetails: false, isFollowing: false, hasPendingFollowRequest: false }));
        setComposing(false);
        setNotice(`@${username} was blocked. You can unblock them in Settings.`);
      }
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  if (loading) return <div className="feed-loading">Opening profile…</div>;
  if (error && !profile) return <div className="social-empty"><h3>Profile unavailable.</h3><p>{error}</p></div>;
  if (!profile) return <div className="social-empty"><h3>Profile unavailable.</h3><p>We could not load this profile.</p></div>;
  const isSelf = profile._id === currentUser._id;
  return <div className={`profile-page public-profile${profile.isPrivate ? ' private-profile-view' : ''}`}>
    <ProfileHero profile={profile} isSelf={isSelf} onEdit={() => navigate('/profile')} onFollow={toggleFollow} onMessage={() => setComposing((value) => !value)} onBlock={toggleBlock} busy={busy} />
    {error && <p className="inline-error" role="alert">{error}</p>}
    {notice && <p className="success-message" role="status">{notice}</p>}
    {!isSelf && !profile.isBlockedByMe && composing && <form className="first-message-form" onSubmit={sendMessage}><strong>Say hello to @{username}</strong><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength="4000" placeholder="Write a thoughtful message…" required /><div><button type="button" className="text-button" onClick={() => setComposing(false)}>Cancel</button><button className="primary-button" disabled={busy || !message.trim()}>Send message <span>→</span></button></div></form>}
    {profile.canViewDetails && !profile.isBlockedByMe && <SocialPage mode="profile" username={username} />}
  </div>;
}
function ComingSoon({ title, text, icon: Icon }) {
  return <div className="social-empty"><div className="empty-icon"><Icon size={18} /></div><h3>{title}</h3><p>{text}</p></div>;
}

function MainContent() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/p/')) return <main className="main-content"><Topbar title="Post" /><PageHeading eyebrow="FROM THE COMMUNITY" title="Post" subtitle="A conversation from Chattr." icon={MessageCircle} /><div className="single-column-content"><PostDetail postId={pathname.split('/')[2]} /></div></main>;
  if (pathname.startsWith('/tag/')) { const tag = decodeURIComponent(pathname.split('/')[2] || '').toLowerCase(); return <main className="main-content"><Topbar title={`#${tag}`} /><PageHeading eyebrow="TAGGED POSTS" title={`#${tag}`} subtitle="Every post you can see that mentions this tag." icon={Hash} /><div className="content-grid"><section className="feed-column"><SocialPage mode="tag" tag={tag} /></section><HomeRightRail showSuggestions={false} /></div></main>; }
  if (pathname.startsWith('/u/')) return <main className="main-content"><Topbar title="Profile" /><PageHeading eyebrow="YOUR PEOPLE" title="A Chattr profile" subtitle="Get to know someone from the community." icon={Users} /><div className="content-grid"><section className="feed-column"><PublicProfilePage username={pathname.split('/')[2]} /></section><aside className="right-rail"><div className="rail-card discover-card"><div className="rail-card-header"><div><span className="section-kicker">FIND YOUR PEOPLE</span><h3>Explore</h3></div><Compass size={19} /></div><NavLink className="rail-link" to="/explore">Back to Explore <span>→</span></NavLink></div></aside></div></main>;
  const pages = {
    '/': ['Home', 'Share ideas. Keep up with your community.', Home],
    '/explore': ['Explore', 'Find accounts and public conversations.', Compass],
    '/messages': ['Messages', 'Your conversations will be right here.', MessageCircle],
    '/notifications': ['Notifications', 'Stay close to the moments that matter.', Bell],
    '/saved': ['Saved posts', 'Keep useful conversations close at hand.', Bookmark],
    '/profile': ['Your profile', 'A little context helps good conversations begin.', Users],
    '/settings': ['Settings', 'Make Chattr feel like your space.', Settings],
  };
  const [title, subtitle, Icon] = pages[pathname] || pages['/'];
  if (pathname === '/explore') return <ExplorePageLayout title={title} subtitle={subtitle} Icon={Icon} />;
  if (pathname === '/profile') return <main className="main-content profile-main-content"><Topbar title={title} /><div className="single-column-content profile-page-content"><ProfilePage /></div></main>;
  if (pathname === '/saved') return <main className="main-content"><Topbar title={title} /><div className="content-grid saved-content-grid saved-page-content"><section className="feed-column"><SocialPage mode="saved" /></section><HomeRightRail className="saved-right-rail" /></div></main>;
  if (pathname === '/messages') return <main className="main-content"><Topbar title={title} /><PageHeading eyebrow="GOOD CONVERSATIONS" title={title} subtitle={subtitle} icon={Icon} className="messages-page-heading" /><div className="messages-page-content"><MessagesPage /></div></main>;
  if (pathname === '/notifications') return <main className="main-content"><Topbar title={title} /><PageHeading eyebrow="YOUR UPDATES" title={title} subtitle="A timeline of follows, replies and messages." icon={Icon} className="notifications-page-heading" /><div className="content-grid notifications-content-grid"><section className="feed-column"><NotificationsPage /></section><HomeRightRail className="notifications-right-rail" /></div></main>;
  if (pathname === '/settings') return <main className="main-content settings-main-content"><Topbar title={title} /><div className="content-grid settings-content-grid"><section className="feed-column"><SettingsPage /></section><HomeRightRail className="settings-right-rail" /></div></main>;
  return <HomePageLayout title={pages['/'][0]} subtitle={pages['/'][1]} Icon={pages['/'][2]} />;
}

function ProtectedShell() {
  const { user, loading } = useAuth();
  if (loading) return <div className="auth-loading">Opening your space…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <div className="app-shell"><Sidebar /><Routes><Route path="*" element={<MainContent />} /></Routes><nav className="mobile-nav" aria-label="Mobile navigation">{navItems.map(([to, label, Icon]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `mobile-nav-link ${navColorClass[to]}${isActive ? ' active' : ''}`}><Icon size={19} /><span>{label}</span></NavLink>)}</nav></div>;
}

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('chattr-theme') === 'dark' ? 'dark' : 'light');
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('chattr-theme', theme); }, [theme]);
  useEffect(() => { const toggle = () => setTheme((current) => current === 'light' ? 'dark' : 'light'); window.addEventListener('toggle-theme', toggle); return () => window.removeEventListener('toggle-theme', toggle); }, []);
  return <Routes><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/register" element={<AuthPage mode="register" />} /><Route path="*" element={<ProtectedShell />} /></Routes>;
}
