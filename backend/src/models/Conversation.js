import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema({
  participantA: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  participantB: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['accepted', 'pending', 'rejected'], required: true },
  acceptedVia: { type: String, enum: ['mutual', 'preference', 'request', ''], default: '' },
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  requestTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  lastMessage: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now },
  mutedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
}, { timestamps: true });
conversationSchema.index({ participantA: 1, participantB: 1 }, { unique: true });
conversationSchema.index({ requestTo: 1, status: 1, updatedAt: -1 });
conversationSchema.index({ participantA: 1, lastMessageAt: -1 });
conversationSchema.index({ participantB: 1, lastMessageAt: -1 });
export const Conversation = mongoose.model('Conversation', conversationSchema);
