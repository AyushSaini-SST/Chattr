import test from 'node:test';
import assert from 'node:assert/strict';
import { publishFollowRelationshipChange, subscribeToFollowRelationshipChanges } from '../src/features/users/followSync.js';

test('successful follow changes notify mounted suggestion lists to remove the account and refresh', () => {
  const target = new EventTarget();
  let detail;
  let refreshes = 0;
  const unsubscribe = subscribeToFollowRelationshipChanges((event) => { detail = event.detail; refreshes += 1; }, target);

  publishFollowRelationshipChange({ username: 'alice', following: true, requestPending: false }, target);
  assert.equal(refreshes, 1);
  assert.deepEqual(detail, { username: 'alice', following: true, requestPending: false });

  publishFollowRelationshipChange({ username: 'private-person', following: false, requestPending: true }, target);
  assert.equal(refreshes, 2);
  assert.deepEqual(detail, { username: 'private-person', following: false, requestPending: true });

  unsubscribe();
  publishFollowRelationshipChange({ username: 'alice', following: false, requestPending: false }, target);
  assert.equal(refreshes, 2);
});
