import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPostLikeState, submitPostLikeChange } from '../src/features/posts/postLike.js';

test('liking a post applies the server result to that post without requesting a feed reload', async () => {
  const post = { _id: 'post-1', likedByMe: false, likeCount: 4 };
  const requestCalls = [];
  const updates = [];
  const state = await submitPostLikeChange({
    post,
    request: async (config) => { requestCalls.push(config); return { data: { liked: true, likeCount: 5 } }; },
    onSuccess: (...args) => updates.push(args),
  });

  assert.deepEqual(requestCalls, [{ method: 'put', url: '/api/posts/post-1/like' }]);
  assert.deepEqual(state, { likedByMe: true, likeCount: 5 });
  assert.deepEqual(updates, [['post-1', { likedByMe: true, likeCount: 5 }]]);
});

test('unliking uses the delete endpoint and applies the returned count', async () => {
  let updated;
  const state = await submitPostLikeChange({
    post: { _id: 'post-2', likedByMe: true, likeCount: 5 },
    request: async (config) => {
      assert.deepEqual(config, { method: 'delete', url: '/api/posts/post-2/like' });
      return { data: { liked: false, likeCount: 4 } };
    },
    onSuccess: (_, likeState) => { updated = likeState; },
  });
  assert.deepEqual(state, { likedByMe: false, likeCount: 4 });
  assert.deepEqual(updated, state);
});

test('a failed like request does not change the post state', async () => {
  let updated = false;
  await assert.rejects(submitPostLikeChange({
    post: { _id: 'post-3', likedByMe: false, likeCount: 1 },
    request: async () => { throw new Error('request rejected'); },
    onSuccess: () => { updated = true; },
  }), /request rejected/);
  assert.equal(updated, false);
});

test('the feed state updater changes only the liked post and preserves other post references', () => {
  const target = { _id: 'post-1', likedByMe: false, likeCount: 4, comments: [] };
  const other = { _id: 'post-2', likedByMe: false, likeCount: 1 };
  const next = applyPostLikeState([target, other], 'post-1', { likedByMe: true, likeCount: 5 });
  assert.deepEqual(next[0], { ...target, likedByMe: true, likeCount: 5 });
  assert.notEqual(next[0], target);
  assert.equal(next[1], other);
});
