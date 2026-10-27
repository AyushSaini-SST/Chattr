import test from 'node:test';
import assert from 'node:assert/strict';
import { splitHashtags, normalizeTag } from '../src/features/posts/hashtags.js';
import { loadDraft, saveDraft, clearDraft, draftKey } from '../src/features/posts/composerDraft.js';
import { applyReaction, reactionRequest, EMPTY_REACTIONS } from '../src/features/posts/reactions.js';

test('splitHashtags separates tags from text and preserves the original casing for display', () => {
  assert.deepEqual(splitHashtags('Hello #Chattr world #ghibli_style!'), [
    { type: 'text', value: 'Hello ' }, { type: 'tag', value: 'Chattr', tag: 'chattr' },
    { type: 'text', value: ' world ' }, { type: 'tag', value: 'ghibli_style', tag: 'ghibli_style' }, { type: 'text', value: '!' },
  ]);
  assert.deepEqual(splitHashtags('no tags'), [{ type: 'text', value: 'no tags' }]);
  assert.deepEqual(splitHashtags('email#not a tag'), [{ type: 'text', value: 'email#not a tag' }]);
  assert.equal(normalizeTag(' #Chattr '), 'chattr');
});

function memoryStorage() {
  const map = new Map();
  return { getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map };
}

test('composer drafts are saved per user, restored, and cleared', () => {
  const storage = memoryStorage();
  saveDraft('u1', { text: 'half a thought', visibility: 'followers' }, storage);
  assert.deepEqual(loadDraft('u1', storage), { text: 'half a thought', visibility: 'followers', savedAt: loadDraft('u1', storage).savedAt });
  assert.equal(loadDraft('u2', storage), null);
  saveDraft('u1', { text: '   ', visibility: 'public' }, storage);
  assert.equal(loadDraft('u1', storage), null);
  saveDraft('u1', { text: 'again', visibility: 'public' }, storage);
  clearDraft('u1', storage);
  assert.equal(storage.map.has(draftKey('u1')), false);
});

test('expired drafts are dropped', () => {
  const storage = memoryStorage();
  storage.setItem(draftKey('u1'), JSON.stringify({ text: 'old', visibility: 'public', savedAt: Date.now() - 8 * 24 * 60 * 60 * 1000 }));
  assert.equal(loadDraft('u1', storage), null);
});

test('applyReaction swaps the viewer reaction optimistically and reactionRequest picks the verb', () => {
  const first = applyReaction(EMPTY_REACTIONS, 'heart');
  assert.deepEqual(first, { counts: { heart: 1, spark: 0, laugh: 0, sad: 0 }, total: 1, myReaction: 'heart' });
  const swapped = applyReaction(first, 'spark');
  assert.deepEqual(swapped.counts, { heart: 0, spark: 1, laugh: 0, sad: 0 });
  const removed = applyReaction(swapped, null);
  assert.equal(removed.total, 0);
  assert.equal(removed.myReaction, null);
  assert.deepEqual(reactionRequest('/api/posts/p1', swapped, 'spark'), { method: 'delete', url: '/api/posts/p1/react' });
  assert.deepEqual(reactionRequest('/api/posts/p1', swapped, 'laugh'), { method: 'put', url: '/api/posts/p1/react', data: { kind: 'laugh' } });
});
