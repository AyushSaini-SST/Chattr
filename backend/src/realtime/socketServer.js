import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { allowedOrigins, env } from '../config/env.js';
import { User } from '../models/User.js';
import { Conversation } from '../models/Conversation.js';
import { canSendInConversation } from '../services/messaging.js';

let io;
const activeSockets = new Map();

function sessionFromCookie(header = '') {
  for (const part of header.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === 'chattr_session') return decodeURIComponent(rawValue.join('='));
  }
  return null;
}

export function attachSocketServer(httpServer) {
  io = new Server(httpServer, { cors: { origin: allowedOrigins, credentials: true } });
  io.use(async (socket, next) => {
    try {
      const token = sessionFromCookie(socket.handshake.headers.cookie);
      if (!token) return next(new Error('Authentication required.'));
      const payload = jwt.verify(token, env.JWT_SECRET);
      const user = await User.findById(payload.sub);
      if (!user) return next(new Error('Authentication required.'));
      socket.data.user = user;
      next();
    } catch { next(new Error('Authentication required.')); }
  });
  io.on('connection', (socket) => {
    const userId = socket.data.user.id;
    socket.join(`user:${userId}`);
    activeSockets.set(userId, (activeSockets.get(userId) || 0) + 1);
    io.emit('presence:update', { userId, online: true });

    socket.on('conversation:join', async ({ conversationId } = {}, ack = () => {}) => {
      try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || conversation.status !== 'accepted' || ![conversation.participantA.toString(), conversation.participantB.toString()].includes(userId)) return ack({ error: 'Conversation unavailable.' });
        const otherId = conversation.participantA.toString() === userId ? conversation.participantB : conversation.participantA;
        const recipient = await User.findById(otherId);
        if (!recipient || !(await canSendInConversation(socket.data.user, recipient, conversation))) return ack({ error: 'Messaging is not currently available.' });
        socket.join(`conversation:${conversationId}`);
        ack({ ok: true });
      } catch { ack({ error: 'Could not open this conversation.' }); }
    });

    async function updateTyping(conversationId, typing) {
      const room = `conversation:${conversationId}`;
      if (!socket.rooms.has(room)) return;
      try {
        const conversation = await Conversation.findById(conversationId);
        if (!conversation || conversation.status !== 'accepted' || ![conversation.participantA.toString(), conversation.participantB.toString()].includes(userId)) { socket.leave(room); return; }
        const otherId = conversation.participantA.toString() === userId ? conversation.participantB : conversation.participantA;
        const recipient = await User.findById(otherId);
        if (!recipient || !(await canSendInConversation(socket.data.user, recipient, conversation))) { socket.leave(room); return; }
        socket.to(room).emit('typing:update', { conversationId, userId, typing });
      } catch { socket.leave(room); }
    }
    socket.on('typing:start', ({ conversationId } = {}) => updateTyping(conversationId, true));
    socket.on('typing:stop', ({ conversationId } = {}) => updateTyping(conversationId, false));
    socket.on('disconnect', () => {
      const count = Math.max((activeSockets.get(userId) || 1) - 1, 0);
      if (count) activeSockets.set(userId, count);
      else { activeSockets.delete(userId); io.emit('presence:update', { userId, online: false }); }
    });
  });
  return io;
}

export function emitToUser(userId, event, payload) { io?.to(`user:${userId}`).emit(event, payload); }
export function emitToConversation(conversationId, event, payload) { io?.to(`conversation:${conversationId}`).emit(event, payload); }
export function revokeConversationAccess(conversationId, participantIds) {
  if (!io) return;
  const room = `conversation:${conversationId}`;
  io.in(room).socketsLeave(room);
  for (const userId of participantIds) {
    io.to(`user:${userId}`).emit('conversation:unavailable', { conversationId: conversationId.toString() });
  }
}
