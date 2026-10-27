import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, trim: true, lowercase: true, minlength: 3, maxlength: 24 },
  email: { type: String, required: true, trim: true, lowercase: true },
  passwordHash: { type: String, required: true, select: false },
  displayName: { type: String, required: true, trim: true, maxlength: 60 },
  bio: { type: String, trim: true, maxlength: 280, default: '' },
  headline: { type: String, trim: true, maxlength: 100, default: '' },
  profileLink: { type: String, trim: true, maxlength: 200, default: '' },
  avatarUrl: { type: String, default: '' },
  avatarCloudinaryUrl: { type: String, default: '', select: false },
  avatarPublicId: { type: String, default: '', select: false },
  avatarFormat: { type: String, default: '', select: false },
  avatarBytes: { type: Number, default: 0, select: false },
  avatarRevision: { type: Number, default: 0, select: false },
  isPrivate: { type: Boolean, default: false },
  messagePreference: { type: String, enum: ['everyone', 'followers', 'nobody'], default: 'followers' },
  pinnedPost: { type: mongoose.Schema.Types.ObjectId, ref: 'Post', default: null },
  quietHours: {
    enabled: { type: Boolean, default: false },
    start: { type: String, default: '22:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    end: { type: String, default: '07:00', match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    timezoneOffset: { type: Number, default: 0, min: -840, max: 840 },
  },
}, { timestamps: true, toJSON: { transform(_doc, ret) { delete ret.passwordHash; delete ret.email; delete ret.avatarCloudinaryUrl; delete ret.avatarPublicId; delete ret.avatarFormat; delete ret.avatarBytes; delete ret.avatarRevision; return ret; } } });

userSchema.index({ username: 1 }, { unique: true });
userSchema.index({ email: 1 }, { unique: true });

export const User = mongoose.model('User', userSchema);
