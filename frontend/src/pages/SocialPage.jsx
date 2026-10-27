import { useEffect, useRef, useState } from 'react';
import { Bookmark, Flag, Heart, ImagePlus, MessageCircle, Pencil, Pin, PinOff, Send, Trash2, X } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { api, getApiError, mediaCrossOrigin, mediaUrl } from '../services/api.js';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../features/auth/AuthContext.jsx';
import { useParams } from 'react-router-dom';
import { imageSelectionError, POST_IMAGE_MAX_BYTES } from '../utils/imageValidation.js';
import { applyPostLikeState, submitPostLikeChange } from '../features/posts/postLike.js';
import { postAuthorProfilePath, shouldLinkPostAuthor } from '../features/posts/postAuthorNavigation.js';
import { getPostFollowAction } from '../features/posts/postFollowAction.js';
import { publishFollowRelationshipChange, subscribeToFollowRelationshipChanges } from '../features/users/followSync.js';
import { splitHashtags } from '../features/posts/hashtags.js';
import { clearDraft, loadDraft, saveDraft } from '../features/posts/composerDraft.js';
import { EMPTY_REACTIONS, REACTIONS, applyReaction, reactionRequest } from '../features/posts/reactions.js';

export function PostText({ text, className = 'post-text' }) {
  return <p className={className}>{splitHashtags(text).map((segment, index) => segment.type === 'tag'
    ? <NavLink key={index} className="hashtag-link" to={`/tag/${encodeURIComponent(segment.tag)}`}>#{segment.value}</NavLink>
    : <span key={index}>{segment.value}</span>)}</p>;
}

export function ReactionBar({ summary = EMPTY_REACTIONS, onReact, disabled = false, compact = false, canAdd = true }) {
  const [open, setOpen] = useState(false);
  const value = summary || EMPTY_REACTIONS;
  const visible = compact && !open ? REACTIONS.filter((reaction) => (value.counts?.[reaction.kind] || 0) > 0 || value.myReaction === reaction.kind) : REACTIONS;
  return <div className={`reaction-bar${compact ? ' compact' : ''}`} role="group" aria-label="Reactions">
    {visible.map((reaction) => {
      const count = value.counts?.[reaction.kind] || 0;
      const selected = value.myReaction === reaction.kind;
      return <button type="button" key={reaction.kind} className={`reaction-chip reaction-${reaction.kind}${selected ? ' selected' : ''}`} aria-pressed={selected} aria-label={`${reaction.label}${count ? ` (${count})` : ''}`} title={reaction.label} onClick={() => { onReact(reaction.kind); setOpen(false); }} disabled={disabled}><span aria-hidden="true">{reaction.glyph}</span>{count > 0 && <span className="reaction-count">{count}</span>}</button>;
    })}
    {compact && canAdd && <button type="button" className="reaction-chip reaction-more" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label={open ? 'Hide reactions' : 'Add a reaction'} disabled={disabled}><span aria-hidden="true">{open ? '×' : '+'}</span></button>}
  </div>;
}

export function PostCard({ post, onChange, onLikeChange, onReactionChange, showOpenLink = false, linkAuthor = false, showFollow = false, allowPin = false }) {
  const { user, updateCurrentUser } = useAuth();
  const [reactions, setReactions] = useState(post.reactions || EMPTY_REACTIONS);
  const [pinBusy, setPinBusy] = useState(false);
  useEffect(() => { setReactions(post.reactions || EMPTY_REACTIONS); }, [post.reactions]);
  const [comment, setComment] = useState('');
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [editText, setEditText] = useState(post.text);
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState('inappropriate');
  const [reportNotice, setReportNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [error, setError] = useState('');
  const likeRequestRef = useRef(false);
  const followRequestRef = useRef(false);
  async function toggleLike() {
    if (likeRequestRef.current) return;
    likeRequestRef.current = true;
    setBusy(true); setError('');
    try {
      await submitPostLikeChange({
        post,
        request: (config) => api.request(config),
        onSuccess: (postId, likeState) => onLikeChange?.(postId, likeState),
      });
    }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { likeRequestRef.current = false; setBusy(false); }
  }
  async function toggleAuthorFollow(event) {
    event.preventDefault();
    event.stopPropagation();
    if (followRequestRef.current) return;
    const username = post.author?.username;
    const cancelRequest = Boolean(post.author?.hasPendingFollowRequest);
    if (!username || String(post.author?._id) === String(user._id) || post.author?.isFollowing) return;
    followRequestRef.current = true;
    setFollowBusy(true);
    setError('');
    try {
      const { data } = await api.request({
        method: cancelRequest ? 'delete' : 'post',
        url: `/api/users/${encodeURIComponent(username)}/follow`,
      });
      publishFollowRelationshipChange({ username, following: Boolean(data.following), requestPending: Boolean(data.requestPending) });
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { followRequestRef.current = false; setFollowBusy(false); }
  }
  async function react(kind) {
    const previous = reactions;
    const optimistic = applyReaction(previous, previous.myReaction === kind ? null : kind);
    setReactions(optimistic); setError('');
    try {
      const { data } = await api.request(reactionRequest(`/api/posts/${post._id}`, previous, kind));
      setReactions(data.reactions);
      onReactionChange?.(post._id, data.reactions);
    } catch (requestError) { setReactions(previous); setError(getApiError(requestError)); }
  }
  const isPinned = Boolean(post.isPinned) || (user.pinnedPost && String(user.pinnedPost) === String(post._id));
  async function togglePin() {
    setPinBusy(true); setError('');
    try {
      const { data } = await api.patch('/api/users/me', { pinnedPostId: isPinned ? null : post._id });
      updateCurrentUser(data.user);
      onChange();
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setPinBusy(false); }
  }
  async function toggleSave() {
    setBusy(true); setError('');
    try { await api.request({ method: post.isSaved ? 'delete' : 'post', url: `/api/posts/${post._id}/save` }); onChange(); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  async function addComment(event) {
    event.preventDefault(); if (!comment.trim()) return;
    setBusy(true); setError('');
    try { await api.post(`/api/posts/${post._id}/comments`, { text: comment.trim() }); setComment(''); onChange(); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  async function saveEdit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await api.patch(`/api/posts/${post._id}`, { text: editText.trim() }); setEditing(false); onChange(); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  async function deletePost() {
    if (!window.confirm('Delete this post? This also removes its comments and saved copies.')) return;
    try { await api.delete(`/api/posts/${post._id}`); onChange(); }
    catch (requestError) { setError(getApiError(requestError)); }
  }
  async function reportPost(event) {
    event.preventDefault(); setError('');
    try { await api.post(`/api/reports/post/${post._id}`, { reason: reportReason }); setReporting(false); setReportNotice('Report submitted for review.'); }
    catch (requestError) { setError(getApiError(requestError)); }
  }
  const mine = post.author?._id === user._id;
  const followAction = getPostFollowAction(post.author, user._id);
  const authorProfilePath = postAuthorProfilePath(post.author);
  const authorIdentity = linkAuthor && authorProfilePath ? <NavLink className="post-author-link" to={authorProfilePath} aria-label={`Open ${post.author.displayName || post.author.username}'s profile`}><Avatar className="post-avatar" src={post.author?.avatarUrl} name={post.author?.displayName || 'Chattr member'} userId={post.author?._id} size={40} /><div className="post-author"><strong>{post.author?.displayName || 'Chattr member'}</strong><span>@{post.author?.username || 'member'} · {new Date(post.createdAt).toLocaleDateString()}</span></div></NavLink> : <><Avatar className="post-avatar" src={post.author?.avatarUrl} name={post.author?.displayName || 'Chattr member'} userId={post.author?._id} size={40} /><div className="post-author"><strong>{post.author?.displayName || 'Chattr member'}</strong><span>@{post.author?.username || 'member'} · {new Date(post.createdAt).toLocaleDateString()}</span></div></>; return <article className={`post-card${isPinned ? ' pinned' : ''}`}>{isPinned && <div className="post-pinned-badge"><Pin size={12} /> Pinned</div>}<header className="post-header"><div className={showFollow ? "post-author-follow-group has-post-follow-control" : "post-author-follow-group"}>{authorIdentity}{showFollow && followAction ? <button type="button" className={"outline-button post-follow-button" + (followAction.action === "cancel" ? " requested" : "")} onClick={toggleAuthorFollow} disabled={followBusy} aria-label={followAction.action === "cancel" ? "Cancel follow request to " + (post.author.displayName || post.author.username) : "Follow " + (post.author.displayName || post.author.username)} aria-busy={followBusy}>{followBusy ? "Saving…" : followAction.label}</button> : null}</div>{mine ? <div className="post-tools">{allowPin && <button type="button" className={`post-pin-action${isPinned ? ' selected' : ''}`} onClick={togglePin} disabled={pinBusy} aria-pressed={isPinned} aria-label={isPinned ? 'Unpin from profile' : 'Pin to profile'}>{isPinned ? <PinOff size={13} /> : <Pin size={13} />}</button>}<button onClick={() => { setEditText(post.text); setEditing((value) => !value); }} aria-label="Edit post"><Pencil size={13} /></button><button className="post-delete-action" onClick={deletePost} aria-label="Delete post"><Trash2 size={14} /></button></div> : <button className="post-report" onClick={() => setReporting((value) => !value)} aria-label="Report post"><Flag size={13} /></button>}</header>{editing ? <form className="edit-post-form" onSubmit={saveEdit}><textarea value={editText} onChange={(event) => setEditText(event.target.value)} maxLength="2000" required /><div><button type="button" className="text-button" onClick={() => setEditing(false)}>Cancel</button><button className="outline-button" disabled={busy || !editText.trim()}>Save edit</button></div></form> : post.text && <PostText text={post.text} />}{post.image?.url && <figure className="post-image-frame"><img src={mediaUrl(post.image.url)} crossOrigin={mediaCrossOrigin(post.image.url)} alt={post.image.alt || `Image shared by ${post.author?.displayName || 'a Chattr member'}`} loading="lazy" />{post.image.alt && <figcaption className="sr-only">{post.image.alt}</figcaption>}</figure>}{reporting && <form className="report-form" onSubmit={reportPost}><label>Report reason<select value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="inappropriate">Inappropriate content</option><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="other">Other</option></select></label><button className="outline-button">Submit report</button></form>}{reportNotice && <p className="success-message">{reportNotice}</p>}<div className="post-actions"><button type="button" className={`post-action post-action-like${post.likedByMe ? ' selected' : ''}`} aria-pressed={Boolean(post.likedByMe)} onClick={toggleLike} disabled={busy} aria-label={post.likedByMe ? 'Unlike post' : 'Like post'}><Heart size={16} fill={post.likedByMe ? 'currentColor' : 'none'} />{post.likeCount || 0}</button><button className={`post-action post-action-comment${commentsOpen ? ' selected' : ''}`} aria-pressed={commentsOpen} onClick={() => setCommentsOpen((open) => !open)} aria-expanded={commentsOpen} aria-label={`${commentsOpen ? 'Hide' : 'Show'} ${post.comments?.length || 0} comments`}><MessageCircle size={16} />{post.comments?.length || 0}</button>{showOpenLink && <NavLink className="post-open-link" to={`/p/${post._id}`}>Open post</NavLink>}<button className={`post-action post-action-save save-action${post.isSaved ? ' selected' : ''}`} aria-pressed={Boolean(post.isSaved)} onClick={toggleSave} disabled={busy} aria-label={post.isSaved ? 'Remove saved post' : 'Save post'}><Bookmark size={16} fill={post.isSaved ? 'currentColor' : 'none'} /></button></div><ReactionBar summary={reactions} onReact={react} disabled={busy} />{commentsOpen && <><div className="comment-list">{post.comments?.slice(-3).map((item) => <div className="comment" key={item._id}><Avatar className="comment-avatar" src={item.author?.avatarUrl} name={item.author?.displayName || 'Member'} userId={item.author?._id} size={30} /><div className="comment-copy"><strong>{item.author?.displayName || 'Member'}</strong><span>{item.text}</span></div></div>)}{!post.comments?.length && <p className="comments-empty">No comments yet. Start the conversation.</p>}</div><form className="comment-form" onSubmit={addComment}><input value={comment} onChange={(event) => setComment(event.target.value)} maxLength="1000" placeholder="Add a thoughtful comment…" aria-label="Add a comment" /><button disabled={busy || !comment.trim()} aria-label="Send comment"><Send size={15} /></button></form></>}{error && <p className="inline-error" role="alert">{error}</p>}</article>;
}

export function PostDetail({ postId }) {
  const [post, setPost] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError('');
    try { const { data } = await api.get(`/api/posts/${postId}`); setPost(data.post); }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [postId]);
  if (loading) return <div className="feed-loading">Opening post…</div>;
  if (error || !post) return <div className="social-empty"><h3>Post unavailable.</h3><p>{error || 'This post could not be found.'}</p></div>;
  return <section className="post-detail"><PostCard post={post} onChange={load} onLikeChange={(_, likeState) => setPost((current) => current ? { ...current, ...likeState } : current)} /></section>;
}

export default function SocialPage({ mode = 'following', username: givenUsername, tag: givenTag }) {
  const { user } = useAuth();
  const routeParams = useParams();
  const username = givenUsername || routeParams.username;
  const tag = (givenTag || routeParams.tag || '').toLowerCase();
  const [posts, setPosts] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const initialDraft = useRef(mode === 'following' ? loadDraft(user?._id) : null);
  const [text, setText] = useState(initialDraft.current?.text || '');
  const [visibility, setVisibility] = useState(initialDraft.current?.visibility || 'public');
  const [draftNotice, setDraftNotice] = useState(initialDraft.current ? 'Draft restored from your last visit.' : '');
  const [imageAlt, setImageAlt] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const imageInputRef = useRef(null);
  async function load({ append = false } = {}) {
    if (append && (!nextCursor || loadingMore)) return;
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const endpoint = mode === 'saved' ? '/api/saved' : mode === 'profile' ? `/api/users/${username}/posts` : mode === 'tag' ? `/api/posts/tag/${encodeURIComponent(tag)}` : `/api/posts?feed=${mode}`;
      const separator = endpoint.includes('?') ? '&' : '?';
      const url = (mode === 'following' || mode === 'tag') && append ? `${endpoint}${separator}cursor=${encodeURIComponent(nextCursor)}` : endpoint;
      const { data } = await api.get(url);
      if (mode === 'following' || mode === 'tag') setNextCursor(data.nextCursor || null);
      setPosts((current) => {
        if (!append) return data.posts;
        const seen = new Set(current.map((post) => post._id));
        return [...current, ...data.posts.filter((post) => !seen.has(post._id))];
      });
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); setLoadingMore(false); }
  }
  function updatePostLike(postId, likeState) {
    setPosts((current) => applyPostLikeState(current, postId, likeState));
  }
  function updatePostReactions(postId, summary) {
    setPosts((current) => current.map((post) => post._id === postId ? { ...post, reactions: summary } : post));
  }
  useEffect(() => { load(); }, [mode, username, tag]);
  useEffect(() => {
    if (mode !== 'following' || !user?._id) return undefined;
    const timer = setTimeout(() => saveDraft(user._id, { text, visibility }), 400);
    return () => clearTimeout(timer);
  }, [text, visibility, mode, user?._id]);
  useEffect(() => {
    if (mode !== 'following') return undefined;
    return subscribeToFollowRelationshipChanges(({ detail = {} }) => {
    if (!detail.username) return;
    setPosts((current) => current.map((post) => post.author?.username === detail.username
      ? { ...post, author: { ...post.author, isFollowing: Boolean(detail.following), hasPendingFollowRequest: Boolean(detail.requestPending) } }
      : post));
    });
  }, [mode]);
  useEffect(() => {
    if (!imageFile) { setImagePreview(''); return undefined; }
    const previewUrl = URL.createObjectURL(imageFile);
    setImagePreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [imageFile]);
  async function createPost(event) {
    event.preventDefault(); if (!text.trim() && !imageFile) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      if (imageFile) {
        const form = new FormData();
        form.append('text', text.trim());
        form.append('visibility', visibility);
        form.append('image', imageFile);
        if (imageAlt.trim()) form.append('imageAlt', imageAlt.trim());
        const { data } = await api.post('/api/posts', form);
        setPosts((current) => [data.post, ...current.filter((post) => post._id !== data.post._id)]);
      } else {
        const { data } = await api.post('/api/posts', { text: text.trim(), visibility });
        setPosts((current) => [data.post, ...current.filter((post) => post._id !== data.post._id)]);
      }
      setText(''); setImageFile(null); setImageAlt(''); setDraftNotice(''); clearDraft(user._id); setSuccess('Your post is live.');
    }
    catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }
  function selectPostImage(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const validationError = imageSelectionError(file, POST_IMAGE_MAX_BYTES);
    if (validationError) { setImageFile(null); setError(validationError); return; }
    setError(''); setImageFile(file);
  }
  const title = mode === 'saved' ? 'Saved posts' : mode === 'explore' ? 'Public posts' : mode === 'profile' ? 'Posts' : mode === 'tag' ? `#${tag}` : 'Your feed';
  const kicker = mode === 'saved' ? 'BOOKMARKED BY YOU' : mode === 'profile' ? 'ON THIS PROFILE' : mode === 'explore' ? 'PUBLIC POSTS' : mode === 'tag' ? 'TAGGED POSTS' : 'FROM THE COMMUNITY';
  const isHome = mode === 'following';
  const homeComposer = isHome ? <form className="composer home-composer" onSubmit={createPost} aria-busy={busy}>
    <div className="composer-author"><Avatar className="composer-avatar" src={user.avatarUrl} name={user.displayName} userId={user._id} size={38} /><div className="composer-author-copy"><strong>{user.displayName}</strong><span>Share something with your community</span></div></div>
    <div className="composer-editor"><textarea id="home-post-text" value={text} onChange={(event) => setText(event.target.value)} maxLength="2000" placeholder="What's on your mind? Share it with your community..." aria-label="Write a post" aria-describedby="home-post-count" disabled={busy} /><span id="home-post-count" aria-live="polite">{text.length}/2000</span></div>
    {imagePreview && <div className="composer-image-preview"><img src={imagePreview} alt="Selected image preview" /><button type="button" onClick={() => { setImageFile(null); setImageAlt(''); }} disabled={busy} aria-label="Remove selected image"><X size={16} /></button></div>}
    {imageFile && <label className="composer-alt-label" htmlFor="home-post-alt">Describe the image<input id="home-post-alt" value={imageAlt} onChange={(event) => setImageAlt(event.target.value)} maxLength="200" placeholder="Alt text for people using screen readers" disabled={busy} /></label>}
    {draftNotice && <p className="composer-draft-notice" role="status">{draftNotice} <button type="button" className="text-button" onClick={() => { setText(''); setVisibility('public'); setDraftNotice(''); clearDraft(user._id); }}>Discard draft</button></p>}
    <div className="composer-bottom"><div className="composer-bottom-controls"><label className="visibility-label" htmlFor="home-post-visibility">Visible to <select id="home-post-visibility" value={visibility} onChange={(event) => setVisibility(event.target.value)} disabled={busy}><option value="public">Everyone</option><option value="followers">Followers</option></select></label><input ref={imageInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={selectPostImage} disabled={busy} /><button type="button" className="composer-image-button" onClick={() => imageInputRef.current?.click()} disabled={busy} aria-label="Add an image to your post"><ImagePlus size={17} /><span>Add image</span></button></div><button className="primary-button" disabled={busy || (!text.trim() && !imageFile)}>{busy ? 'Publishing...' : 'Share post'} <span>→</span></button></div>
  </form> : null;
  const feedback = <>{success && <p className="success-message" role="status">{success}</p>}{error && <p className="inline-error" role="alert">{error}</p>}</>;

  return <section className={`social-page${isHome ? ' home-feed' : mode === 'saved' ? ' saved-feed' : mode === 'explore' ? ' explore-post-feed' : ''}`} aria-label={isHome ? 'Home feed' : title}>
    {isHome && <section className="home-composer-section" aria-label="Create a post"><h2 className="sr-only">Create a post</h2>{homeComposer}{feedback}</section>}
    {!isHome && feedback}
    <section className="social-feed-section" aria-labelledby={`social-feed-title-${mode}`}>
      <div className={`social-page-heading${isHome ? ' feed-toolbar' : ''}`} aria-label={isHome ? 'Feed controls' : undefined}><div>{mode !== 'following' && mode !== 'explore' && <span className="section-kicker">{kicker}</span>}<h2 id={`social-feed-title-${mode}`}>{title}</h2></div><button className="refresh-button" onClick={() => load()} disabled={loading || loadingMore}>Refresh</button></div>
      <div className="feed-posts" aria-busy={loading || loadingMore} aria-label={`${title} posts`}>
        {loading ? <div className="feed-loading" role="status">Loading posts...</div> : posts.length ? <div className="post-list">{posts.map((post) => <PostCard key={post._id} post={post} onChange={load} onLikeChange={updatePostLike} onReactionChange={updatePostReactions} showOpenLink={mode === 'profile'} linkAuthor={shouldLinkPostAuthor(mode)} showFollow={mode === 'following'} allowPin={mode === 'profile' && post.author?._id === user._id} />)}</div> : <div className="social-empty"><div className="empty-icon"><MessageCircle size={19} /></div><h3>{mode === 'following' ? 'Your feed starts with a hello.' : mode === 'saved' ? 'Nothing saved yet.' : 'A fresh start.'}</h3><p>{mode === 'following' ? 'Follow people to see their posts here, or share your own thought.' : mode === 'saved' ? 'Save a post with its bookmark control to keep it here for later.' : mode === 'explore' ? 'Public posts will appear here when the community shares them.' : mode === 'tag' ? `Nobody has used #${tag} yet. Be the first.` : 'No posts are available here yet.'}</p>{mode === 'following' && <NavLink className="primary-button" to="/explore">Find people to follow <span>→</span></NavLink>}{mode === 'saved' && <NavLink className="saved-empty-link" to="/explore">Explore public posts <span>→</span></NavLink>}</div>}
      </div>
      {(isHome || mode === 'tag') && !loading && nextCursor && <button type="button" className="text-button feed-load-more" onClick={() => load({ append: true })} disabled={loadingMore}>{loadingMore ? 'Loading more posts…' : 'Load more posts'} <span aria-hidden="true">→</span></button>}
    </section>
  </section>;
}
