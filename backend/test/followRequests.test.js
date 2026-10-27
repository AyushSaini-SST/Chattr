import test from 'node:test';
import assert from 'node:assert/strict';
import { decideFollowRequest, followProfile, hasAcceptedFollow } from '../src/services/followRequests.js';

function fakeModels() {
  const follows = new Set();
  const requests = new Map();
  let nextId = 1;
  const key = ({ follower, following }) => `${follower}:${following}`;
  const Follow = {
    async exists(query) { return follows.has(key(query)); },
    async updateOne(query) {
      const entry = key(query);
      const upsertedCount = follows.has(entry) ? 0 : 1;
      follows.add(entry);
      return { upsertedCount };
    },
  };
  const FollowRequest = {
    async updateOne(query) {
      const entry = key(query);
      const upsertedCount = requests.has(entry) ? 0 : 1;
      if (!requests.has(entry)) requests.set(entry, { ...query, _id: `request-${nextId++}` });
      return { upsertedCount };
    },
    async deleteOne(query) {
      for (const [entry, request] of requests) if (request._id === query._id) requests.delete(entry);
    },
  };
  return { Follow, FollowRequest, follows, requests };
}

test('public follow remains an accepted Follow relationship', async () => {
  const models = fakeModels();
  const result = await followProfile({ requesterId: 'alice', target: { _id: 'bob', isPrivate: false }, ...models });
  assert.equal(result.following, true);
  assert.equal(result.requestPending, false);
  assert.equal(await hasAcceptedFollow('alice', 'bob', models.Follow), true);
});

test('private follow creates a pending request and grants no access before approval', async () => {
  const models = fakeModels();
  const result = await followProfile({ requesterId: 'alice', target: { _id: 'bob', isPrivate: true }, ...models });
  assert.equal(result.following, false);
  assert.equal(result.requestPending, true);
  assert.equal(await hasAcceptedFollow('alice', 'bob', models.Follow), false);
});

test('duplicate private follow actions keep one pending request', async () => {
  const models = fakeModels();
  const target = { _id: 'bob', isPrivate: true };
  await followProfile({ requesterId: 'alice', target, ...models });
  await followProfile({ requesterId: 'alice', target, ...models });
  assert.equal(models.requests.size, 1);
  assert.equal(models.follows.size, 0);
});

test('profile owner approval creates Follow and removes the request', async () => {
  const models = fakeModels();
  await followProfile({ requesterId: 'alice', target: { _id: 'bob', isPrivate: true }, ...models });
  const request = models.requests.get('alice:bob');
  const result = await decideFollowRequest({ request, ownerId: 'bob', decision: 'approve', ...models });
  assert.equal(result.status, 'approved');
  assert.equal(await hasAcceptedFollow('alice', 'bob', models.Follow), true);
  assert.equal(models.requests.size, 0);
});

test('profile owner rejection removes the request without creating a Follow', async () => {
  const models = fakeModels();
  await followProfile({ requesterId: 'alice', target: { _id: 'bob', isPrivate: true }, ...models });
  const request = models.requests.get('alice:bob');
  const result = await decideFollowRequest({ request, ownerId: 'bob', decision: 'reject', ...models });
  assert.equal(result.status, 'rejected');
  assert.equal(await hasAcceptedFollow('alice', 'bob', models.Follow), false);
  assert.equal(models.requests.size, 0);
});

test('requester cannot approve their own follow request', async () => {
  const models = fakeModels();
  const request = { _id: 'self', follower: 'alice', following: 'alice' };
  const result = await decideFollowRequest({ request, ownerId: 'alice', decision: 'approve', ...models });
  assert.equal(result.status, 'self-request');
  assert.equal(models.follows.size, 0);
});
