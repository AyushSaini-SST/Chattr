import test from 'node:test';
import assert from 'node:assert/strict';
import { Block } from '../src/models/Block.js';
import { Follow } from '../src/models/Follow.js';
import { canView } from '../src/routes/postRoutes.js';

const originalBlockExists = Block.exists;
const originalFollowExists = Follow.exists;

test('Explore can show a public post from someone the viewer does not follow', async () => {
  Block.exists = async () => false;
  Follow.exists = async () => false;
  try {
    assert.equal(await canView({ author: { _id: 'author', isPrivate: false }, visibility: 'public' }, 'viewer'), true);
  } finally {
    Block.exists = originalBlockExists;
    Follow.exists = originalFollowExists;
  }
});

test('private and followers-only posts require an accepted follow', async () => {
  Block.exists = async () => false;
  Follow.exists = async () => false;
  try {
    assert.equal(await canView({ author: { _id: 'author', isPrivate: true }, visibility: 'public' }, 'viewer'), false);
    assert.equal(await canView({ author: { _id: 'author', isPrivate: false }, visibility: 'followers' }, 'viewer'), false);
    Follow.exists = async () => true;
    assert.equal(await canView({ author: { _id: 'author', isPrivate: true }, visibility: 'public' }, 'viewer'), true);
    assert.equal(await canView({ author: { _id: 'author', isPrivate: false }, visibility: 'followers' }, 'viewer'), true);
  } finally {
    Block.exists = originalBlockExists;
    Follow.exists = originalFollowExists;
  }
});

test('posts from either side of a block are not visible to search', async () => {
  Block.exists = async () => true;
  Follow.exists = async () => false;
  try {
    assert.equal(await canView({ author: { _id: 'author', isPrivate: false }, visibility: 'public' }, 'viewer'), false);
  } finally {
    Block.exists = originalBlockExists;
    Follow.exists = originalFollowExists;
  }
});
