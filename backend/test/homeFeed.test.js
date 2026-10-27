import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'home-feed-regression-test-secret';
const [{ app }, { User }, { Post }, { Follow }, { FollowRequest }, { Block }, { SavedPost }] = await Promise.all([
  import('../src/app.js'), import('../src/models/User.js'), import('../src/models/Post.js'),
  import('../src/models/Follow.js'), import('../src/models/FollowRequest.js'), import('../src/models/Block.js'), import('../src/models/SavedPost.js'),
]);

const originals = { userFindById: User.findById, postFind: Post.find, postFindById: Post.findById, followFind: Follow.find, followExists: Follow.exists, followRequestFind: FollowRequest.find, blockExists: Block.exists, savedFind: SavedPost.find };
const viewerId = '111111111111111111111111';
const id = (number) => number.toString(16).padStart(24, '0');
const person = (number, { username = `person${number}`, isPrivate = false } = {}) => ({ _id: id(number), username, displayName: `Person ${number}`, avatarUrl: '', headline: '', isPrivate });
const post = (number, author, { visibility = 'public', date = number } = {}) => ({
  _id: id(number + 100), author, visibility, text: `Post ${number}`, createdAt: new Date(Date.UTC(2026, 0, date)),
  likes: [], comments: [],
});

function query(value) {
  let rows = [...value];
  return {
    select() { return this; }, populate() { return this; },
    sort(spec = {}) {
      const descending = Object.values(spec)[0] < 0;
      rows.sort((a, b) => {
        const dateDifference = new Date(a.createdAt) - new Date(b.createdAt);
        if (dateDifference) return descending ? -dateDifference : dateDifference;
        return descending ? String(b._id).localeCompare(String(a._id)) : String(a._id).localeCompare(String(b._id));
      });
      return this;
    },
    limit(count) { rows = rows.slice(0, count); return this; },
    lean: async () => rows,
  };
}

function matches(postItem, filter) {
  if (filter.author?.$in && !filter.author.$in.some((authorId) => String(authorId) === String(postItem.author._id))) return false;
  if (filter.author?.$nin?.some((authorId) => String(authorId) === String(postItem.author._id))) return false;
  if (filter.visibility && filter.visibility !== postItem.visibility) return false;
  if (filter.$or) {
    const [older, sameDateOlderId] = filter.$or;
    const createdAt = new Date(postItem.createdAt);
    const olderDate = older.createdAt.$lt && createdAt < new Date(older.createdAt.$lt);
    const sameDate = sameDateOlderId.createdAt?.getTime?.() === createdAt.getTime() && String(postItem._id) < String(sameDateOlderId._id.$lt);
    if (!olderDate && !sameDate) return false;
  }
  return true;
}

async function withFeed(t, { posts, follows = [], pending = [], blocked = [] }) {
  const users = new Map([[viewerId, { _id: viewerId, id: viewerId }]]);
  for (const item of posts) users.set(String(item.author._id), item.author);
  User.findById = async (userId) => users.get(String(userId)) || null;
  Post.find = (filter) => query(posts.filter((item) => matches(item, filter)));
  Post.findById = (postId) => {
    const item = posts.find((candidate) => String(candidate._id) === String(postId));
    const result = Promise.resolve(item ? { _id: item._id, createdAt: item.createdAt } : null);
    result.select = () => result;
    return result;
  };
  Follow.find = () => query(follows.map((following) => ({ following })));
  Follow.exists = async ({ follower, following }) => String(follower) === viewerId && follows.some((idValue) => String(idValue) === String(following));
  FollowRequest.find = () => query(pending.map((following) => ({ following })));
  Block.exists = async ({ $or }) => $or.some((pair) => blocked.some(([blocker, blockedId]) => String(pair.blocker) === String(blocker) && String(pair.blocked) === String(blockedId)));
  SavedPost.find = () => query([]);

  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(() => server.close());
  t.after(() => {
    User.findById = originals.userFindById; Post.find = originals.postFind; Post.findById = originals.postFindById;
    Follow.find = originals.followFind; Follow.exists = originals.followExists; FollowRequest.find = originals.followRequestFind; Block.exists = originals.blockExists; SavedPost.find = originals.savedFind;
  });
  const token = jwt.sign({ sub: viewerId }, process.env.JWT_SECRET);
  return (path) => fetch(`http://127.0.0.1:${server.address().port}${path}`, { headers: { Cookie: `chattr_session=${token}` } });
}

test('Home API includes followed posts and unfollowed public posts, but excludes private, follower-only, and blocked content without duplicates', async (t) => {
  const followedAuthor = person(2);
  const ananya = person(3, { username: 'ananya' });
  const privateAuthor = person(4, { isPrivate: true });
  const followersOnlyAuthor = person(5);
  const blockedAuthor = person(6);
  const items = [
    post(10, followedAuthor, { visibility: 'followers', date: 10 }),
    post(11, ananya, { visibility: 'public', date: 11 }),
    post(12, privateAuthor, { visibility: 'public', date: 12 }),
    post(13, followersOnlyAuthor, { visibility: 'followers', date: 13 }),
    post(14, blockedAuthor, { visibility: 'public', date: 14 }),
  ];
  const request = await withFeed(t, { posts: items, follows: [followedAuthor._id], pending: [privateAuthor._id], blocked: [[viewerId, blockedAuthor._id]] });
  const response = await request('/api/posts?feed=following');
  assert.equal(response.status, 200);
  const { posts: result } = await response.json();
  assert.deepEqual(result.map((item) => item._id), [items[0]._id, items[1]._id]);
  assert.equal(result[1].author.username, 'ananya');
  assert.equal(result[0].author.isFollowing, true);
  assert.equal(result[0].author.hasPendingFollowRequest, false);
  assert.equal(result[1].author.isFollowing, false);
  assert.equal(result[1].author.hasPendingFollowRequest, false);
  assert.equal(new Set(result.map((item) => item._id)).size, result.length);
});

test('Home cursor pagination keeps followed posts first, then continues into public posts without duplicates', async (t) => {
  const followedAuthor = person(7);
  const publicAuthor = person(8);
  const items = [
    post(21, followedAuthor, { date: 21 }), post(20, followedAuthor, { date: 20 }),
    post(19, publicAuthor, { date: 19 }), post(18, publicAuthor, { date: 18 }),
  ];
  const request = await withFeed(t, { posts: items, follows: [followedAuthor._id] });
  const first = await request('/api/posts?feed=following&limit=1');
  const firstPage = await first.json();
  assert.deepEqual(firstPage.posts.map((item) => item._id), [items[0]._id]);
  assert.equal(firstPage.nextCursor, `f.${items[0]._id}`);

  const second = await request(`/api/posts?feed=following&limit=1&cursor=${firstPage.nextCursor}`);
  const secondPage = await second.json();
  assert.deepEqual(secondPage.posts.map((item) => item._id), [items[1]._id]);
  assert.equal(secondPage.nextCursor, 'p');

  const third = await request(`/api/posts?feed=following&limit=1&cursor=${secondPage.nextCursor}`);
  const thirdPage = await third.json();
  assert.deepEqual(thirdPage.posts.map((item) => item._id), [items[2]._id]);
  assert.equal(thirdPage.nextCursor, `p.${items[2]._id}`);
  assert.equal(new Set([...firstPage.posts, ...secondPage.posts, ...thirdPage.posts].map((item) => item._id)).size, 3);
});
