// Splits post text into plain segments and hashtag segments so the UI can
// render tags as links without using dangerouslySetInnerHTML.
const TAG_PATTERN = /(^|[^\w#])#([\p{L}\p{N}_]{1,40})/gu;

export function splitHashtags(text = '') {
  const value = String(text);
  const segments = [];
  let last = 0;
  for (const match of value.matchAll(TAG_PATTERN)) {
    const start = match.index + match[1].length;
    if (start > last) segments.push({ type: 'text', value: value.slice(last, start) });
    segments.push({ type: 'tag', value: match[2], tag: match[2].toLowerCase() });
    last = start + match[2].length + 1;
  }
  if (last < value.length) segments.push({ type: 'text', value: value.slice(last) });
  return segments;
}

export function normalizeTag(raw = '') {
  return String(raw).trim().replace(/^#/, '').toLowerCase();
}
