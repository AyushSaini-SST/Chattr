import { Block } from '../models/Block.js';
import { Follow } from '../models/Follow.js';

export async function isBlockedEitherWay(first, second) {
  return Boolean(await Block.exists({ $or: [{ blocker: first, blocked: second }, { blocker: second, blocked: first }] }));
}

export async function isMutualFollow(first, second) {
  const [forward, reverse] = await Promise.all([
    Follow.exists({ follower: first, following: second }),
    Follow.exists({ follower: second, following: first }),
  ]);
  return Boolean(forward && reverse);
}

export async function canSendMessage(sender, recipient) {
  if (await isBlockedEitherWay(sender._id, recipient._id)) return false;
  if (await isMutualFollow(sender._id, recipient._id)) return true;
  return recipient.messagePreference === 'everyone';
}

export async function canSendInConversation(sender, recipient, conversation) {
  if (await isBlockedEitherWay(sender._id, recipient._id)) return false;
  if (await isMutualFollow(sender._id, recipient._id)) return true;
  if (recipient.messagePreference === 'everyone') return true;
  return recipient.messagePreference === 'followers' && conversation.acceptedVia === 'request';
}
