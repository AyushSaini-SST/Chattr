import mongoose from 'mongoose';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';

export const DELETED_MESSAGE_TEXT = 'This message was deleted.';

export async function deleteMessageForEveryone({
  messageId,
  requesterId,
  MessageModel = Message,
  ConversationModel = Conversation,
}) {
  if (!mongoose.isValidObjectId(messageId)) return { status: 'invalid-id' };

  const message = await MessageModel.findById(messageId);
  if (!message) return { status: 'not-found' };
  if (!mongoose.isValidObjectId(message.conversation)) return { status: 'not-found' };

  const conversation = await ConversationModel.findById(message.conversation);
  const requester = requesterId.toString();
  const participantIds = [conversation?.participantA, conversation?.participantB].filter(Boolean).map((id) => id.toString());
  if (!conversation || !participantIds.includes(requester)) return { status: 'not-found' };
  if (message.sender.toString() !== requester) return { status: 'forbidden' };

  message.deletedForEveryone = true;
  // Message.text is required by the schema, so retain a non-empty tombstone.
  // The formatter uses deletedForEveryone to show this same text to all viewers.
  message.text = DELETED_MESSAGE_TEXT;
  await message.save();

  const latest = await MessageModel.findOne({ conversation: conversation._id })
    .sort({ createdAt: -1, _id: -1 }).select('_id');
  const previewUpdated = latest?._id?.toString() === message._id.toString();
  if (previewUpdated) {
    conversation.lastMessage = DELETED_MESSAGE_TEXT;
    await conversation.save();
  }

  return {
    status: 'deleted',
    messageId: message._id.toString(),
    conversationId: conversation._id.toString(),
    conversation,
    previewUpdated,
  };
}
