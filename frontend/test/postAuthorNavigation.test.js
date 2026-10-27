import test from 'node:test';
import assert from 'node:assert/strict';
import { postAuthorProfilePath, shouldLinkPostAuthor } from '../src/features/posts/postAuthorNavigation.js';

test('Home and Explore feed cards make only the author identity a profile link', () => {
  assert.equal(shouldLinkPostAuthor('following'), true);
  assert.equal(shouldLinkPostAuthor('explore'), true);
  assert.equal(shouldLinkPostAuthor('saved'), false);
  assert.equal(shouldLinkPostAuthor('profile'), false);
});

test('Home author identity targets the existing username profile route for self and other authors', () => {
  assert.equal(postAuthorProfilePath({ username: 'ananya' }), '/u/ananya');
  assert.equal(postAuthorProfilePath({ username: 'my-account' }), '/u/my-account');
  assert.equal(postAuthorProfilePath({ _id: '111111111111111111111111' }), null);
});
