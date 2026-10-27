import mongoose from 'mongoose';

const reportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, select: false },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  targetPost: { type: mongoose.Schema.Types.ObjectId, ref: 'Post' },
  reason: { type: String, enum: ['spam', 'harassment', 'inappropriate', 'impersonation', 'other'], required: true },
  details: { type: String, trim: true, maxlength: 1000, default: '' },
  status: { type: String, enum: ['open', 'reviewing', 'resolved', 'dismissed'], default: 'open' },
}, { timestamps: true });
reportSchema.index({ status: 1, createdAt: 1 });
reportSchema.index({ targetUser: 1, createdAt: -1 });
reportSchema.index({ targetPost: 1, createdAt: -1 });
export const Report = mongoose.model('Report', reportSchema);
