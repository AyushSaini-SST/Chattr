import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['follow', 'like', 'reaction', 'comment', 'message', 'message_request'], required: true },
  entityId: { type: mongoose.Schema.Types.ObjectId },
  text: { type: String, maxlength: 120, default: '' },
  readAt: { type: Date, default: null },
}, { timestamps: true });
notificationSchema.index({ recipient: 1, readAt: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', notificationSchema);
