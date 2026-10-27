import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'user-suggestions-test-secret';
const [{ app }, { User }, { Follow }, { FollowRequest }, { Block }] = await Promise.all([
  import('../src/app.js'), import('../src/models/User.js'), import('../src/models/Follow.js'),
  import('../src/models/FollowRequest.js'), import('../src/models/Block.js'),
]);

const originals = { userById: User.findById, userFind: User.find, followFind: Follow.find, requestFind: FollowRequest.find, blockFind: Block.find };
const viewerId = '111111111111111111111111';
const id = (number) => number.toString(16).padStart(24, '0');
const account = (number, { isPrivate = false } = {}) => ({
  _id: id(number), username: `user${number}`, displayName: `User ${number}`,
  isPrivate, headline: `Headline ${number}`, avatarUrl: `/avatar/${number}`,
});
const query = (value) => {
  let results = [...value];
  return {
    select() { return this; }, sort() { return this; },
    limit(count) { results = results.slice(0, count); return this; },
    lean: async () => results,
  };
};

async function withSuggestions(t, { candidates, followed = [], pending = [], blocks = [] }) {
  const userFilters = [];
  let followFilter;
  let requestFilter;
  User.findById = async () => ({ _id: viewerId, id: viewerId });
  User.find = (filter) => {
    userFilters.push(filter);
    const excluded = new Set([filter._id.$ne, ...(filter._id.$nin || [])].filter(Boolean).map(String));
    const included = filter._id.$in ? new Set(filter._id.$in.map(String)) : null;
    return query(candidates.filter((person) => !excluded.has(String(person._id)) && (!included || included.has(String(person._id)))));
  };
  Follow.find = (filter) => { followFilter = filter; return query(followed.map((following) => ({ following }))); };
  FollowRequest.find = (filter) => { requestFilter = filter; return query(pending.map((following) => ({ following }))); };
  Block.find = () => query(blocks.map(([blocker, blocked]) => ({ blocker, blocked })));

  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/users/suggestions`, {
    headers: { Cookie: `chattr_session=${token}` },
  });
  return { response, userFilters, followFilter, requestFilter };
}

test('five or more eligible unfollowed accounts take priority over followed accounts', async (t) => {
  const primary = Array.from({ length: 8 }, (_, index) => account(index + 10));
  const fallback = [account(30), account(31)];
  const { response, userFilters, followFilter } = await withSuggestions(t, {
    candidates: [...primary, ...fallback], followed: fallback.map((person) => person._id),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(followFilter, { follower: viewerId });
  const { users } = await response.json();
  assert.deepEqual(users.map((person) => person._id), primary.slice(0, 5).map((person) => person._id));
  assert.ok(users.every((person) => !person.isFollowing));
  assert.equal(userFilters.length, 1);
});

test('three eligible unfollowed accounts are filled with two accepted follows marked Following', async (t) => {
  const primary = [account(10), account(11), account(12)];
  const followed = [account(20), account(21, { isPrivate: true }), account(22)];
  const { response, userFilters } = await withSuggestions(t, {
    candidates: [...primary, ...followed], followed: followed.map((person) => person._id),
  });
  const { users } = await response.json();
  assert.deepEqual(users.map((person) => person._id), [...primary, ...followed.slice(0, 2)].map((person) => person._id));
  assert.deepEqual(users.slice(0, 3).map((person) => person.isFollowing), [false, false, false]);
  assert.deepEqual(users.slice(3).map((person) => person.isFollowing), [true, true]);
  assert.deepEqual(userFilters[1]._id.$in, followed.map((person) => person._id));
  assert.equal(userFilters[1]._id.$nin.includes(id(21)), false);
});

test('fewer than five eligible accounts returns all accounts without duplicates', async (t) => {
  const primary = [account(10), account(11)];
  const followed = [account(20)];
  const { response } = await withSuggestions(t, { candidates: [...primary, ...followed], followed: followed.map((person) => person._id) });
  const { users } = await response.json();
  assert.equal(users.length, 3);
  assert.equal(new Set(users.map((person) => person._id)).size, users.length);
});

test('self, either-side blocks, and pending requests are excluded from primary and fallback results', async (t) => {
  const self = { ...account(1), _id: viewerId };
  const blockedByViewer = account(2);
  const blockedViewer = account(3);
  const pendingPerson = account(4, { isPrivate: true });
  const eligible = account(5);
  const { response, userFilters, requestFilter } = await withSuggestions(t, {
    candidates: [self, blockedByViewer, blockedViewer, pendingPerson, eligible],
    followed: [blockedViewer._id, pendingPerson._id], pending: [pendingPerson._id],
    blocks: [[viewerId, blockedByViewer._id], [blockedViewer._id, viewerId]],
  });
  const { users } = await response.json();
  assert.deepEqual(users.map((person) => person._id), [eligible._id]);
  assert.equal(requestFilter.follower, viewerId);
  assert.ok(userFilters[0]._id.$nin.includes(pendingPerson._id));
  assert.ok(userFilters[0]._id.$nin.includes(blockedByViewer._id));
  assert.ok(userFilters[0]._id.$nin.includes(blockedViewer._id));
  assert.ok(userFilters[1]._id.$nin.includes(pendingPerson._id));
  assert.ok(userFilters[1]._id.$nin.includes(blockedViewer._id));
});

test('private primary suggestions hide profile metadata while accepted private fallbacks may show it', async (t) => {
  const publicPerson = account(10);
  const privatePrimary = account(11, { isPrivate: true });
  const privateFollowed = account(12, { isPrivate: true });
  const { response } = await withSuggestions(t, {
    candidates: [publicPerson, privatePrimary, privateFollowed], followed: [privateFollowed._id],
  });
  const { users } = await response.json();
  assert.equal(users[0].username, publicPerson.username);
  assert.equal(users[0].avatarUrl, publicPerson.avatarUrl);
  assert.equal(users[1].username, privatePrimary.username);
  assert.equal('avatarUrl' in users[1], false);
  assert.equal('headline' in users[1], false);
  assert.deepEqual(users[2], {
    _id: privateFollowed._id, username: privateFollowed.username, displayName: privateFollowed.displayName,
    isPrivate: true, isFollowing: true, hasPendingFollowRequest: false,
    avatarUrl: privateFollowed.avatarUrl, headline: privateFollowed.headline,
  });
});

test.after(() => {
  User.findById = originals.userById; User.find = originals.userFind; Follow.find = originals.followFind;
  FollowRequest.find = originals.requestFind; Block.find = originals.blockFind;
});
