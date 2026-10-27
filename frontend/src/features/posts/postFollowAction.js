export function getPostFollowAction(author, currentUserId) {
  if (!author?.username || String(author._id) === String(currentUserId) || author.isFollowing) return null;
  if (author.hasPendingFollowRequest) return { label: 'Requested', action: 'cancel' };
  return { label: 'Follow', action: 'follow' };
}
