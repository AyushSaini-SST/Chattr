import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Search } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import Avatar from '../components/Avatar.jsx';
import { PostCard } from './SocialPage.jsx';
import { api, getApiError, mediaCrossOrigin, mediaUrl } from '../services/api.js';
import { publishFollowRelationshipChange } from '../features/users/followSync.js';
import './ExplorePage.css';

const DISCOVERY_PAGE_SIZE = 12;

function ProfileCard({ person, onRelationshipChange, onError, showPreviews = true }) {
  const [busy, setBusy] = useState(false);
  const previews = Array.isArray(person.postPreviews) ? person.postPreviews.slice(0, 3) : [];
  async function toggleFollow() {
    if (busy) return;
    setBusy(true);
    onError('');
    try {
      const method = person.isFollowing || person.hasPendingFollowRequest ? 'delete' : 'post';
      const { data } = await api.request({ method, url: `/api/users/${person.username}/follow` });
      const next = { ...person, isFollowing: Boolean(data.following), hasPendingFollowRequest: Boolean(data.requestPending) };
      onRelationshipChange(next);
      publishFollowRelationshipChange({ username: person.username, following: next.isFollowing, requestPending: next.hasPendingFollowRequest });
    } catch (error) { onError(getApiError(error)); }
    finally { setBusy(false); }
  }
  return <article className="discover-profile-card">
    <header className="discover-profile-header">
      <NavLink className="discover-profile-identity" to={`/u/${person.username}`} aria-label={`Open ${person.displayName}'s profile`}>
        <Avatar className="discover-avatar" src={person.avatarUrl} name={person.displayName} userId={person._id} size={46} />
        <span className="discover-profile-copy"><strong>{person.displayName}</strong><span>@{person.username}{person.isPrivate ? ' · Private' : ''}</span>{person.headline && <small>{person.headline}</small>}</span>
      </NavLink>
      <button type="button" className={`discover-follow-button${person.isFollowing ? ' is-following' : ''}${person.hasPendingFollowRequest ? ' is-requested' : ''}`} onClick={toggleFollow} disabled={busy} aria-label={`${person.hasPendingFollowRequest ? 'Cancel follow request to' : person.isFollowing ? 'Unfollow' : 'Follow'} ${person.displayName}`}>
        {busy ? 'Saving…' : person.isFollowing ? 'Following' : person.hasPendingFollowRequest ? 'Requested' : 'Follow'}
      </button>
    </header>
    {showPreviews && <div className="discover-post-previews" aria-label={`Recent posts by ${person.displayName}`}>
      {previews.length ? previews.map((post) => <NavLink className={`discover-post-preview${post.image?.url ? ' has-image' : ''}`} key={post._id} style={{ aspectRatio: post.image?.width && post.image?.height ? `${post.image.width} / ${post.image.height}` : '1 / 1' }} to={`/p/${post._id}`} aria-label={`Open post by ${person.displayName}`}>
        {post.image?.url ? <img src={mediaUrl(post.image.url)} crossOrigin={mediaCrossOrigin(post.image.url)} loading="lazy" alt="" /> : <span>{post.text || 'Open post'}</span>}
      </NavLink>) : <div className="discover-preview-empty">{person.isPrivate && !person.isFollowing ? 'Posts are shared with followers.' : 'No posts to preview yet.'}</div>}
    </div>}
    {showPreviews && !person.isFollowing && !person.hasPendingFollowRequest && <p className="discover-follow-prompt">Follow to explore more</p>}
    {showPreviews && person.hasPendingFollowRequest && <p className="discover-follow-prompt is-pending">Your follow request is waiting for approval.</p>}
  </article>;
}

export default function ExplorePage() {
  const [query, setQuery] = useState('');
  const [discoveryUsers, setDiscoveryUsers] = useState([]);
  const [searchUsers, setSearchUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchError, setSearchError] = useState('');
  const [actionError, setActionError] = useState('');
  const searchRequest = useRef(0);
  const initialDiscoveryRequest = useRef(null);

  const loadDiscovery = useCallback(async ({ append = false } = {}) => {
    const nextCursor = append ? cursor : null;
    if (append && !nextCursor) return;
    if (!append && initialDiscoveryRequest.current) return initialDiscoveryRequest.current;
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    let request;
    try {
      const params = new URLSearchParams({ limit: String(DISCOVERY_PAGE_SIZE) });
      if (nextCursor) params.set('cursor', nextCursor);
      request = api.get(`/api/users/discover?${params}`);
      if (!append) initialDiscoveryRequest.current = request;
      const { data } = await request;
      setDiscoveryUsers((current) => append ? [...current, ...data.users] : data.users);
      setCursor(data.nextCursor || null);
    } catch (requestError) { setError(getApiError(requestError)); }
    finally {
      if (initialDiscoveryRequest.current === request) initialDiscoveryRequest.current = null;
      setLoading(false); setLoadingMore(false);
    }
  }, [cursor]);

  useEffect(() => { loadDiscovery(); }, []); // initial page only; load-more owns subsequent cursors

  useEffect(() => {
    const term = query.trim();
    const version = ++searchRequest.current;
    if (term.length < 2) {
      setSearchUsers([]); setPosts([]); setSearchError(''); setSearchLoading(false);
      return undefined;
    }
    setSearchUsers([]); setPosts([]); setSearchError(''); setSearchLoading(true);
    const timer = setTimeout(async () => {
      setSearchError('');
      try {
        const { data } = await api.get(`/api/search?q=${encodeURIComponent(term)}`);
        if (version === searchRequest.current) { setSearchUsers(data.users || []); setPosts(data.posts || []); }
      } catch (requestError) { if (version === searchRequest.current) setSearchError(getApiError(requestError)); }
      finally { if (version === searchRequest.current) setSearchLoading(false); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const refreshVisibleDiscovery = () => {
      if (document.visibilityState === 'visible' && !query.trim()) loadDiscovery();
    };
    window.addEventListener('focus', refreshVisibleDiscovery);
    document.addEventListener('visibilitychange', refreshVisibleDiscovery);
    return () => {
      window.removeEventListener('focus', refreshVisibleDiscovery);
      document.removeEventListener('visibilitychange', refreshVisibleDiscovery);
    };
  }, [loadDiscovery, query]);

  function updateRelationship(updated) {
    setDiscoveryUsers((current) => current.map((person) => person._id === updated._id ? updated : person));
    setSearchUsers((current) => current.map((person) => person._id === updated._id ? updated : person));
  }

  function updatePost(postId, patch) { setPosts((current) => current.map((post) => post._id === postId ? { ...post, ...patch } : post)); }
  async function refreshSearchPosts() {
    const term = query.trim();
    if (term.length < 2) return;
    const version = searchRequest.current;
    try { const { data } = await api.get(`/api/search?q=${encodeURIComponent(term)}`); if (version === searchRequest.current) setPosts(data.posts || []); }
    catch (requestError) { if (version === searchRequest.current) setSearchError(getApiError(requestError)); }
  }

  const searching = query.trim().length >= 2;
  const partialSearch = query.trim().length === 1;
  const visibleUsers = searching ? searchUsers : discoveryUsers;
  return <div className="explore-discovery-page">
    <section className="explore-search-section" aria-label="Search people and posts">
      <label className="explore-search-control" htmlFor="explore-search-input"><Search size={19} aria-hidden="true" /><input id="explore-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search people and posts" autoComplete="off" /><span className="explore-search-hint">Search</span></label>
      <p className="explore-search-caption">Discover people and public conversations.</p>
    </section>

    {partialSearch && <p className="explore-state" role="status">Enter at least 2 characters to search. Browse people below.</p>}
    {searching ? <>
      <section className="explore-results-section" aria-live="polite" aria-busy={searchLoading}>
        <div className="explore-section-heading"><div><span className="explore-section-kicker">PEOPLE</span><h2>Search results</h2></div></div>
        {searchError && <p className="explore-state is-error" role="alert">{searchError}</p>}
        {searchLoading && <p className="explore-state" role="status">Searching…</p>}
        {!searchLoading && !searchError && !visibleUsers.length && <p className="explore-state">No matching people found.</p>}
        {visibleUsers.length > 0 && <div className="explore-profile-grid">{visibleUsers.map((person) => <ProfileCard key={person._id} person={person} showPreviews={false} onRelationshipChange={updateRelationship} onError={setActionError} />)}</div>}
      </section>
      <section className="explore-results-section explore-public-posts" aria-live="polite">
        <div className="explore-section-heading"><div><span className="explore-section-kicker">MATCHING CONTENT</span><h2>Posts you can view</h2></div></div>
        {searchLoading ? null : posts.length ? <div className="explore-search-posts">{posts.map((post) => <PostCard key={post._id} post={post} onChange={refreshSearchPosts} onLikeChange={(postId, state) => updatePost(postId, state)} showOpenLink />)}</div> : <p className="explore-state">No matching posts found.</p>}
      </section>
    </> : <section className="explore-results-section" aria-label="Discover people" aria-busy={loading}>
      <div className="explore-section-heading"><div><span className="explore-section-kicker">MEET THE COMMUNITY</span><h2>People to explore</h2></div></div>
      {actionError && <p className="explore-state is-error" role="alert">{actionError}</p>}
      {error && <div className="explore-error-row"><p className="explore-state is-error" role="alert">{error}</p><button type="button" className="explore-retry" onClick={() => loadDiscovery()}>Try again</button></div>}
      {loading ? <p className="explore-state" role="status">Finding people…</p> : !discoveryUsers.length && !error ? <p className="explore-state">No accounts to discover yet. Check back as the community grows.</p> : <div className="explore-profile-grid">{discoveryUsers.map((person) => <ProfileCard key={person._id} person={person} onRelationshipChange={updateRelationship} onError={setActionError} />)}</div>}
      {!loading && cursor && <button type="button" className="explore-load-more" onClick={() => loadDiscovery({ append: true })} disabled={loadingMore}>{loadingMore ? 'Loading more…' : 'Load more people'} <ArrowRight size={16} /></button>}
    </section>}
  </div>;
}
