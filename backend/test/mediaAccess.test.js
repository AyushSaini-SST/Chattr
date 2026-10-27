import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'media-access-test-secret';
const [{ app }, { User }, { Follow }, { Block }] = await Promise.all([
  import('../src/app.js'), import('../src/models/User.js'), import('../src/models/Follow.js'), import('../src/models/Block.js'),
]);

const originals = { findById: User.findById, followExists: Follow.exists, blockExists: Block.exists };
const viewerId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';

async function withMediaServer(t) {
  const sessionUser = { _id: viewerId, id: viewerId };
  User.findById = (id) => {
    if (id.toString() === viewerId) return Promise.resolve(sessionUser);
    return { select: async () => ({ _id: ownerId, isPrivate: true, avatarPublicId: 'private-avatar', avatarFormat: 'jpg' }) };
  };
  Follow.exists = async () => false;
  Block.exists = async () => false;
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  return {
    request: (headers = {}) => fetch(`${base}/api/media/avatars/${ownerId}/image`, { headers: { Cookie: `chattr_session=${token}`, Origin: 'http://localhost:5173', ...headers } }),
    anonymous: () => fetch(`${base}/api/media/avatars/${ownerId}/image`),
  };
}

test.after(() => {
  User.findById = originals.findById;
  Follow.exists = originals.followExists;
  Block.exists = originals.blockExists;
});

test('private avatar media endpoint matches its path, requires auth and rejects unauthorized viewers', async (t) => {
  const { request, anonymous } = await withMediaServer(t);
  assert.equal((await anonymous()).status, 401);
  const denied = await request();
  assert.equal(denied.status, 404);
  assert.match((await denied.text()), /Image not found/i);
});

test('private avatar media endpoint requires the configured client origin', async (t) => {
  const { request } = await withMediaServer(t);
  const denied = await request({ Origin: 'https://untrusted.example' });
  assert.equal(denied.status, 403);
});
