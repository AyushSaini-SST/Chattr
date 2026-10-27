import { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck, Heart, MessageCircle, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, getApiError } from '../services/api.js';

const actorName = (item) => item.actor?.displayName || 'Someone';
const descriptions = {
  follow: (item) => `${actorName(item)} started following you.`,
  like: (item) => `${actorName(item)} liked your post.`,
  reaction: (item) => `${actorName(item)} reacted to your post${item.text ? ` with ${({ heart: 'love', spark: 'a spark', laugh: 'a laugh', sad: 'an umbrella' })[item.text] || item.text}` : ''}.`,
  comment: (item) => `${actorName(item)} commented: “${item.text}”`,
  message: (item) => `${actorName(item)} sent you a message.`,
  message_request: (item) => `${actorName(item)} sent you a message request.`,
};
const icons = { follow: UserRound, like: Heart, reaction: Heart, comment: MessageCircle, message: MessageCircle, message_request: Bell };
function formatNotificationTime(value) {
  const date = new Date(value);
  const elapsed = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) });
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await api.get('/api/notifications');
      setItems(data.notifications);
      setUnread(data.unreadCount);
    } catch (requestError) {
      setError(getApiError(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markOne(id) {
    try {
      await api.post(`/api/notifications/${id}/read`);
      setItems((current) => current.map((item) => item._id === id ? { ...item, readAt: new Date() } : item));
      setUnread((count) => Math.max(count - 1, 0));
    } catch (requestError) {
      setError(getApiError(requestError));
    }
  }

  async function openNotification(item) {
    if (!item.readAt) await markOne(item._id);
    if (item.type === 'follow' && item.actor?.username) navigate(`/u/${item.actor.username}`);
    else if ((item.type === 'like' || item.type === 'reaction' || item.type === 'comment') && item.entityId) navigate(`/p/${item.entityId}`);
    else if (item.type === 'message' || item.type === 'message_request') navigate('/messages');
  }

  async function markAll() {
    try {
      await api.post('/api/notifications/read-all');
      setItems((current) => current.map((item) => ({ ...item, readAt: item.readAt || new Date() })));
      setUnread(0);
    } catch (requestError) {
      setError(getApiError(requestError));
    }
  }

  return <section className="notifications-page">
    <div className="notification-toolbar">
      <span>{unread ? `${unread} unread` : 'You’re all caught up'}</span>
      {unread > 0 && <button onClick={markAll}><CheckCheck size={14} /> Mark all read</button>}
    </div>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {loading ? <div className="feed-loading">Checking in…</div> : items.length ? <div className="notification-timeline">{items.map((item) => {
      const Icon = icons[item.type] || Bell;
      const notificationDate = new Date(item.createdAt);
      return <article
        className={`notification-row${item.readAt ? '' : ' unread'}`}
        key={item._id}
        onClick={() => openNotification(item)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openNotification(item);
          }
        }}
      >
        <div className={`notification-icon notification-icon-${item.type}`}><Icon size={18} strokeWidth={1.9} /></div>
        <p>{descriptions[item.type]?.(item) || 'You have a new update.'}<time dateTime={notificationDate.toISOString()} title={notificationDate.toLocaleString()}>{formatNotificationTime(item.createdAt)}</time></p>
        {!item.readAt && <span className="notification-dot" />}
      </article>;
    })}</div> : <div className="social-empty">
      <div className="empty-icon"><Bell size={18} /></div>
      <h3>Nothing new, for now.</h3>
      <p>Your follows, replies, and messages will show up here.</p>
    </div>}
  </section>;
}
