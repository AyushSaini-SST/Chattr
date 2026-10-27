import test from 'node:test';
import assert from 'node:assert/strict';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';
import { validateImageFile, AVATAR_IMAGE_MAX_BYTES, POST_IMAGE_MAX_BYTES } from '../src/middleware/imageUpload.js';
import { destroyCloudinaryImageIfUnreferenced } from '../src/services/cloudinary.js';
import { postForClient } from '../src/services/postPresentation.js';
import { canViewAvatar } from '../src/routes/mediaRoutes.js';

const sampleBytes = {
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff, 0x00]),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/webp': Buffer.from('RIFF0000WEBP'),
  'image/gif': Buffer.from('GIF89a'),
};

test('image upload accepts supported signatures and enforces the per-flow size limits', () => {
  for (const [mimetype, buffer] of Object.entries(sampleBytes)) {
    assert.equal(validateImageFile({ mimetype, buffer, size: buffer.length }, POST_IMAGE_MAX_BYTES), mimetype);
  }
  assert.equal(AVATAR_IMAGE_MAX_BYTES, 5 * 1024 * 1024);
  assert.equal(POST_IMAGE_MAX_BYTES, 8 * 1024 * 1024);
  assert.throws(() => validateImageFile({ mimetype: 'image/png', buffer: sampleBytes['image/png'], size: POST_IMAGE_MAX_BYTES + 1 }, POST_IMAGE_MAX_BYTES), { status: 413 });
  assert.throws(() => validateImageFile({ mimetype: 'image/png', buffer: sampleBytes['image/jpeg'], size: 4 }, POST_IMAGE_MAX_BYTES), { status: 415 });
  assert.throws(() => validateImageFile({ mimetype: 'image/svg+xml', buffer: Buffer.from('<svg/>'), size: 6 }, POST_IMAGE_MAX_BYTES), { status: 415 });
});

test('text-only posts remain valid and image-only posts satisfy the real schema while blank text posts fail', () => {
  const author = '507f1f77bcf86cd799439011';
  const textPost = new Post({ author, text: 'hello' });
  const imagePost = new Post({ author, text: '', image: {
    cloudinaryUrl: 'https://cloudinary.example/private', publicId: 'chattr/posts/example',
    width: 1200, height: 800, format: 'jpg', bytes: 2048,
  } });
  const emptyPost = new Post({ author, text: '' });
  assert.equal(textPost.validateSync(), undefined);
  assert.equal(imagePost.validateSync(), undefined);
  assert.equal(emptyPost.validateSync().errors.text.kind, 'required');
});

test('client post serialization exposes only the authorized media proxy path, never Cloudinary identifiers or URLs', () => {
  const post = postForClient({ _id: 'post-id', image: { cloudinaryUrl: 'https://secret.example', publicId: 'secret-id', width: 20, height: 30, format: 'png', bytes: 100 } });
  assert.deepEqual(post.image, { width: 20, height: 30, format: 'png', bytes: 100, url: '/api/media/posts/post-id/image' });
});

test('user JSON includes the versioned media proxy URL but strips Cloudinary asset identifiers', () => {
  const user = new User({
    username: 'taylor', email: 'taylor@example.com', passwordHash: 'hash', displayName: 'Taylor',
    avatarUrl: '/api/media/avatars/507f1f77bcf86cd799439011/image?v=3',
    avatarCloudinaryUrl: 'https://cloudinary.example/private', avatarPublicId: 'private-asset-id',
    avatarFormat: 'jpg', avatarBytes: 100, avatarRevision: 3,
  }).toJSON();
  assert.match(user.avatarUrl, /image\?v=3$/);
  assert.equal(user.avatarPublicId, undefined);
  assert.equal(user.avatarCloudinaryUrl, undefined);
  assert.equal(user.avatarRevision, undefined);
});

test('orphan cleanup preserves referenced assets and deletes only unreferenced ones', async () => {
  const deleted = [];
  const models = {
    UserModel: { exists: async () => null },
    PostModel: { exists: async () => null },
    destroy: async (id) => deleted.push(id),
  };
  assert.equal(await destroyCloudinaryImageIfUnreferenced('used-by-post', { ...models, PostModel: { exists: async () => ({ _id: 'post' }) } }), false);
  assert.deepEqual(deleted, []);
  assert.equal(await destroyCloudinaryImageIfUnreferenced('orphan', models), true);
  assert.deepEqual(deleted, ['orphan']);
});

test('private avatar access requires an accepted follow, and blocks always deny access', async () => {
  const viewer = 'viewer-id';
  const user = { _id: 'owner-id', isPrivate: true };
  let blocked = false;
  let following = false;
  const models = {
    BlockModel: { exists: async () => blocked },
    FollowModel: { exists: async () => following },
  };
  assert.equal(await canViewAvatar(viewer, user, models), false);
  following = true;
  assert.equal(await canViewAvatar(viewer, user, models), true);
  following = false;
  assert.equal(await canViewAvatar(viewer, { ...user, isPrivate: false }, models), true);
  assert.equal(await canViewAvatar(viewer, { ...user, _id: viewer, isPrivate: true }, models), true);
  assert.equal(await canViewAvatar(viewer, user, models), false);
  blocked = true;
  assert.equal(await canViewAvatar(viewer, user, models), false);
});
