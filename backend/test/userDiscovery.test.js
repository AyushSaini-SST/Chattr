import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'user-discovery-test-secret';
const [{ app }, { User }, { Follow }, { FollowRequest }, { Block }, { Post }, { SavedPost }] = await Promise.all([
  import('../src/app.js'), import('../src/models/User.js'), import('../src/models/Follow.js'),
  import('../src/models/FollowRequest.js'), import('../src/models/Block.js'), import('../src/models/Post.js'), import('../src/models/SavedPost.js'),
]);

const originals = { userById: User.findById, userFind: User.find, followFind: Follow.find, requestFind: FollowRequest.find, blockFind: Block.find, postAggregate: Post.aggregate, postFind: Post.find, savedFind: SavedPost.find };
const viewerId = '000000000000000000000001';
const id = (number) => number.toString(16).padStart(24, '0');
const account = (number, isPrivate = false) => ({ _id: id(number), username: `user${number}`, displayName: `User ${number}`, isPrivate, headline: `Headline ${number}`, avatarUrl: `/api/media/avatars/${number}` });

function query(value) {
  let results = [...value];
  return {
    select() { return this; }, populate() { return this; },
    sort(spec = {}) { const [field, direction] = Object.entries(spec)[0] || []; if (field) results.sort((a, b) => direction < 0 ? String(b[field]).localeCompare(String(a[field])) : String(a[field]).localeCompare(String(b[field]))); return this; },
    limit(count) { results = results.slice(0, count); return this; },
    lean: async () => results,
  };
}

function matchesIdFilter(person, filter) {
  const value = filter._id || {};
  const personId = String(person._id);
  if (value.$ne && personId === String(value.$ne)) return false;
  if (value.$nin?.some((excluded) => personId === String(excluded))) return false;
  if (value.$in && !value.$in.some((included) => personId === String(included))) return false;
  if (value.$lt && personId >= String(value.$lt)) return false;
  return true;
}

async function withServer(t, { accounts, follows = [], pending = [], blocks = [], posts = [] }) {
  User.findById = async () => ({ _id: viewerId, id: viewerId });
  User.find = (filter) => query(accounts.filter((person) => matchesIdFilter(person, filter)));
  Follow.find = (filter) => {
    const rows = filter.following?.$in
      ? follows.filter((following) => filter.following.$in.some((target) => String(target) === String(following))).map((following) => ({ following }))
      : follows.map((following) => ({ following }));
    return query(rows);
  };
  FollowRequest.find = () => query(pending.map((following) => ({ following })));
  Block.find = (filter) => {
    const ids = new Set([...(filter.$or?.flatMap((part) => [part.blocker, part.blocked]) || [])].flatMap((value) => value?.$in || [value]).filter(Boolean).map(String));
    return query(blocks.filter(([blocker, blocked]) => ids.has(String(blocker)) || ids.has(String(blocked))).map(([blocker, blocked]) => ({ blocker, blocked })));
  };
  Post.aggregate = async (pipeline) => {
    const match = pipeline[0].$match;
    const authors = new Set(match.author.$in.map(String));
    const followedAuthors = new Set((match.$or.find((condition) => condition.author)?.author.$in || []).map(String));
    const visible = posts.filter((post) => authors.has(String(post.author)) && (post.visibility === 'public' || followedAuthors.has(String(post.author))))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const grouped = new Map();
    for (const post of visible) grouped.set(String(post.author), [...(grouped.get(String(post.author)) || []), post]);
    return [...grouped].map(([author, values]) => ({ _id: author, posts: values.slice(0, 3) }));
  };
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  t.after(() => {
    User.findById = originals.userById; User.find = originals.userFind; Follow.find = originals.followFind;
    FollowRequest.find = originals.requestFind; Block.find = originals.blockFind; Post.aggregate = originals.postAggregate;
  });
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  return async (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Cookie: `chattr_session=${token}` } });
}

test('discovery excludes self, followed, pending, and either-direction blocked accounts; private unfollowed metadata stays limited', async (t) => {
  const privateUnfollowed = account(11, true);
  const privatePending = account(12, true);
  const privateFollowed = account(21, true);
  const publicUnfollowed = account(10);
  const followed = account(20);
  const accounts = [account(1), publicUnfollowed, privateUnfollowed, privatePending, account(13), account(14), followed, privateFollowed];
  const post = (number, author, visibility = 'public') => ({ _id: id(number), author: id(author), text: `Post ${number}`, createdAt: `2026-01-${String(number).padStart(2, '0')}`, visibility, image: { cloudinaryUrl: 'private-provider-url', publicId: 'private-provider-id', width: 640, height: 480, format: 'jpg', bytes: 123 } });
  const posts = [post(30, 10), post(31, 10), post(32, 10), post(33, 10), post(34, 11), post(35, 20), post(36, 20, 'followers'), post(37, 21, 'followers')];
  const request = await withServer(t, {
    accounts, follows: [id(20), id(21)], pending: [id(12)], blocks: [[viewerId, id(13)], [id(14), viewerId]], posts,
  });
  const response = await request('/api/users/discover?limit=20');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { users } = await response.json();
  assert.deepEqual(users.map((person) => person._id), [id(11), id(10), id(21), id(20)]);
  assert.deepEqual(users.map((person) => person.isFollowing), [false, false, true, true]);
  const privatePerson = users.find((person) => person._id === id(11));
  assert.equal(privatePerson.avatarUrl, undefined);
  assert.equal(privatePerson.headline, undefined);
  assert.deepEqual(privatePerson.postPreviews, []);
  assert.equal(users.find((person) => person._id === id(10)).postPreviews.length, 3);
  const safeImage = users.find((person) => person._id === id(10)).postPreviews[0].image;
  assert.equal(safeImage.url, `/api/media/posts/${id(33)}/image`);
  assert.equal(safeImage.cloudinaryUrl, undefined);
  assert.equal(safeImage.publicId, undefined);
  assert.deepEqual(users.find((person) => person._id === id(20)).postPreviews.map((item) => item._id), [id(36), id(35)]);
  assert.deepEqual(users.find((person) => person._id === id(21)).postPreviews.map((item) => item._id), [id(37)]);
});

test('unfollowed accounts precede followed fallback and cursor pages do not repeat accounts', async (t) => {
  const oneUnfollowed = account(10);
  const followed = [account(20), account(21)];
  const request = await withServer(t, { accounts: [oneUnfollowed, ...followed], follows: followed.map((person) => person._id) });
  const first = await request('/api/users/discover?limit=2');
  const firstPage = await first.json();
  assert.deepEqual(firstPage.users.map((person) => person._id), [oneUnfollowed._id, followed[1]._id]);
  assert.equal(firstPage.users[0].isFollowing, false);
  assert.equal(firstPage.users[1].isFollowing, true);
  assert.equal(firstPage.nextCursor, `f.${followed[1]._id}`);
  const second = await request(`/api/users/discover?limit=2&cursor=${firstPage.nextCursor}`);
  const secondPage = await second.json();
  assert.deepEqual(secondPage.users.map((person) => person._id), [followed[0]._id]);
  assert.equal(secondPage.nextCursor, null);
});

test('malformed discovery cursors are rejected', async (t) => {
  const request = await withServer(t, { accounts: [] });
  const response = await request('/api/users/discover?cursor=not-a-cursor');
  assert.equal(response.status, 400);
});

test('global search reports pending private follow requests without revealing private details', async (t) => {
  const pendingPrivate = account(42, true);
  const originalUserFindById = User.findById;
  const originalUserFind = User.find;
  const originalFollowFind = Follow.find;
  const originalRequestFind = FollowRequest.find;
  const originalBlockFind = Block.find;
  const originalPostFind = Post.find;
  User.findById = async () => ({ _id: viewerId, id: viewerId });
  User.find = () => query([pendingPrivate]);
  Follow.find = () => query([]);
  FollowRequest.find = () => query([{ following: pendingPrivate._id }]);
  Block.find = () => query([]);
  Post.find = () => query([]);
  SavedPost.find = () => query([]);
  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  t.after(() => {
    User.findById = originalUserFindById; User.find = originalUserFind; Follow.find = originalFollowFind;
    FollowRequest.find = originalRequestFind; Block.find = originalBlockFind; Post.find = originalPostFind; SavedPost.find = originals.savedFind;
  });
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=user`, { headers: { Cookie: `chattr_session=${token}` } });
  assert.equal(response.status, 200);
  const { users } = await response.json();
  assert.equal(users[0].hasPendingFollowRequest, true);
  assert.equal(users[0].avatarUrl, undefined);
  assert.equal(users[0].headline, undefined);
});
