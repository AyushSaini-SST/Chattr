import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import { env } from '../config/env.js';
import { User } from '../models/User.js';
import { Post } from '../models/Post.js';

const configured = Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
if (configured) cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export function isCloudinaryConfigured() { return configured; }

function requireCloudinary() {
  if (!configured) throw Object.assign(new Error('Image uploads are not configured on this server.'), { status: 503 });
}

export function uploadCloudinaryImage(buffer, folder) {
  requireCloudinary();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({
      folder,
      public_id: randomUUID(),
      resource_type: 'image',
      type: 'authenticated',
      allowed_formats: ['jpg', 'png', 'webp', 'gif'],
      overwrite: false,
    }, (error, result) => {
      if (error || !result) return reject(Object.assign(new Error('Image upload failed. Please try again.'), { status: 502 }));
      resolve(result);
    });
    Readable.from(buffer).pipe(stream);
  });
}

export function authenticatedImageUrl(publicId, format) {
  requireCloudinary();
  return cloudinary.url(publicId, {
    secure: true,
    sign_url: true,
    type: 'authenticated',
    resource_type: 'image',
    format,
  });
}

export async function destroyCloudinaryImage(publicId) {
  if (!configured || !publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: 'image', type: 'authenticated', invalidate: true });
  } catch {
    // The database reference has already been removed. Failed cleanup leaves only an orphaned Cloudinary asset.
    console.warn('Cloudinary image cleanup failed; an unreferenced asset may remain.');
  }
}

export async function destroyCloudinaryImageIfUnreferenced(publicId, { UserModel = User, PostModel = Post, destroy = destroyCloudinaryImage } = {}) {
  if (!publicId) return false;
  const [avatarReference, postReference] = await Promise.all([
    UserModel.exists({ avatarPublicId: publicId }),
    PostModel.exists({ 'image.publicId': publicId }),
  ]);
  if (avatarReference || postReference) return false;
  await destroy(publicId);
  return true;
}
