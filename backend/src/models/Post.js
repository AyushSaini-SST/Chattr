import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  text: { type: String, required: true, trim: true, maxlength: 1000 },
}, { timestamps: true });

const imageSchema = new mongoose.Schema({
  cloudinaryUrl: { type: String, required: true, select: false },
  publicId: { type: String, required: true, select: false },
  width: { type: Number, required: true, min: 1 },
  height: { type: Number, required: true, min: 1 },
  format: { type: String, enum: ['jpg', 'png', 'webp', 'gif'], required: true },
  bytes: { type: Number, required: true, min: 1 },
  alt: { type: String, trim: true, maxlength: 200, default: '' },
}, { _id: false });

export const REACTION_KINDS = ['heart', 'spark', 'laugh', 'sad'];
const reactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  kind: { type: String, enum: REACTION_KINDS, required: true },
}, { _id: false });

const postSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  text: { type: String, required() { return !this.image; }, trim: true, maxlength: 2000, default: '' },
  image: { type: imageSchema, default: undefined },
  visibility: { type: String, enum: ['public', 'followers'], default: 'public', index: true },
  likes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: { type: [reactionSchema], default: [] },
  tags: { type: [String], default: [], index: true },
  comments: [commentSchema],
}, { timestamps: true });

export function extractTags(text = '') {
  const found = new Set();
  for (const match of String(text).matchAll(/(^|[^\w#])#([\p{L}\p{N}_]{1,40})/gu)) found.add(match[2].toLowerCase());
  return [...found].slice(0, 20);
}
postSchema.pre('validate', function syncTags() { this.tags = extractTags(this.text); });
postSchema.index({ createdAt: -1, _id: -1 });
postSchema.index({ author: 1, createdAt: -1, _id: -1 });
export const Post = mongoose.model('Post', postSchema);
