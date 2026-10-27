import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { io } from 'socket.io-client';
import { ArrowLeft, Bell, BellOff, Check, MessageCircle, MoreVertical, Send, X } from 'lucide-react';
import { ReactionBar } from './SocialPage.jsx';
import { applyReaction, reactionRequest } from '../features/posts/reactions.js';
import { api, getApiError } from '../services/api.js';
import Avatar from '../components/Avatar.jsx';
import { useAuth } from '../features/auth/AuthContext.jsx';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';
function formatConversationTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function MessagesPage({ initialConversationId = null, quickChat = false, onQuickChatClose = () => {}, onConversationsChange = () => {} }) {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [requests, setRequests] = useState([]);
  const [active, setActive] = useState(null);
  const [messages, setMessages] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [draft, setDraft] = useState('');
  const [typing, setTyping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const [messageMenu, setMessageMenu] = useState(null);
  const socketRef = useRef(null);
  const bottomRef = useRef(null);
  const typingTimer = useRef(null);
  const messageMenuRef = useRef(null);
  const messageMenuButtonRef = useRef(null);

  const loadInbox = useCallback(async () => {
    try {
      const [conversationResult, requestResult] = await Promise.all([api.get('/api/messages'), api.get('/api/messages/requests')]);
      const nextConversations = conversationResult.data.conversations;
      setConversations(nextConversations);
      setActive((current) => current ? nextConversations.find((item) => item._id === current._id) || current : current);
      onConversationsChange(nextConversations);
      setRequests(requestResult.data.requests);
      setError('');
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    loadInbox();
    const socket = io(API_URL, { withCredentials: true, autoConnect: true });
    socketRef.current = socket;
    socket.on('message:new', (message) => setMessages((current) => current.some((item) => item._id === message._id) ? current : [...current, message]));
    socket.on('read:update', ({ conversationId, userId: readerId }) => { if (active?._id === conversationId) setMessages((current) => current.map((item) => item.sender?._id === readerId ? item : ({ ...item, readBy: item.readBy.includes(readerId) ? item.readBy : [...item.readBy, readerId] }))); });
    socket.on('message:changed', ({ messageId, conversationId, action }) => {
      if (conversationId && active?._id !== conversationId) return;
      if (action === 'reacted') {
        api.get(`/api/messages/${conversationId}/messages`).then(({ data }) => {
          const fresh = data.messages.find((item) => item._id === messageId);
          if (fresh) setMessages((current) => current.map((item) => item._id === messageId ? { ...item, reactions: fresh.reactions } : item));
        }).catch(() => {});
        return;
      }
      setMessages((current) => current.map((item) => item._id !== messageId ? item : ({
        ...item,
        text: action === 'deleted-for-everyone' ? 'This message was deleted.' : action === 'deleted-for-me' ? 'You deleted this message.' : item.text,
        deletedForEveryone: action === 'deleted-for-everyone' || item.deletedForEveryone,
        deletedForMe: action === 'deleted-for-me' || item.deletedForMe,
      })));
    });
    socket.on('typing:update', ({ conversationId, userId, typing: activeTyping }) => { if (active?._id === conversationId && userId !== user._id) setTyping(activeTyping); });
    socket.on('conversation:update', () => loadInbox());
    socket.on('conversation:unavailable', ({ conversationId }) => {
      if (active?._id !== conversationId) { loadInbox(); return; }
      setActive(null); setMessages([]); setMobileChat(false); setError('This conversation is no longer available.');
      loadInbox();
    });
    socket.on('message-request:new', () => loadInbox());
    socket.on('message-request:updated', () => loadInbox());
    socket.on('presence:update', ({ userId, online }) => setConversations((current) => current.map((item) => item.participant._id === userId ? { ...item, participant: { ...item.participant, online } } : item)));
    return () => { socket.disconnect(); clearTimeout(typingTimer.current); };
  }, [loadInbox, user._id, active?._id]);

  useEffect(() => {
    if (!initialConversationId) return;
    const conversation = conversations.find((item) => item._id === initialConversationId);
    if (conversation && active?._id !== conversation._id) {
      setActive(conversation);
      setMobileChat(true);
    }
  }, [initialConversationId, conversations, active?._id]);

  useEffect(() => { setMessageMenu(null); }, [active?._id]);

  useEffect(() => {
    if (!messageMenu) return undefined;
    const closeMenu = () => setMessageMenu(null);
    const handlePointerDown = (event) => {
      if (!messageMenuRef.current?.contains(event.target) && !messageMenuButtonRef.current?.contains(event.target)) closeMenu();
    };
    const handleKeyDown = (event) => { if (event.key === 'Escape') closeMenu(); };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('scroll', closeMenu, true);
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('resize', closeMenu);
    };
  }, [messageMenu]);

  useEffect(() => {
    if (messageMenu) messageMenuRef.current?.querySelector('[role="menuitem"]')?.focus();
  }, [messageMenu]);

  useEffect(() => {
    if (!active) { setMessages([]); return; }
    let alive = true;
    async function openConversation() {
      setError(''); setMessages([]); setLoading(true);
      try {
        const { data } = await api.get(`/api/messages/${active._id}/messages`);
        if (!alive) return;
        setMessages(data.messages);
        setNextCursor(data.nextCursor);
        if (active.status === 'accepted') {
          await api.post(`/api/messages/${active._id}/read`);
          socketRef.current?.emit('conversation:join', { conversationId: active._id }, (result) => { if (result?.error) setError(result.error); });
        }
        loadInbox();
      } catch (requestError) { if (alive) setError(getApiError(requestError)); }
      finally { if (alive) setLoading(false); }
    }
    openConversation();
    return () => { alive = false; socketRef.current?.emit('typing:stop', { conversationId: active._id }); };
  }, [active?._id, active?.status, loadInbox]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);

  async function openChat(conversation) {
    setActive(conversation);
    setMobileChat(true);
    setConversations((current) => current.map((item) => item._id === conversation._id ? { ...item, unreadCount: 0 } : item));
  }

  async function loadOlder() {
    if (!active || !nextCursor) return;
    setBusy(true);
    try {
      const { data } = await api.get(`/api/messages/${active._id}/messages?before=${nextCursor}`);
      setMessages((current) => [...data.messages, ...current]);
      setNextCursor(data.nextCursor);
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }

  async function respondToRequest(conversationId, decision) {
    setBusy(true); setError('');
    try {
      await api.patch(`/api/messages/requests/${conversationId}`, { decision });
      await loadInbox();
      if (decision === 'accept') {
        const item = requests.find((request) => request.conversation._id === conversationId);
        if (item) await openChat({ _id: conversationId, participant: item.sender, lastMessage: item.preview?.text || '', status: 'accepted' });
      }
    } catch (requestError) { setError(getApiError(requestError)); }
    finally { setBusy(false); }
  }

  async function sendMessage(event) {
    event.preventDefault(); if (!draft.trim() || !active || active.status === 'pending') return;
    const text = draft.trim(); setDraft(''); setError('');
    try {
      const { data } = await api.post(`/api/messages/${active._id}/messages`, { text });
      setMessages((current) => current.some((item) => item._id === data.message._id) ? current : [...current, data.message]);
      await loadInbox();
    } catch (requestError) { setDraft(text); setError(getApiError(requestError)); }
  }

  function draftChanged(value) {
    setDraft(value);
    if (!active || !socketRef.current?.connected) return;
    socketRef.current.emit('typing:start', { conversationId: active._id });
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socketRef.current?.emit('typing:stop', { conversationId: active._id }), 900);
  }

  async function deleteMessage(message, everyone = false) {
    setError('');
    try {
      await api.delete(`/api/messages/message/${message._id}${everyone ? '/everyone' : ''}`);
      setMessages((current) => current.map((item) => item._id !== message._id ? item : ({ ...item, text: everyone ? 'This message was deleted.' : 'You deleted this message.', deletedForMe: !everyone, deletedForEveryone: everyone })));
      setMessageMenu(null);
    } catch (requestError) { setError(getApiError(requestError)); }
  }

  async function reactToMessage(message, kind) {
    const previous = message.reactions;
    const optimistic = applyReaction(previous, previous?.myReaction === kind ? null : kind);
    setMessages((current) => current.map((item) => item._id === message._id ? { ...item, reactions: optimistic } : item));
    setError('');
    try {
      const { data } = await api.request(reactionRequest(`/api/messages/message/${message._id}`, previous, kind));
      setMessages((current) => current.map((item) => item._id === message._id ? { ...item, reactions: data.reactions } : item));
    } catch (requestError) {
      setMessages((current) => current.map((item) => item._id === message._id ? { ...item, reactions: previous } : item));
      setError(getApiError(requestError));
    }
  }

  async function toggleMute() {
    if (!active) return;
    setError('');
    const muted = Boolean(active.muted);
    try {
      const { data } = await api.request({ method: muted ? 'delete' : 'post', url: `/api/messages/${active._id}/mute` });
      setActive((current) => current ? { ...current, muted: data.muted } : current);
      setConversations((current) => current.map((item) => item._id === active._id ? { ...item, muted: data.muted } : item));
    } catch (requestError) { setError(getApiError(requestError)); }
  }

  function toggleMessageMenu(event, message) {
    if (messageMenu?.messageId === message._id) { setMessageMenu(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const menuWidth = Math.min(196, window.innerWidth - 16);
    const menuHeight = message.deletedForEveryone ? 54 : 96;
    const openAbove = rect.bottom + menuHeight + 8 > window.innerHeight && rect.top > menuHeight + 8;
    const top = openAbove ? rect.top - menuHeight - 6 : Math.min(window.innerHeight - menuHeight - 8, rect.bottom + 6);
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    messageMenuButtonRef.current = event.currentTarget;
    setMessageMenu({ messageId: message._id, top: Math.max(8, top), left, openAbove });
  }

  const selectedMenuMessage = messageMenu && messages.find((message) => message._id === messageMenu.messageId);
  return <>
  <section className={`messages-layout${mobileChat || quickChat ? ' mobile-chat-open' : ''}${quickChat ? ' quick-chat-layout' : ''}`}>
    <aside className="inbox-panel">
      <div className="inbox-heading"><div><span className="section-kicker">YOUR SPACE</span><h2>Messages</h2></div><button className="refresh-button" onClick={loadInbox}>Refresh</button></div>
      {requests.length > 0 && <section className="requests-section"><div className="inbox-subheading">MESSAGE REQUESTS <span>{requests.length}</span></div>{requests.map(({ conversation, sender, preview }) => <article className="request-row" key={conversation._id}><Avatar className="request-avatar" src={sender.avatarUrl} name={sender.displayName} userId={sender._id} size={38} /><div className="request-copy"><strong>{sender.displayName}</strong><p>{preview?.text || 'Sent you a message request.'}</p><div className="request-actions"><button onClick={() => respondToRequest(conversation._id, 'accept')} disabled={busy}><Check size={12} /> Accept</button><button onClick={() => respondToRequest(conversation._id, 'reject')} disabled={busy}>Decline</button></div></div></article>)}</section>}
      <div className="inbox-subheading">CONVERSATIONS</div>
      {loading && !conversations.length ? <div className="inbox-empty" role="status">Loading conversations…</div> : conversations.length ? conversations.map((conversation) => <button className={`conversation-row${active?._id === conversation._id ? ' selected' : ''}`} key={conversation._id} onClick={() => openChat(conversation)} aria-current={active?._id === conversation._id ? 'true' : undefined}>
        <Avatar className="conversation-avatar" src={conversation.participant.avatarUrl} name={conversation.participant.displayName} userId={conversation.participant._id} size={44} showPresence online={conversation.participant.online} />
        <span className="conversation-copy"><strong>{conversation.participant.displayName}{conversation.muted && <BellOff size={12} className="conversation-muted" aria-label="Muted" />}</strong><span>{conversation.lastMessage || 'Say hello and start a conversation'}</span></span>
        <span className="conversation-meta">{conversation.lastMessageAt && <time dateTime={conversation.lastMessageAt} title={new Date(conversation.lastMessageAt).toLocaleString()}>{formatConversationTime(conversation.lastMessageAt)}</time>}{conversation.unreadCount > 0 && <i aria-label={`${conversation.unreadCount} unread messages`}>{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</i>}</span>
      </button>) : <div className="inbox-empty"><div className="empty-icon"><MessageCircle size={17} /></div><p>No conversations yet.<br />Find someone in Explore.</p></div>}
    </aside>
    <div className="chat-panel">{active ? <>
      <header className="chat-header"><button className="back-inbox" onClick={() => setMobileChat(false)} aria-label="Back to conversations"><ArrowLeft size={18} /></button><Avatar className="conversation-avatar" src={active.participant.avatarUrl} name={active.participant.displayName} userId={active.participant._id} size={44} /><div className="chat-person"><strong>{active.participant.displayName}</strong><span><i className={active.participant.online ? 'online-dot online' : 'online-dot'} />{active.participant.online ? 'Online now' : `@${active.participant.username}`}{active.muted && ' · Muted'}</span></div>{active.status === 'accepted' && <button type="button" className={`icon-button chat-mute-button${active.muted ? ' muted' : ''}`} onClick={toggleMute} aria-pressed={Boolean(active.muted)} aria-label={active.muted ? 'Unmute this conversation' : 'Mute notifications for this conversation'} title={active.muted ? 'Unmute' : 'Mute'}>{active.muted ? <BellOff size={16} /> : <Bell size={16} />}</button>}{quickChat && <button type="button" className="quick-chat-close" onClick={onQuickChatClose} aria-label="Close quick chat"><X size={17} /></button>}</header>
      <div className="message-history" aria-live="polite">{loading ? <div className="feed-loading" role="status">Opening conversation…</div> : messages.length ? messages.map((message) => {
        const own = message.sender?._id === user._id;
        const recipientRead = own && message.readBy?.some((readerId) => readerId.toString() === active.participant._id.toString());
        return <div className={`message-line${own ? ' own' : ''}${messageMenu?.messageId === message._id ? ' has-message-menu' : ''}`} key={message._id}>
          <div className="message-stack">
            {own && <button type="button" className="message-menu-trigger" ref={messageMenu?.messageId === message._id ? messageMenuButtonRef : null} aria-label="Message actions" aria-haspopup="menu" aria-expanded={messageMenu?.messageId === message._id} onClick={(event) => toggleMessageMenu(event, message)}><MoreVertical size={17} aria-hidden="true" /></button>}
            <div className="message-bubble"><span className="message-sender">{own ? 'You' : message.sender?.displayName || active.participant.displayName}</span><p>{message.text}</p></div>
            {!message.deletedForEveryone && !message.deletedForMe && active.status === 'accepted' && (!own || message.reactions?.total > 0) && <ReactionBar summary={message.reactions} onReact={(kind) => reactToMessage(message, kind)} compact canAdd={!own} />}
            <div className="message-meta">
              <div className="message-meta-details"><time>{new Date(message.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>{own && <span className={`message-receipt${recipientRead ? ' is-read' : ''}`} aria-label={recipientRead ? 'Seen by recipient' : 'Sent'}>{recipientRead ? 'Seen' : 'Sent'}</span>}</div>
            </div>
          </div>
        </div>;
      }) : <div className="chat-empty"><div className="empty-icon"><MessageCircle size={18} /></div><p>A good conversation starts with a hello.</p></div>}{typing && <div className="typing-status" role="status">Typing…</div>}<div ref={bottomRef} /></div>
      {error && <p className="inline-error chat-error" role="alert">{error}</p>}
      <form className="message-composer" onSubmit={sendMessage}><input value={draft} onChange={(event) => draftChanged(event.target.value)} maxLength="4000" placeholder={active.status === 'pending' ? 'Waiting for their response…' : 'Write a message…'} aria-label="Write a message" disabled={active.status === 'pending'} /><button disabled={!draft.trim() || active.status === 'pending'} aria-label="Send message"><Send size={17} /></button></form>
    </> : <div className="chat-welcome">{quickChat && <button type="button" className="quick-chat-close" onClick={onQuickChatClose} aria-label="Close quick chat"><X size={17} /></button>}<div className="chat-welcome-orbit"><MessageCircle size={27} /></div><h3>Your conversations, in good company.</h3><p>Choose a conversation or find someone new to say hello to.</p></div>}</div>
  </section>
  {messageMenu && selectedMenuMessage && createPortal(<div className={`message-context-menu${messageMenu.openAbove ? ' opens-above' : ''}`} role="menu" aria-label="Message actions" ref={messageMenuRef} style={{ top: messageMenu.top, left: messageMenu.left }}>
    <button type="button" role="menuitem" className="message-context-item" onClick={() => deleteMessage(selectedMenuMessage)}><span>Delete for me</span></button>
    {!selectedMenuMessage.deletedForEveryone && <button type="button" role="menuitem" className="message-context-item destructive" onClick={() => deleteMessage(selectedMenuMessage, true)}><span>Delete for everyone</span></button>}
  </div>, document.body)}
  </>;
}
