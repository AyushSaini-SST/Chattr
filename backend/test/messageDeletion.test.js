import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { Message } from '../src/models/Message.js';
import { deleteMessageForEveryone, DELETED_MESSAGE_TEXT } from '../src/services/messageDeletion.js';

const ids = {
  message: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  conversation: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  sender: 'cccccccccccccccccccccccc',
  recipient: 'dddddddddddddddddddddddd',
  outsider: 'eeeeeeeeeeeeeeeeeeeeeeee',
  otherMessage: 'ffffffffffffffffffffffff',
};

function setup({ latestMessageId = ids.message } = {}) {
  const saved = { message: 0, conversation: 0 };
  const message = {
    _id: ids.message, conversation: ids.conversation, sender: ids.sender,
    text: 'Original message', deletedForEveryone: false,
    async save() { saved.message += 1; },
  };
  const conversation = {
    _id: ids.conversation, participantA: ids.sender, participantB: ids.recipient,
    lastMessage: 'Original message', lastMessageAt: new Date(),
    async save() { saved.conversation += 1; },
  };
  const MessageModel = {
    async findById(id) { return id === ids.message ? message : null; },
    findOne() {
      return {
        sort() { return this; },
        async select() { return latestMessageId ? { _id: latestMessageId } : null; },
      };
    },
  };
  const ConversationModel = {
    async findById(id) { return id === ids.conversation ? conversation : null; },
  };
  return { message, conversation, saved, MessageModel, ConversationModel };
}

test('rejects invalid and missing message IDs without changing data', async () => {
  const context = setup();
  assert.deepEqual(await deleteMessageForEveryone({ messageId: 'bad-id', requesterId: ids.sender, ...context }), { status: 'invalid-id' });
  assert.deepEqual(await deleteMessageForEveryone({ messageId: ids.otherMessage, requesterId: ids.sender, ...context }), { status: 'not-found' });
  assert.equal(context.saved.message, 0);
});

test('does not allow a nonparticipant to inspect or delete a conversation message', async () => {
  const context = setup();
  const result = await deleteMessageForEveryone({ messageId: ids.message, requesterId: ids.outsider, ...context });
  assert.deepEqual(result, { status: 'not-found' });
  assert.equal(context.saved.message, 0);
  assert.equal(context.saved.conversation, 0);
});

test('does not delete a message whose conversation record is missing', async () => {
  const context = setup();
  context.ConversationModel.findById = async () => null;
  const result = await deleteMessageForEveryone({ messageId: ids.message, requesterId: ids.sender, ...context });
  assert.deepEqual(result, { status: 'not-found' });
  assert.equal(context.saved.message, 0);
});

test('allows only the message sender to delete for everyone and persists a tombstone', async () => {
  const context = setup();
  const denied = await deleteMessageForEveryone({ messageId: ids.message, requesterId: ids.recipient, ...context });
  assert.deepEqual(denied, { status: 'forbidden' });
  assert.equal(context.saved.message, 0);

  const result = await deleteMessageForEveryone({ messageId: ids.message, requesterId: ids.sender, ...context });
  assert.equal(result.status, 'deleted');
  assert.equal(result.previewUpdated, true);
  assert.equal(context.message.deletedForEveryone, true);
  assert.equal(context.message.text, DELETED_MESSAGE_TEXT);
  assert.equal(context.saved.message, 1);
  assert.equal(context.conversation.lastMessage, DELETED_MESSAGE_TEXT);
  assert.equal(context.saved.conversation, 1);
});

test('deletion succeeds under the real Message schema while ordinary messages still require text', async () => {
  const message = new Message({
    _id: new mongoose.Types.ObjectId(ids.message),
    conversation: new mongoose.Types.ObjectId(ids.conversation),
    sender: new mongoose.Types.ObjectId(ids.sender),
    text: 'Original message',
  });
  const persistWithSchemaValidation = async function () {
    const validationError = this.validateSync();
    if (validationError) throw validationError;
  };
  message.save = persistWithSchemaValidation;
  const conversation = {
    _id: new mongoose.Types.ObjectId(ids.conversation),
    participantA: new mongoose.Types.ObjectId(ids.sender),
    participantB: new mongoose.Types.ObjectId(ids.recipient),
    lastMessage: 'Original message',
    async save() {},
  };
  const MessageModel = {
    async findById() { return message; },
    findOne() { return { sort() { return this; }, async select() { return { _id: message._id }; } }; },
  };
  const ConversationModel = { async findById() { return conversation; } };

  const result = await deleteMessageForEveryone({
    messageId: ids.message, requesterId: ids.sender, MessageModel, ConversationModel,
  });
  assert.equal(result.status, 'deleted');
  assert.equal(message.deletedForEveryone, true);
  assert.equal(message.text, DELETED_MESSAGE_TEXT);
  assert.equal(message.validateSync(), undefined);

  const missingText = new Message({
    conversation: conversation._id,
    sender: conversation.participantA,
  });
  assert.ok(missingText.validateSync()?.errors.text, 'ordinary message validation must continue requiring text');
  const emptyText = new Message({
    conversation: conversation._id,
    sender: conversation.participantA,
    text: '',
  });
  assert.ok(emptyText.validateSync()?.errors.text, 'empty text must remain invalid');
});

test('deleting an older message does not replace the latest conversation preview', async () => {
  const context = setup({ latestMessageId: ids.otherMessage });
  const result = await deleteMessageForEveryone({ messageId: ids.message, requesterId: ids.sender, ...context });
  assert.equal(result.status, 'deleted');
  assert.equal(result.previewUpdated, false);
  assert.equal(context.message.deletedForEveryone, true);
  assert.equal(context.conversation.lastMessage, 'Original message');
  assert.equal(context.saved.conversation, 0);
});
