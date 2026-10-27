export const REACTION_KINDS = ['heart', 'spark', 'laugh', 'sad'];

// Summarises the reactions array into counts plus the viewer's own reaction,
// so the raw per-user list never leaves the server.
export function reactionSummary(reactions = [], viewerId) {
  const counts = Object.fromEntries(REACTION_KINDS.map((kind) => [kind, 0]));
  let myReaction = null;
  for (const reaction of reactions) {
    if (!(reaction.kind in counts)) continue;
    counts[reaction.kind] += 1;
    if (viewerId && reaction.user?.toString() === viewerId.toString()) myReaction = reaction.kind;
  }
  return { counts, total: Object.values(counts).reduce((sum, value) => sum + value, 0), myReaction };
}

export function postForClient(post, viewerId) {
  const value = post?.toObject ? post.toObject() : post;
  if (!value) return value;
  const { reactions, ...rest } = value;
  const withReactions = { ...rest, reactions: reactionSummary(reactions, viewerId) };
  if (!withReactions.image) return withReactions;
  const { cloudinaryUrl: _cloudinaryUrl, publicId: _publicId, ...metadata } = withReactions.image;
  return { ...withReactions, image: { ...metadata, url: `/api/media/posts/${value._id}/image` } };
}
