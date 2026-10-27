import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateCurrentUser, isCurrentUser, mergeCurrentUser, resolveAvatarUrl } from '../src/features/auth/userState.js';
import { createCroppedAvatarFile } from '../src/utils/cropImage.js';

test('current-user avatar updates merge immediately and cannot replace a different signed-in account', () => {
  const current = { _id: 'user-1', username: 'taylor', displayName: 'Taylor', avatarUrl: '' };
  const updated = mergeCurrentUser(current, { _id: 'user-1', avatarUrl: '/api/media/avatars/user-1/image?v=2' });
  assert.equal(updated.avatarUrl, '/api/media/avatars/user-1/image?v=2');
  assert.equal(updated.username, 'taylor');
  assert.equal(mergeCurrentUser(current, { _id: 'user-2', avatarUrl: '/other' }), current);
});

test('already-loaded records use the canonical current-user avatar revision without affecting other users', () => {
  const current = { _id: 'user-1', avatarUrl: '/api/media/avatars/user-1/image?v=4' };
  const stalePostAuthorUrl = '/api/media/avatars/user-1/image?v=3';
  assert.equal(resolveAvatarUrl(current, 'user-1', stalePostAuthorUrl), current.avatarUrl);
  assert.equal(resolveAvatarUrl(current, 'user-2', '/api/media/avatars/user-2/image?v=1'), '/api/media/avatars/user-2/image?v=1');
  assert.equal(resolveAvatarUrl(current, undefined, stalePostAuthorUrl), stalePostAuthorUrl);
});

test('current-user relationship checks use stable IDs rather than usernames', () => {
  const currentUser = { _id: 'user-1', username: 'testCase' };
  assert.equal(isCurrentUser(currentUser, 'user-1'), true);
  assert.equal(isCurrentUser(currentUser, 'user-2'), false);
  assert.equal(isCurrentUser(currentUser, null), false);
  assert.equal(isCurrentUser(null, 'user-1'), false);
});

test('late auth hydration and refresh data cannot overwrite a newer uploaded avatar after route changes', () => {
  const latest = { _id: 'user-1', username: 'taylor', avatarUrl: '/api/media/avatars/user-1/image?v=5' };
  const staleHydration = { _id: 'user-1', username: 'taylor', avatarUrl: '/api/media/avatars/user-1/image?v=3' };
  const afterHydration = hydrateCurrentUser(latest, staleHydration);
  assert.equal(afterHydration.avatarUrl, latest.avatarUrl);
  assert.equal(resolveAvatarUrl(afterHydration, 'user-1', staleHydration.avatarUrl), latest.avatarUrl);

  const staleRefreshWithoutPhoto = { _id: 'user-1', username: 'taylor', avatarUrl: '' };
  assert.equal(mergeCurrentUser(latest, staleRefreshWithoutPhoto).avatarUrl, latest.avatarUrl);
  assert.equal(hydrateCurrentUser(null, staleHydration).avatarUrl, staleHydration.avatarUrl);
});

test('crop export creates a square JPEG File from the selected crop rectangle', async () => {
  let drawArguments;
  let outputWidth;
  let outputHeight;
  const context = { drawImage(...args) { drawArguments = args; } };
  const documentRef = { createElement(name) {
    assert.equal(name, 'canvas');
    return {
      set width(value) { outputWidth = value; },
      set height(value) { outputHeight = value; },
      getContext: () => context,
      toBlob(callback, type) { callback(new Blob(['cropped pixels'], { type })); },
    };
  } };
  class MockImage {
    naturalWidth = 600;
    naturalHeight = 400;
    set src(value) { this.source = value; queueMicrotask(() => this.onload()); }
  }
  class MockFile extends Blob {
    constructor(parts, name, options) { super(parts, options); this.name = name; }
  }
  const result = await createCroppedAvatarFile('blob:source', { x: 30, y: 20, width: 180, height: 176 }, {
    ImageCtor: MockImage, documentRef, FileCtor: MockFile,
  });
  assert.equal(outputWidth, 176);
  assert.equal(outputHeight, 176);
  assert.deepEqual(drawArguments.slice(1), [30, 20, 176, 176, 0, 0, 176, 176]);
  assert.equal(result.name, 'chattr-avatar.jpg');
  assert.equal(result.type, 'image/jpeg');
});

test('crop export reports invalid areas and canvas failures', async () => {
  await assert.rejects(() => createCroppedAvatarFile('blob:source', { x: 0, y: 0, width: 0, height: 0 }, {}), /invalid/i);
  class MockImage { set src(value) { queueMicrotask(() => this.onload()); } }
  await assert.rejects(() => createCroppedAvatarFile('blob:source', { x: 0, y: 0, width: 20, height: 20 }, {
    ImageCtor: MockImage, FileCtor: Blob, documentRef: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) },
  }), /browser could not prepare/i);
});
