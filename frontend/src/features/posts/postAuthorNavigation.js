export function shouldLinkPostAuthor(mode) {
  return mode === 'following' || mode === 'explore';
}

export function postAuthorProfilePath(author) {
  const username = typeof author?.username === 'string' ? author.username.trim() : '';
  return username ? `/u/${encodeURIComponent(username)}` : null;
}
