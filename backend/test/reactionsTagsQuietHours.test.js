import test from 'node:test';
import assert from 'node:assert/strict';

const [{ extractTags }, { reactionSummary, postForClient }, { isWithinQuietHours }] = await Promise.all([
  import('../src/models/Post.js'), import('../src/services/postPresentation.js'), import('../src/services/quietHours.js'),
]);

test('extractTags finds unique, lower-cased hashtags and ignores mid-word hashes', () => {
  assert.deepEqual(extractTags('Shipping #Chattr today. #ghibli_style #chattr not#atag'), ['chattr', 'ghibli_style']);
  assert.deepEqual(extractTags(''), []);
  assert.equal(extractTags(Array.from({ length: 40 }, (_, index) => `#t${index}`).join(' ')).length, 20);
});

test('reactionSummary counts per kind and reports the viewer reaction without exposing user ids', () => {
  const viewer = '111111111111111111111111';
  const summary = reactionSummary([
    { user: viewer, kind: 'heart' }, { user: '222222222222222222222222', kind: 'heart' }, { user: '333333333333333333333333', kind: 'laugh' }, { user: '444444444444444444444444', kind: 'unknown' },
  ], viewer);
  assert.deepEqual(summary, { counts: { heart: 2, spark: 0, laugh: 1, sad: 0 }, total: 3, myReaction: 'heart' });
  assert.equal(reactionSummary([], viewer).myReaction, null);
});

test('postForClient replaces the raw reactions list with a summary and keeps image alt text', () => {
  const post = postForClient({ _id: 'p1', text: 'hi', reactions: [{ user: 'u1', kind: 'spark' }], image: { cloudinaryUrl: 'secret', publicId: 'secret', width: 1, height: 1, format: 'jpg', bytes: 1, alt: 'A hill' } }, 'u1');
  assert.equal(post.reactions.myReaction, 'spark');
  assert.equal(post.image.alt, 'A hill');
  assert.equal(post.image.cloudinaryUrl, undefined);
  assert.equal(post.image.url, '/api/media/posts/p1/image');
});

test('isWithinQuietHours handles windows that cross midnight and the user offset', () => {
  const quiet = { enabled: true, start: '22:00', end: '07:00', timezoneOffset: 330 };
  // 23:30 IST == 18:00 UTC
  assert.equal(isWithinQuietHours(quiet, new Date('2026-10-27T18:00:00Z')), true);
  // 12:00 IST == 06:30 UTC
  assert.equal(isWithinQuietHours(quiet, new Date('2026-10-27T06:30:00Z')), false);
  assert.equal(isWithinQuietHours({ ...quiet, enabled: false }, new Date('2026-10-27T18:00:00Z')), false);
  assert.equal(isWithinQuietHours({ enabled: true, start: '09:00', end: '17:00', timezoneOffset: 0 }, new Date('2026-10-27T12:00:00Z')), true);
  assert.equal(isWithinQuietHours(undefined), false);
});
