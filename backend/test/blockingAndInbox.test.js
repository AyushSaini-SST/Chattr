import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'blocking-and-inbox-test-secret';
const [
  { app }, { env }, { User }, { Follow }, { FollowRequest }, { Block },
  { Conversation }, { Message }, { Notification },
] = await Promise.all([
  import('../src/app.js'), import('../src/config/env.js'), import('../src/models/User.js'),
  import('../src/models/Follow.js'), import('../src/models/FollowRequest.js'), import('../src/models/Block.js'),
  import('../src/models/Conversation.js'), import('../src/models/Message.js'), import('../src/models/Notification.js'),
]);

const ids = { alice: '111111111111111111111111', bob: '222222222222222222222222', outsider: '333333333333333333333333' };
const originals = {
  userFindById: User.findById, userFindOne: User.findOne,
  followExists: Follow.exists, followFind: Follow.find, followCount: Follow.countDocuments, followDeleteMany: Follow.deleteMany, followUpdateOne: Follow.updateOne,
  requestFind: FollowRequest.find, requestFindById: FollowRequest.findById, requestExists: FollowRequest.exists, requestDeleteMany: FollowRequest.deleteMany,
  requestUpdateOne: FollowRequest.updateOne,
  blockFind: Block.find, blockExists: Block.exists, blockUpdateOne: Block.updateOne, blockDeleteOne: Block.deleteOne,
  conversationFind: Conversation.find, conversationFindOne: Conversation.findOne, conversationFindById: Conversation.findById,
  conversationCreate: Conversation.create, conversationUpdateMany: Conversation.updateMany,
  messageFind: Message.find, messageFindOne: Message.findOne, messageFindById: Message.findById,
  messageCreate: Message.create, messageCount: Message.countDocuments,
  notificationCreate: Notification.create, notificationFindById: Notification.findById,
  notificationFind: Notification.find, notificationCount: Notification.countDocuments,
};

function account(id, username, displayName) {
  return {
    _id: id, id, username, displayName, avatarUrl: `/api/media/avatars/${id}/image?v=1`,
    isPrivate: false, messagePreference: 'followers',
    toJSON() { return { _id: id, username, displayName, avatarUrl: this.avatarUrl, isPrivate: false }; },
  };
}

function query(initial, populateValue = (value) => value) {
  let value = initial;
  return {
    select() { return this; },
    sort(spec = {}) {
      if (Array.isArray(value)) {
        const [[field, direction = 1]] = Object.entries(spec);
        if (field) value = [...value].sort((left, right) => {
          const a = left[field]?.getTime?.() ?? left[field]?.toString?.() ?? left[field];
          const b = right[field]?.getTime?.() ?? right[field]?.toString?.() ?? right[field];
          return (a > b ? 1 : a < b ? -1 : 0) * direction;
        });
      }
      return this;
    },
    limit(count) { if (Array.isArray(value)) value = value.slice(0, count); return this; },
    populate(path) { value = populateValue(value, path); return this; },
    lean() { return Promise.resolve(value); },
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
  };
}

function matchesPair(block, first, second) {
  return block.blocker === first && block.blocked === second || block.blocker === second && block.blocked === first;
}

async function withHarness(t, { initialBlocks = [], initialFollows = [], initialFollowRequests = [], initialConversations = [], initialMessages = [] } = {}) {
  const users = new Map([[ids.alice, account(ids.alice, 'alice', 'Alice Adams')], [ids.bob, account(ids.bob, 'bob', 'Bob Brown')], [ids.outsider, account(ids.outsider, 'outsider', 'Olivia Other')]]);
  const state = {
    blocks: initialBlocks.map(([blocker, blocked]) => ({ blocker, blocked })),
    follows: initialFollows.map(([follower, following]) => ({ follower, following })),
    followRequests: initialFollowRequests.map(([follower, following]) => ({ _id: `${follower}-${following}`, follower, following })),
    conversations: [...initialConversations],
    messages: [...initialMessages],
    notifications: [],
    nextId: 10,
  };
  const newId = () => (state.nextId++).toString(16).padStart(24, '0');
  const safeUser = (id) => {
    const value = users.get(id?.toString?.() || id);
    return value ? { _id: value._id, username: value.username, displayName: value.displayName, avatarUrl: value.avatarUrl } : null;
  };

  User.findById = (id) => query(users.get(id?.toString?.() || id) || null);
  User.findOne = (filter) => query([...users.values()].find((person) => person.username === filter.username) || null);

  Follow.exists = async ({ follower, following }) => state.follows.some((row) => row.follower === follower.toString() && row.following === following.toString());
  Follow.find = () => query([]);
  Follow.countDocuments = async () => state.follows.length;
  Follow.updateOne = async (filter, _update, options = {}) => {
    const exists = state.follows.some((row) => row.follower === filter.follower.toString() && row.following === filter.following.toString());
    if (!exists && options.upsert) state.follows.push({ follower: filter.follower.toString(), following: filter.following.toString() });
    return { upsertedCount: exists ? 0 : 1 };
  };
  Follow.deleteMany = async (filter) => {
    const before = state.follows.length;
    state.follows = state.follows.filter((row) => !filter.$or.some((pair) => row.follower === pair.follower.toString() && row.following === pair.following.toString()));
    return { deletedCount: before - state.follows.length };
  };
  FollowRequest.find = (filter = {}) => query(state.followRequests.filter((row) => !filter.following || row.following === filter.following.toString()).map((row) => ({ ...row, follower: safeUser(row.follower) })));
  FollowRequest.findById = async (id) => state.followRequests.find((row) => row._id === id) || null;
  FollowRequest.exists = async ({ follower, following }) => state.followRequests.some((row) => row.follower === follower.toString() && row.following === following.toString());
  FollowRequest.updateOne = async (filter, _update, options = {}) => {
    const exists = state.followRequests.some((row) => row.follower === filter.follower.toString() && row.following === filter.following.toString());
    if (!exists && options.upsert) state.followRequests.push({ _id: newId(), follower: filter.follower.toString(), following: filter.following.toString() });
    return { upsertedCount: exists ? 0 : 1 };
  };
  FollowRequest.deleteMany = async (filter) => {
    const before = state.followRequests.length;
    state.followRequests = state.followRequests.filter((row) => !filter.$or.some((pair) => row.follower === pair.follower.toString() && row.following === pair.following.toString()));
    return { deletedCount: before - state.followRequests.length };
  };

  Block.find = (filter = {}) => {
    let rows = state.blocks;
    if (filter.$or) rows = rows.filter((row) => filter.$or.some((condition) => {
      const blockerMatches = condition.blocker?.$in ? condition.blocker.$in.map(String).includes(row.blocker) : condition.blocker === undefined || condition.blocker.toString() === row.blocker;
      const blockedMatches = condition.blocked?.$in ? condition.blocked.$in.map(String).includes(row.blocked) : condition.blocked === undefined || condition.blocked.toString() === row.blocked;
      return blockerMatches && blockedMatches;
    }));
    return query(rows.map((row) => ({ ...row })), (values, path) => path === 'blocked' ? values.map((row) => ({ ...row, blocked: safeUser(row.blocked) })) : values);
  };
  Block.exists = async (filter) => (filter.$or || [filter]).some((condition) => {
    const blocker = condition.blocker?.toString?.(); const blocked = condition.blocked?.toString?.();
    return state.blocks.some((row) => (!blocker || row.blocker === blocker) && (!blocked || row.blocked === blocked));
  });
  Block.updateOne = async (filter) => {
    if (!state.blocks.some((row) => row.blocker === filter.blocker.toString() && row.blocked === filter.blocked.toString())) state.blocks.push({ blocker: filter.blocker.toString(), blocked: filter.blocked.toString() });
  };
  Block.deleteOne = async (filter) => { state.blocks = state.blocks.filter((row) => !(row.blocker === filter.blocker.toString() && row.blocked === filter.blocked.toString())); };

  const populateConversation = (value, path) => {
    if (!Array.isArray(value)) return value;
    if (path === 'participantA' || path === 'participantB' || path === 'requestedBy' || path === 'requestTo') {
      return value.map((conversation) => ({ ...conversation, [path]: safeUser(conversation[path]) }));
    }
    return value;
  };
  Conversation.find = (filter = {}) => {
    let rows = state.conversations;
    if (filter.requestTo) rows = rows.filter((item) => item.requestTo === filter.requestTo.toString() && item.status === filter.status);
    else if (filter.$or?.[0]?.status === 'accepted') {
      const participantFilter = filter.$or[0].$or;
      const viewerId = (participantFilter[0].participantA || participantFilter[1].participantB).toString();
      rows = rows.filter((item) => item.status === 'accepted' && [item.participantA, item.participantB].includes(viewerId) ||
        item.status === 'pending' && item.requestedBy === viewerId);
    }
    else if (filter.$or?.[0]?.participantA) rows = rows.filter((item) => filter.$or.some((pair) => item.participantA === pair.participantA.toString() && item.participantB === pair.participantB.toString()));
    return query(rows, populateConversation);
  };
  Conversation.findOne = async (filter) => state.conversations.find((item) => item.participantA === filter.participantA.toString() && item.participantB === filter.participantB.toString()) || null;
  Conversation.findById = async (id) => state.conversations.find((item) => item._id === id.toString()) || null;
  Conversation.create = async (data) => {
    if (state.conversations.some((item) => item.participantA === data.participantA.toString() && item.participantB === data.participantB.toString())) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const conversation = {
      ...data, _id: newId(), id: '', lastMessage: '', lastMessageAt: new Date(),
      async save() {},
    };
    conversation.id = conversation._id;
    state.conversations.push(conversation);
    return conversation;
  };
  Conversation.updateMany = async (filter, update) => {
    let modifiedCount = 0;
    for (const conversation of state.conversations) if (filter._id.$in.includes(conversation._id) && conversation.status === filter.status) {
      Object.assign(conversation, update.$set); modifiedCount += 1;
    }
    return { modifiedCount };
  };

  Message.findOne = (filter) => query(state.messages.filter((message) => message.conversation === filter.conversation.toString()).sort((a, b) => a.createdAt - b.createdAt)[0] || null);
  Message.find = (filter) => query(state.messages.filter((message) => message.conversation === filter.conversation.toString() && !message.deletedFor.includes(ids.alice)), (value, path) => path === 'sender' && Array.isArray(value) ? value.map((message) => ({ ...message, sender: safeUser(message.sender) })) : value);
  Message.findById = (id) => query(state.messages.find((message) => message._id === id.toString()) || null, (value, path) => path === 'sender' && value ? { ...value, sender: safeUser(value.sender) } : value);
  Message.create = async (data) => {
    const message = { ...data, _id: newId(), id: '', createdAt: new Date(), deletedFor: [], deletedForEveryone: false };
    message.id = message._id; state.messages.push(message); return message;
  };
  Message.countDocuments = async (filter) => state.messages.filter((message) => message.conversation === filter.conversation.toString() && message.sender !== filter.sender.$ne && !message.readBy.includes(filter.readBy.$ne)).length;

  Notification.create = async (data) => { const notification = { ...data, _id: newId() }; state.notifications.push(notification); return notification; };
  Notification.find = (filter) => query(state.notifications.filter((item) => item.recipient === filter.recipient.toString() && !filter.actor.$nin.map(String).includes(item.actor.toString())), (value, path) => path === 'actor' && Array.isArray(value) ? value.map((item) => ({ ...item, actor: safeUser(item.actor) })) : value);
  Notification.countDocuments = async (filter) => state.notifications.filter((item) => item.recipient === filter.recipient.toString() && item.readAt == null && !filter.actor.$nin.map(String).includes(item.actor.toString())).length;
  Notification.findById = (id) => query(state.notifications.find((item) => item._id === id.toString()) || null, (value, path) => path === 'actor' && value ? { ...value, actor: safeUser(value.actor) } : value);

  const server = await new Promise((resolve) => { const instance = app.listen(0, () => resolve(instance)); });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    Object.assign(User, { findById: originals.userFindById, findOne: originals.userFindOne });
    Object.assign(Follow, { exists: originals.followExists, find: originals.followFind, countDocuments: originals.followCount, deleteMany: originals.followDeleteMany, updateOne: originals.followUpdateOne });
    Object.assign(FollowRequest, { find: originals.requestFind, findById: originals.requestFindById, exists: originals.requestExists, deleteMany: originals.requestDeleteMany, updateOne: originals.requestUpdateOne });
    Object.assign(Block, { find: originals.blockFind, exists: originals.blockExists, updateOne: originals.blockUpdateOne, deleteOne: originals.blockDeleteOne });
    Object.assign(Conversation, { find: originals.conversationFind, findOne: originals.conversationFindOne, findById: originals.conversationFindById, create: originals.conversationCreate, updateMany: originals.conversationUpdateMany });
    Object.assign(Message, { find: originals.messageFind, findOne: originals.messageFindOne, findById: originals.messageFindById, create: originals.messageCreate, countDocuments: originals.messageCount });
    Object.assign(Notification, { create: originals.notificationCreate, findById: originals.notificationFindById, find: originals.notificationFind, countDocuments: originals.notificationCount });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(userId, path, { method = 'GET', body } = {}) {
    const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET);
    return fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: `chattr_session=${token}`,
        ...(method !== 'GET' ? { Origin: env.CLIENT_URL } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }
  const anonymous = (path, method = 'GET') => fetch(`${base}${path}`, {
    method,
    ...(method !== 'GET' ? { headers: { Origin: env.CLIENT_URL } } : {}),
  });
  return { request, anonymous, state };
}

test('first outgoing request is persisted in the sender inbox while the receiver still gets a request', async (t) => {
  const { request, state } = await withHarness(t);
  const sent = await request(ids.alice, '/api/messages/bob', { method: 'POST', body: { text: 'Hello Bob' } });
  assert.equal(sent.status, 201);
  const created = await sent.json();
  assert.equal(created.status, 'pending');
  assert.equal(state.conversations.length, 1);

  const senderInbox = await (await request(ids.alice, '/api/messages')).json();
  assert.equal(senderInbox.conversations.length, 1);
  assert.equal(senderInbox.conversations[0].participant.username, 'bob');
  assert.equal(senderInbox.conversations[0].participant.avatarUrl, `/api/media/avatars/${ids.bob}/image?v=1`);
  assert.equal(senderInbox.conversations[0].lastMessage, 'Hello Bob');
  assert.ok(senderInbox.conversations[0].lastMessageAt);
  assert.equal(senderInbox.conversations[0].status, 'pending');
  assert.equal(senderInbox.conversations[0].outgoingRequestPending, true);

  const afterReload = await (await request(ids.alice, '/api/messages')).json();
  assert.equal(afterReload.conversations[0].lastMessage, 'Hello Bob');
  const senderHistory = await request(ids.alice, `/api/messages/${created.conversationId}/messages`);
  assert.equal(senderHistory.status, 200);
  assert.equal((await senderHistory.json()).messages[0].text, 'Hello Bob');
  assert.equal((await (await request(ids.bob, '/api/messages')).json()).conversations.length, 0);
  const receiverRequests = await (await request(ids.bob, '/api/messages/requests')).json();
  assert.equal(receiverRequests.requests.length, 1);
  assert.equal(receiverRequests.requests[0].sender.username, 'alice');
  assert.equal(receiverRequests.requests[0].preview.text, 'Hello Bob');

  const duplicateRequest = await request(ids.alice, '/api/messages/bob', { method: 'POST', body: { text: 'A duplicate' } });
  assert.equal(duplicateRequest.status, 409);
  assert.equal(state.conversations.length, 1);
  assert.equal(state.messages.length, 1);

  const accepted = await request(ids.bob, `/api/messages/requests/${created.conversationId}`, { method: 'PATCH', body: { decision: 'accept' } });
  assert.equal(accepted.status, 200);
  const followUp = await request(ids.alice, '/api/messages/bob', { method: 'POST', body: { text: 'Thanks for replying' } });
  assert.equal(followUp.status, 201);
  assert.equal(state.conversations.length, 1);
  assert.equal(state.messages.length, 2);
  const updatedInbox = await (await request(ids.alice, '/api/messages')).json();
  assert.equal(updatedInbox.conversations[0].status, 'accepted');
  assert.equal(updatedInbox.conversations[0].lastMessage, 'Thanks for replying');
});

test('blocking is authorized, removes follows and pending requests, rejects pending chats, and prevents interaction', async (t) => {
  const pendingConversation = {
    _id: 'aaaaaaaaaaaaaaaaaaaaaaaa', id: 'aaaaaaaaaaaaaaaaaaaaaaaa', participantA: ids.alice, participantB: ids.bob,
    requestedBy: ids.alice, requestTo: ids.bob, status: 'pending', acceptedVia: '', lastMessage: 'Waiting', lastMessageAt: new Date(),
    async save() {},
  };
  const { request, anonymous, state } = await withHarness(t, {
    initialFollows: [[ids.alice, ids.bob], [ids.bob, ids.alice]],
    initialFollowRequests: [[ids.alice, ids.bob], [ids.bob, ids.alice]],
    initialConversations: [pendingConversation],
  });
  const unauthorized = await anonymous('/api/users/bob/block', 'POST');
  assert.equal(unauthorized.status, 401);
  assert.equal((await request(ids.alice, '/api/users/alice/block', { method: 'POST' })).status, 400);

  const blocked = await request(ids.alice, '/api/users/bob/block', { method: 'POST' });
  assert.equal(blocked.status, 200);
  assert.deepEqual(state.blocks, [{ blocker: ids.alice, blocked: ids.bob }]);
  assert.equal(state.follows.length, 0);
  assert.equal(state.followRequests.length, 0);
  assert.equal(pendingConversation.status, 'rejected');
  assert.equal((await (await request(ids.alice, '/api/messages')).json()).conversations.length, 0);
  assert.equal((await (await request(ids.bob, '/api/messages/requests')).json()).requests.length, 0);
  assert.equal((await request(ids.alice, '/api/messages/bob', { method: 'POST', body: { text: 'Can you see this?' } })).status, 403);
  assert.equal((await request(ids.alice, '/api/users/bob/follow', { method: 'POST' })).status, 403);
  const staleFollowRequestId = 'cccccccccccccccccccccccc';
  state.followRequests.push({ _id: staleFollowRequestId, follower: ids.bob, following: ids.alice });
  const staleApproval = await request(ids.alice, `/api/users/follow-requests/${staleFollowRequestId}`, { method: 'PATCH', body: { decision: 'approve' } });
  assert.equal(staleApproval.status, 403);
  assert.equal(state.follows.length, 0);
  const profile = await (await request(ids.alice, '/api/users/bob')).json();
  assert.equal(profile.user.isBlockedByMe, true);
  assert.equal(profile.user.canViewDetails, false);
  assert.equal('bio' in profile.user, false);
  assert.equal((await request(ids.bob, '/api/users/alice')).status, 404);
  const blockedAccounts = await (await request(ids.alice, '/api/users/blocked')).json();
  assert.deepEqual(blockedAccounts.users.map((person) => person.username), ['bob']);

  await request(ids.bob, '/api/users/alice/block', { method: 'DELETE' });
  assert.deepEqual(state.blocks, [{ blocker: ids.alice, blocked: ids.bob }]);
  const unblocked = await request(ids.alice, '/api/users/bob/block', { method: 'DELETE' });
  assert.equal(unblocked.status, 200);
  assert.equal(state.blocks.length, 0);
  assert.equal((await (await request(ids.alice, '/api/users/bob')).json()).user.isBlockedByMe, false);
  assert.equal(pendingConversation.status, 'rejected');
});

test('a block in either direction hides accepted conversations and rejects history and read access', async (t) => {
  const conversation = {
    _id: 'bbbbbbbbbbbbbbbbbbbbbbbb', id: 'bbbbbbbbbbbbbbbbbbbbbbbb', participantA: ids.alice, participantB: ids.bob,
    requestedBy: ids.alice, requestTo: ids.bob, status: 'accepted', acceptedVia: 'preference', lastMessage: 'Private text', lastMessageAt: new Date(),
    async save() {},
  };
  const { request } = await withHarness(t, { initialBlocks: [[ids.bob, ids.alice]], initialConversations: [conversation] });
  assert.equal((await (await request(ids.alice, '/api/messages')).json()).conversations.length, 0);
  assert.equal((await request(ids.alice, `/api/messages/${conversation._id}/messages`)).status, 404);
  assert.equal((await request(ids.alice, `/api/messages/${conversation._id}/read`, { method: 'POST' })).status, 404);
  assert.equal((await request(ids.alice, '/api/messages/bob', { method: 'POST', body: { text: 'Blocked send' } })).status, 403);
});

test('notifications from either side of a blocked relationship are omitted', async (t) => {
  const { request, state } = await withHarness(t, { initialBlocks: [[ids.bob, ids.alice]] });
  state.notifications.push(
    { _id: 'dddddddddddddddddddddddd', recipient: ids.alice, actor: ids.bob, type: 'follow', readAt: null },
    { _id: 'eeeeeeeeeeeeeeeeeeeeeeee', recipient: ids.alice, actor: ids.outsider, type: 'comment', readAt: null },
  );
  const response = await request(ids.alice, '/api/notifications');
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.notifications.map((notification) => notification.actor.username), ['outsider']);
  assert.equal(data.unreadCount, 1);
});
