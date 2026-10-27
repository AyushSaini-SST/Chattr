export function applyPostLikeState(posts, postId, likeState) {
  return posts.map((post) => post._id === postId ? { ...post, ...likeState } : post);
}

export async function submitPostLikeChange({ post, request, onSuccess }) {
  const { data } = await request({
    method: post.likedByMe ? 'delete' : 'put',
    url: `/api/posts/${post._id}/like`,
  });
  const likeState = { likedByMe: Boolean(data.liked), likeCount: data.likeCount };
  onSuccess?.(post._id, likeState);
  return likeState;
}
