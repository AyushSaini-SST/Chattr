import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'profile-relationship-test-secret';
const [{ app }, { User }, { Follow }, { FollowRequest }, { Block }] = await Promise.all([
  import('../src/app.js'), import('../src/models/User.js'), import('../src/models/Follow.js'),
  import('../src/models/FollowRequest.js'), import('../src/models/Block.js'),
]);

const originals = {
  userById: User.findById, userOne: User.findOne, followExists: Follow.exists, followFind: Follow.find,
  requestFind: FollowRequest.find, requestExists: FollowRequest.exists, blockExists: Block.exists, blockFind: Block.find,
};
const oid = (digit) => digit.repeat(24);
const viewerId = oid('1');
const ownerId = oid('2');

function query(value) {
  return {
    select() { return this; }, sort() { return this; }, limit() { return this; }, populate() { return this; },
    lean: async () => value,
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

async function withServer(t, { profile, relationships = [], blockedPairs = [], accepted = [], pending = [] }) {
  User.findById = async () => ({ _id: viewerId, id: viewerId });
  User.findOne = () => query(profile);
  Follow.exists = async ({ follower, following }) => accepted.some((row) => row.follower === follower && row.following === following);
  Follow.find = (filter) => {
    if (filter.following === ownerId) return query(relationships.filter((row) => row.following === ownerId).map((row) => ({ ...row, follower: row.person })));
    if (filter.follower === ownerId) return query(relationships.filter((row) => row.follower === ownerId).map((row) => ({ ...row, following: row.person })));
    const ids = filter.following?.$in || [];
    return query(accepted.filter((row) => row.follower === viewerId && ids.includes(row.following)).map((row) => ({ following: row.following })));
  };
  FollowRequest.find = () => query(pending.map((following) => ({ following })));
  FollowRequest.exists = async ({ follower, following }) => pending.some((id) => id === following);
  Block.exists = async () => false;
  Block.find = () => query(blockedPairs.map(([blocker, blocked]) => ({ blocker, blocked })));
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  return {
    request: (path) => fetch(`${base}${path}`, { headers: { Cookie: `chattr_session=${token}` } }),
    anonymous: (path) => fetch(`${base}${path}`),
  };
}

test.after(() => {
  User.findById = originals.userById; User.findOne = originals.userOne; Follow.exists = originals.followExists;
  Follow.find = originals.followFind; FollowRequest.find = originals.requestFind; FollowRequest.exists = originals.requestExists;
  Block.exists = originals.blockExists; Block.find = originals.blockFind;
});

test('the mounted app matches both relationship paths and requires authentication', async (t) => {
  const { anonymous } = await withServer(t, { profile: { _id: ownerId, isPrivate: false } });
  for (const path of ['/api/users/alice/followers', '/api/users/alice/following']) {
    const response = await anonymous(path);
    assert.equal(response.status, 401, `${path} should match its route and require authentication`);
    assert.doesNotMatch((await response.text()), /Route not found/i);
  }
});

test('followers endpoint denies a private profile list until the viewer is an accepted follower', async (t) => {
  const { request } = await withServer(t, { profile: { _id: ownerId, isPrivate: true } });
  const response = await request('/api/users/alice/followers');
  assert.equal(response.status, 403);
  assert.match((await response.json()).error.message, /private/i);
});

test('public following endpoint omits private and blocked accounts and returns only UI fields', async (t) => {
  const publicPerson = { _id: oid('3'), username: 'public', displayName: 'Public Person', avatarUrl: '/avatar.png', isPrivate: false };
  const privatePerson = { _id: oid('4'), username: 'private', displayName: 'Private Person', avatarUrl: '', isPrivate: true };
  const blockedPerson = { _id: oid('5'), username: 'blocked', displayName: 'Blocked Person', avatarUrl: '', isPrivate: false };
  const { request } = await withServer(t, {
    profile: { _id: ownerId, isPrivate: false },
    relationships: [
      { follower: ownerId, person: publicPerson }, { follower: ownerId, person: privatePerson }, { follower: ownerId, person: blockedPerson },
    ],
    blockedPairs: [[viewerId, blockedPerson._id]],
  });
  const response = await request('/api/users/alice/following');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.users.map((person) => person.username), ['public']);
  assert.deepEqual(Object.keys(data.users[0]).sort(), ['_id', 'avatarUrl', 'displayName', 'hasPendingFollowRequest', 'isFollowing', 'username'].sort());
});

test('relationship counts match eligible list rows, including the viewer only for actual accepted follows', async (t) => {
  const viewer = { _id: viewerId, username: 'viewer', displayName: 'Viewer', avatarUrl: '', isPrivate: true };
  const publicPerson = { _id: oid('3'), username: 'public', displayName: 'Public', avatarUrl: '', isPrivate: false };
  const privatePerson = { _id: oid('4'), username: 'private', displayName: 'Private', avatarUrl: '', isPrivate: true };
  const viewerBlockedPerson = { _id: oid('5'), username: 'viewerblocked', displayName: 'Viewer blocked', avatarUrl: '', isPrivate: false };
  const profileBlockedPerson = { _id: oid('6'), username: 'profileblocked', displayName: 'Profile blocked', avatarUrl: '', isPrivate: false };
  const profile = {
    _id: ownerId, id: ownerId, username: 'alice', displayName: 'Alice', isPrivate: false,
    toJSON() { return { _id: this._id, username: this.username, displayName: this.displayName, isPrivate: this.isPrivate }; },
  };
  const members = [viewer, publicPerson, privatePerson, viewerBlockedPerson, profileBlockedPerson];
  const relationships = [
    ...members.map((person) => ({ follower: person._id, following: ownerId, person })),
    ...members.map((person) => ({ follower: ownerId, following: person._id, person })),
  ];
  const { request } = await withServer(t, {
    profile, relationships,
    accepted: [{ follower: viewerId, following: ownerId }],
    blockedPairs: [[viewerId, viewerBlockedPerson._id], [ownerId, profileBlockedPerson._id]],
  });

  const profileResponse = await request('/api/users/alice');
  const profileData = (await profileResponse.json()).user;
  assert.equal(profileData.followerCount, 2);
  assert.equal(profileData.followingCount, 2);

  for (const kind of ['followers', 'following']) {
    const response = await request(`/api/users/alice/${kind}`);
    const data = await response.json();
    assert.deepEqual(data.users.map((person) => person._id), [viewerId, publicPerson._id]);
  }
});

test('pending requests do not create relationship rows or inflate profile counts', async (t) => {
  const profile = {
    _id: ownerId, id: ownerId, username: 'alice', displayName: 'Alice', isPrivate: false,
    toJSON() { return { _id: this._id, username: this.username, displayName: this.displayName, isPrivate: this.isPrivate }; },
  };
  const { request } = await withServer(t, { profile, pending: [ownerId] });

  const profileResponse = await request('/api/users/alice');
  const profileData = (await profileResponse.json()).user;
  assert.equal(profileData.followerCount, 0);
  assert.equal(profileData.followingCount, 0);
  for (const kind of ['followers', 'following']) {
    const response = await request(`/api/users/alice/${kind}`);
    assert.deepEqual((await response.json()).users, []);
  }
});

test('accepted followers can access a private list and invalid cursors are rejected', async (t) => {
  const person = { _id: oid('6'), username: 'friend', displayName: 'Friend', avatarUrl: '', isPrivate: false };
  const { request } = await withServer(t, {
    profile: { _id: ownerId, isPrivate: true },
    accepted: [{ follower: viewerId, following: ownerId }],
    relationships: [{ following: ownerId, person }],
  });
  const response = await request('/api/users/alice/followers');
  assert.equal(response.status, 200);
  assert.equal((await response.json()).users[0].username, 'friend');
  const invalid = await request('/api/users/alice/followers?cursor=nope');
  assert.equal(invalid.status, 400);
});

test('followers and following endpoints expose every relationship across cursor pages', async (t) => {
  const { request } = await withServer(t, { profile: { _id: ownerId, isPrivate: false } });
  const makePeople = (prefix) => Array.from({ length: 35 }, (_, index) => ({
    _id: ((index + 10).toString(16)).padStart(24, '0'),
    username: `${prefix}${index + 1}`,
    displayName: `${prefix} ${index + 1}`,
    avatarUrl: '',
    isPrivate: false,
  }));
  const followers = makePeople('follower');
  const following = makePeople('following');
  const privateViewer = { _id: viewerId, username: 'viewer', displayName: 'Viewer', avatarUrl: '', isPrivate: true };
  followers[34] = privateViewer;
  following[34] = privateViewer;
  Follow.find = (filter) => {
    let rows;
    if (filter.following === ownerId) rows = followers.map((person, index) => ({ _id: ((index + 1).toString(16)).padStart(24, '0'), follower: person }));
    else if (filter.follower === ownerId) rows = following.map((person, index) => ({ _id: ((index + 1).toString(16)).padStart(24, '0'), following: person }));
    else return query([]);
    if (filter._id?.$lt) rows = rows.filter((row) => row._id < filter._id.$lt);
    rows.sort((left, right) => right._id.localeCompare(left._id));
    let limit = rows.length;
    return {
      sort() { return this; },
      limit(value) { limit = value; return this; },
      populate() { return this; },
      lean: async () => rows.slice(0, limit),
    };
  };

  for (const [kind, expected] of [['followers', followers], ['following', following]]) {
    const firstResponse = await request(`/api/users/alice/${kind}`);
    assert.equal(firstResponse.status, 200);
    const firstPage = await firstResponse.json();
    assert.equal(firstPage.users.length, 30);
    assert.ok(firstPage.nextCursor);

    const secondResponse = await request(`/api/users/alice/${kind}?cursor=${firstPage.nextCursor}`);
    assert.equal(secondResponse.status, 200);
    const secondPage = await secondResponse.json();
    assert.equal(secondPage.users.length, 5);
    assert.equal(secondPage.nextCursor, null);
    const allUsers = [...firstPage.users, ...secondPage.users];
    assert.deepEqual(allUsers.map((person) => person.username).sort(), expected.map((person) => person.username).sort());
    assert.equal(allUsers.filter((person) => person._id === viewerId).length, 1);
    assert.equal(new Set(allUsers.map((person) => person._id)).size, allUsers.length);
  }
});
