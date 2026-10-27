import { Notification } from '../models/Notification.js';
import { User } from '../models/User.js';
import { emitToUser } from '../realtime/socketServer.js';
import { isWithinQuietHours } from './quietHours.js';

// Notifications are always persisted. During the recipient's quiet hours the
// realtime push is skipped, so the item waits silently until they next open
// the app or the quiet window ends.
export async function createNotification({ recipient, actor, type, entityId, text = '' }) {
  if (!recipient || recipient.toString() === actor.toString()) return null;
  const notification = await Notification.create({ recipient, actor, type, entityId, text });
  const populated = await Notification.findById(notification._id).populate('actor', 'username displayName avatarUrl').lean();
  if (!(await recipientIsInQuietHours(recipient))) emitToUser(recipient, 'notification:new', populated);
  return populated;
}

async function recipientIsInQuietHours(recipient) {
  try {
    const query = User.findById(recipient);
    const user = typeof query?.select === 'function' ? await query.select('quietHours').lean() : await query;
    return isWithinQuietHours(user?.quietHours);
  } catch { return false; }
}
