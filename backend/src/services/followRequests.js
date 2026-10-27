export async function followProfile({ requesterId, target, Follow, FollowRequest }) {
  const relationship = { follower: requesterId, following: target._id };
  const existingFollow = await Follow.exists(relationship);
  if (existingFollow) return { following: true, requestPending: false };

  if (!target.isPrivate) {
    const result = await Follow.updateOne(relationship, { $setOnInsert: relationship }, { upsert: true });
    return { following: true, requestPending: false, created: Boolean(result.upsertedCount) };
  }

  try {
    const result = await FollowRequest.updateOne(relationship, { $setOnInsert: relationship }, { upsert: true });
    return { following: false, requestPending: true, created: Boolean(result.upsertedCount) };
  } catch (error) {
    if (error.code !== 11000) throw error;
    return { following: false, requestPending: true, created: false };
  }
}

export async function decideFollowRequest({ request, ownerId, decision, Follow, FollowRequest }) {
  if (!request || request.following.toString() !== ownerId.toString()) return { status: 'not-found' };
  if (request.follower.toString() === ownerId.toString()) return { status: 'self-request' };

  if (decision === 'approve') {
    const relationship = { follower: request.follower, following: ownerId };
    await Follow.updateOne(relationship, { $setOnInsert: relationship }, { upsert: true });
  }
  await FollowRequest.deleteOne({ _id: request._id, following: ownerId });
  return { status: decision === 'approve' ? 'approved' : 'rejected' };
}

export async function hasAcceptedFollow(viewerId, ownerId, Follow) {
  return Boolean(await Follow.exists({ follower: viewerId, following: ownerId }));
}
