import mongoose from 'mongoose';

const followRequestSchema = new mongoose.Schema({
  follower: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  following: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
}, { timestamps: true });
followRequestSchema.index({ follower: 1, following: 1 }, { unique: true });
followRequestSchema.index({ following: 1, createdAt: -1 });

export const FollowRequest = mongoose.model('FollowRequest', followRequestSchema);
