import test from 'node:test';
import assert from 'node:assert/strict';
import { getPostFollowAction } from '../src/features/posts/postFollowAction.js';

const viewerId = 'viewer-id';

test('post follow action is hidden for own posts and authors already followed', () => {
  assert.equal(getPostFollowAction({ _id: viewerId, username: 'me' }, viewerId), null);
  assert.equal(getPostFollowAction({ _id: 'author', username: 'friend', isFollowing: true }, viewerId), null);
});

test('public and private unfollowed authors can be followed from an eligible post', () => {
  assert.deepEqual(getPostFollowAction({ _id: 'author', username: 'public-person', isPrivate: false }, viewerId), { label: 'Follow', action: 'follow' });
  assert.deepEqual(getPostFollowAction({ _id: 'author', username: 'private-person', isPrivate: true }, viewerId), { label: 'Follow', action: 'follow' });
});

test('pending private follow requests show Requested and use the cancel action', () => {
  assert.deepEqual(getPostFollowAction({ _id: 'author', username: 'private-person', isPrivate: true, hasPendingFollowRequest: true }, viewerId), { label: 'Requested', action: 'cancel' });
});
