import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { User } from '../models/User.js';
import { Block } from '../models/Block.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireClientOrigin } from '../middleware/requireClientOrigin.js';
import { canSendInConversation, canSendMessage, isBlockedEitherWay, isMutualFollow } from '../services/messaging.js';
import { emitToConversation, emitToUser } from '../realtime/socketServer.js';
import { createNotification } from '../services/notifications.js';
import { deleteMessageForEveryone } from '../services/messageDeletion.js';
import { reactionSummary, REACTION_KINDS } from '../services/postPresentation.js';

export const messageRoutes = Router();
messageRoutes.use(requireAuth);
const userFields = 'username displayName avatarUrl';
const messageInput = z.object({ text: z.string().trim().min(1).max(4000) }).strict();

function pairQuery(first, second) {
  const [participantA, participantB] = [first.toString(), second.toString()].sort();
  return { participantA, participantB };
}

function isParticipant(conversation, userId) {
  return conversation.participantA.toString() === userId.toString() || conversation.participantB.toString() === userId.toString();
}

function otherId(conversation, userId) {
  return conversation.participantA.toString() === userId.toString() ? conversation.participantB : conversation.participantA;
}

async function loadConversation(conversationId, userId) {
  if (!mongoose.isValidObjectId(conversationId)) return null;
  const conversation = await Conversation.findById(conversationId);
  if (!conversation || !isParticipant(conversation, userId)) return null;
  return conversation;
}

async function formatMessage(message, viewerId) {
  const item = message.toObject ? message.toObject() : message;
  const senderId = item.sender?._id || item.sender;
  const author = item.sender?.displayName ? item.sender : await User.findById(senderId).select(userFields).lean();
  const removedForMe = item.deletedFor.some((id) => id.toString() === viewerId.toString());
  return {
    _id: item._id,
    conversation: item.conversation,
    sender: author,
    text: item.deletedForEveryone ? 'This message was deleted.' : removedForMe ? 'You deleted this message.' : item.text,
    deletedForEveryone: item.deletedForEveryone,
    deletedForMe: removedForMe,
    readBy: item.readBy,
    reactions: reactionSummary(item.reactions || [], viewerId),
    createdAt: item.createdAt,
  };
}

function isMutedBy(conversation, userId) {
  return (conversation.mutedBy || []).some((id) => id.toString() === userId.toString());
}

messageRoutes.get('/requests', async (req, res, next) => {
  try {
    const blockedRows = await Block.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select('blocker blocked').lean();
    const blockedIds = new Set(blockedRows.map((row) => row.blocker.toString() === req.user.id ? row.blocked.toString() : row.blocker.toString()));
    const rows = await Conversation.find({ requestTo: req.user._id, status: 'pending' }).sort({ updatedAt: -1 })
      .populate('requestedBy', userFields).populate('requestTo', userFields);
    const requests = await Promise.all(rows.filter((conversation) => !blockedIds.has((conversation.requestedBy?._id || conversation.requestedBy).toString())).map(async (conversation) => {
      const first = await Message.findOne({ conversation: conversation._id }).sort({ createdAt: 1 });
      return { conversation, sender: conversation.requestedBy, preview: first ? await formatMessage(first, req.user._id) : null };
    }));
    res.json({ requests });
  } catch (error) { next(error); }
});

messageRoutes.patch('/requests/:conversationId', requireClientOrigin, async (req, res, next) => {
  try {
    const decision = z.object({ decision: z.enum(['accept', 'reject']) }).safeParse(req.body);
    if (!decision.success) return res.status(400).json({ error: { message: 'Choose accept or reject.' } });
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    if (!conversation || conversation.status !== 'pending' || conversation.requestTo.toString() !== req.user.id) return res.status(404).json({ error: { message: 'Message request not found.' } });
    if (decision.data.decision === 'accept' && await isBlockedEitherWay(conversation.participantA, conversation.participantB)) return res.status(403).json({ error: { message: 'This account is blocked.' } });
    conversation.status = decision.data.decision === 'accept' ? 'accepted' : 'rejected';
    conversation.acceptedVia = decision.data.decision === 'accept' ? 'request' : '';
    await conversation.save();
    emitToUser(conversation.requestedBy, 'message-request:updated', { conversationId: conversation.id, status: conversation.status });
    res.json({ conversationId: conversation.id, status: conversation.status });
  } catch (error) { next(error); }
});

messageRoutes.get('/', async (req, res, next) => {
  try {
    const blockedRows = await Block.find({ $or: [{ blocker: req.user._id }, { blocked: req.user._id }] }).select('blocker blocked').lean();
    const blockedIds = new Set(blockedRows.map((row) => row.blocker.toString() === req.user.id ? row.blocked.toString() : row.blocker.toString()));
    const rows = await Conversation.find({ $or: [
      { status: 'accepted', $or: [{ participantA: req.user._id }, { participantB: req.user._id }] },
      { status: 'pending', requestedBy: req.user._id },
    ] })
      .sort({ lastMessageAt: -1 }).populate('participantA', userFields).populate('participantB', userFields);
    const conversations = await Promise.all(rows.filter((conversation) => {
      const other = conversation.participantA._id.toString() === req.user.id ? conversation.participantB : conversation.participantA;
      return !blockedIds.has(other._id.toString());
    }).map(async (conversation) => {
      const other = conversation.participantA._id.toString() === req.user.id ? conversation.participantB : conversation.participantA;
      const unreadCount = await Message.countDocuments({ conversation: conversation._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id }, deletedFor: { $ne: req.user._id }, deletedForEveryone: { $ne: true } });
      return { _id: conversation._id, participant: other, lastMessage: conversation.lastMessage, lastMessageAt: conversation.lastMessageAt, unreadCount, muted: isMutedBy(conversation, req.user._id), status: conversation.status, outgoingRequestPending: conversation.status === 'pending' && conversation.requestedBy.toString() === req.user.id };
    }));
    res.json({ conversations });
  } catch (error) { next(error); }
});

messageRoutes.post('/:username', requireClientOrigin, async (req, res, next) => {
  try {
    const input = messageInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Message must be between 1 and 4000 characters.' } });
    const recipient = await User.findOne({ username: req.params.username.toLowerCase() });
    if (!recipient) return res.status(404).json({ error: { message: 'We could not find that account.' } });
    if (recipient.id === req.user.id) return res.status(400).json({ error: { message: 'You cannot message yourself.' } });
    if (await isBlockedEitherWay(req.user._id, recipient._id)) return res.status(403).json({ error: { message: 'You cannot message this account.' } });
    const query = pairQuery(req.user._id, recipient._id);
    let conversation = await Conversation.findOne(query);
    if (conversation?.status === 'rejected') return res.status(403).json({ error: { message: 'This message request was declined.' } });
    if (conversation?.status === 'pending') return res.status(409).json({ error: { message: 'A message request is already waiting for a response.' } });

    let createdConversation = false;
    if (!conversation) {
      const mutual = await isMutualFollow(req.user._id, recipient._id);
      const allowed = mutual || recipient.messagePreference === 'everyone';
      if (!allowed && recipient.messagePreference === 'nobody') return res.status(403).json({ error: { message: 'This account is not accepting message requests.' } });
      const status = allowed ? 'accepted' : 'pending';
      try {
        conversation = await Conversation.create({ ...query, status, acceptedVia: status === 'accepted' ? (mutual ? 'mutual' : 'preference') : '', requestedBy: req.user._id, requestTo: recipient._id });
        createdConversation = true;
      } catch (error) {
        if (error.code !== 11000) throw error;
        conversation = await Conversation.findOne(query);
        if (!conversation || conversation.status !== 'accepted') return res.status(409).json({ error: { message: 'A message request is already waiting for a response.' } });
      }
    }

    // A block may have been added while the conversation was being created.
    // Recheck before storing the first message so the block always wins.
    if (await isBlockedEitherWay(req.user._id, recipient._id)) {
      if (createdConversation) {
        conversation.status = 'rejected';
        conversation.acceptedVia = '';
        await conversation.save();
      }
      return res.status(403).json({ error: { message: 'You cannot message this account.' } });
    }

    if (conversation.status === 'pending' && createdConversation) {
      const message = await Message.create({ conversation: conversation._id, sender: req.user._id, text: input.data.text, readBy: [req.user._id] });
      conversation.lastMessage = message.text;
      conversation.lastMessageAt = message.createdAt;
      await conversation.save();
      const payload = await formatMessage(await Message.findById(message._id).populate('sender', userFields), req.user._id);
      await createNotification({ recipient: recipient._id, actor: req.user._id, type: 'message_request', entityId: conversation._id, text: message.text.slice(0, 100) });
      emitToUser(recipient._id, 'message-request:new', { conversationId: conversation.id, sender: { _id: req.user._id, username: req.user.username, displayName: req.user.displayName, avatarUrl: req.user.avatarUrl }, preview: payload });
      emitToUser(req.user._id, 'conversation:update', { conversationId: conversation.id, status: 'pending' });
      return res.status(201).json({ conversationId: conversation.id, status: 'pending', message: payload });
    }
    if (conversation.status !== 'accepted' || !(await canSendInConversation(req.user, recipient, conversation))) return res.status(403).json({ error: { message: 'Messaging is not currently available.' } });
    const message = await Message.create({ conversation: conversation._id, sender: req.user._id, text: input.data.text, readBy: [req.user._id] });
    conversation.lastMessage = message.text;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();
    const payload = await formatMessage(await Message.findById(message._id).populate('sender', userFields), req.user._id);
    if (!isMutedBy(conversation, recipient._id)) await createNotification({ recipient: recipient._id, actor: req.user._id, type: 'message', entityId: conversation._id, text: message.text.slice(0, 100) });
    emitToConversation(conversation.id, 'message:new', payload);
    emitToUser(req.user._id, 'conversation:update', { conversationId: conversation.id, lastMessage: message.text, lastMessageAt: message.createdAt });
    emitToUser(recipient._id, 'conversation:update', { conversationId: conversation.id, lastMessage: message.text, lastMessageAt: message.createdAt });
    res.status(201).json({ conversationId: conversation.id, status: conversation.status, message: payload });
  } catch (error) { next(error); }
});

messageRoutes.get('/:conversationId/messages', async (req, res, next) => {
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    const senderCanViewPending = conversation?.status === 'pending' && conversation.requestedBy.toString() === req.user.id;
    if (!conversation || (conversation.status !== 'accepted' && !senderCanViewPending) || await isBlockedEitherWay(conversation.participantA, conversation.participantB)) return res.status(404).json({ error: { message: 'Conversation not found.' } });
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 50);
    const query = { conversation: conversation._id, deletedFor: { $ne: req.user._id } };
    if (req.query.before) {
      if (!mongoose.isValidObjectId(req.query.before)) return res.status(400).json({ error: { message: 'Invalid pagination cursor.' } });
      query._id = { $lt: req.query.before };
    }
    const messages = await Message.find(query).sort({ _id: -1 }).limit(limit + 1).populate('sender', userFields);
    const hasMore = messages.length > limit;
    const page = messages.slice(0, limit).reverse();
    res.json({ messages: await Promise.all(page.map((message) => formatMessage(message, req.user._id))), nextCursor: hasMore ? messages[limit]._id : null });
  } catch (error) { next(error); }
});

messageRoutes.post('/:conversationId/messages', requireClientOrigin, async (req, res, next) => {
  try {
    const input = messageInput.safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Message must be between 1 and 4000 characters.' } });
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    if (!conversation || conversation.status !== 'accepted') return res.status(404).json({ error: { message: 'Conversation not found.' } });
    const recipient = await User.findById(otherId(conversation, req.user._id));
    if (!recipient || !(await canSendInConversation(req.user, recipient, conversation))) return res.status(403).json({ error: { message: 'Messaging is not currently available.' } });
    const message = await Message.create({ conversation: conversation._id, sender: req.user._id, text: input.data.text, readBy: [req.user._id] });
    conversation.lastMessage = message.text;
    conversation.lastMessageAt = message.createdAt;
    await conversation.save();
    const payload = await formatMessage(await Message.findById(message._id).populate('sender', userFields), req.user._id);
    if (!isMutedBy(conversation, recipient._id)) await createNotification({ recipient: recipient._id, actor: req.user._id, type: 'message', entityId: conversation._id, text: message.text.slice(0, 100) });
    emitToConversation(conversation.id, 'message:new', payload);
    emitToUser(req.user._id, 'conversation:update', { conversationId: conversation.id, lastMessage: message.text, lastMessageAt: message.createdAt });
    emitToUser(recipient._id, 'conversation:update', { conversationId: conversation.id, lastMessage: message.text, lastMessageAt: message.createdAt });
    res.status(201).json({ message: payload });
  } catch (error) { next(error); }
});

messageRoutes.post('/:conversationId/read', requireClientOrigin, async (req, res, next) => {
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    if (!conversation || conversation.status !== 'accepted' || await isBlockedEitherWay(conversation.participantA, conversation.participantB)) return res.status(404).json({ error: { message: 'Conversation not found.' } });
    await Message.updateMany({ conversation: conversation._id, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } }, { $addToSet: { readBy: req.user._id } });
    emitToConversation(conversation.id, 'read:update', { conversationId: conversation.id, userId: req.user.id, readAt: new Date() });
    res.json({ read: true });
  } catch (error) { next(error); }
});

messageRoutes.post('/:conversationId/mute', requireClientOrigin, async (req, res, next) => {
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found.' } });
    await Conversation.updateOne({ _id: conversation._id }, { $addToSet: { mutedBy: req.user._id } });
    res.json({ conversationId: conversation.id, muted: true });
  } catch (error) { next(error); }
});

messageRoutes.delete('/:conversationId/mute', requireClientOrigin, async (req, res, next) => {
  try {
    const conversation = await loadConversation(req.params.conversationId, req.user._id);
    if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found.' } });
    await Conversation.updateOne({ _id: conversation._id }, { $pull: { mutedBy: req.user._id } });
    res.json({ conversationId: conversation.id, muted: false });
  } catch (error) { next(error); }
});

async function loadReactableMessage(req, res) {
  if (!mongoose.isValidObjectId(req.params.messageId)) { res.status(400).json({ error: { message: 'Invalid message ID.' } }); return null; }
  const message = await Message.findById(req.params.messageId);
  const conversation = message && await loadConversation(message.conversation, req.user._id);
  if (!message || !conversation || conversation.status !== 'accepted' || message.deletedForEveryone || message.deletedFor.some((id) => id.toString() === req.user.id)) {
    res.status(404).json({ error: { message: 'Message not found.' } });
    return null;
  }
  return { message, conversation };
}

function broadcastReaction(conversation, message) {
  const event = { messageId: message.id, conversationId: conversation.id, action: 'reacted' };
  emitToUser(conversation.participantA, 'message:changed', event);
  emitToUser(conversation.participantB, 'message:changed', event);
}

messageRoutes.put('/message/:messageId/react', requireClientOrigin, async (req, res, next) => {
  try {
    const input = z.object({ kind: z.enum(REACTION_KINDS) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: { message: 'Choose a valid reaction.' } });
    const loaded = await loadReactableMessage(req, res);
    if (!loaded) return;
    const { message, conversation } = loaded;
    const existing = message.reactions.find((reaction) => reaction.user.toString() === req.user.id);
    if (existing) existing.kind = input.data.kind; else message.reactions.push({ user: req.user._id, kind: input.data.kind });
    await message.save();
    broadcastReaction(conversation, message);
    res.json({ messageId: message.id, reactions: reactionSummary(message.reactions, req.user._id) });
  } catch (error) { next(error); }
});

messageRoutes.delete('/message/:messageId/react', requireClientOrigin, async (req, res, next) => {
  try {
    const loaded = await loadReactableMessage(req, res);
    if (!loaded) return;
    const { message, conversation } = loaded;
    await Message.updateOne({ _id: message._id }, { $pull: { reactions: { user: req.user._id } } });
    const updated = await Message.findById(message._id).select('reactions');
    broadcastReaction(conversation, message);
    res.json({ messageId: message.id, reactions: reactionSummary(updated.reactions, req.user._id) });
  } catch (error) { next(error); }
});

messageRoutes.delete('/message/:messageId', requireClientOrigin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ error: { message: 'Invalid message ID.' } });
    const message = await Message.findById(req.params.messageId);
    if (!message) return res.status(404).json({ error: { message: 'Message not found.' } });
    const conversation = await loadConversation(message.conversation, req.user._id);
    if (!conversation) return res.status(404).json({ error: { message: 'Message not found.' } });
    await Message.updateOne({ _id: message._id }, { $addToSet: { deletedFor: req.user._id } });
    emitToUser(req.user._id, 'message:changed', { messageId: message.id, conversationId: conversation.id, userId: req.user.id, action: 'deleted-for-me' });
    res.status(204).end();
  } catch (error) { next(error); }
});

messageRoutes.delete('/message/:messageId/everyone', requireClientOrigin, async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.messageId)) return res.status(400).json({ error: { message: 'Invalid message ID.' } });
    const result = await deleteMessageForEveryone({ messageId: req.params.messageId, requesterId: req.user._id });
    if (result.status === 'invalid-id') return res.status(400).json({ error: { message: 'Invalid message ID.' } });
    if (result.status === 'not-found') return res.status(404).json({ error: { message: 'Message not found.' } });
    if (result.status === 'forbidden') return res.status(403).json({ error: { message: 'Only the sender can delete this message for everyone.' } });
    const deletionEvent = {
      messageId: result.messageId, conversationId: result.conversationId, action: 'deleted-for-everyone',
    };
    // User rooms are joined on every authenticated socket connection. This
    // delivers to both participants even if a conversation-room join was lost.
    emitToUser(result.conversation.participantA, 'message:changed', deletionEvent);
    emitToUser(result.conversation.participantB, 'message:changed', deletionEvent);
    if (result.previewUpdated) {
      const preview = { conversationId: result.conversationId, lastMessage: result.conversation.lastMessage, lastMessageAt: result.conversation.lastMessageAt };
      emitToUser(result.conversation.participantA, 'conversation:update', preview);
      emitToUser(result.conversation.participantB, 'conversation:update', preview);
    }
    res.status(204).end();
  } catch (error) { next(error); }
});
