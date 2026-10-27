// Composer drafts live only in the browser. They are keyed per account so a
// shared device never shows one person's unfinished post to another.
const PREFIX = 'chattr-draft:';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function storageFor(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage || null; } catch { return null; }
}

export function draftKey(userId) { return `${PREFIX}${userId}`; }

export function loadDraft(userId, storage) {
  const store = storageFor(storage);
  if (!store || !userId) return null;
  try {
    const raw = store.getItem(draftKey(userId));
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft || typeof draft.text !== 'string' || !draft.text.trim()) return null;
    if (Date.now() - (draft.savedAt || 0) > MAX_AGE_MS) { store.removeItem(draftKey(userId)); return null; }
    return { text: draft.text, visibility: draft.visibility === 'followers' ? 'followers' : 'public', savedAt: draft.savedAt };
  } catch { return null; }
}

export function saveDraft(userId, { text, visibility }, storage) {
  const store = storageFor(storage);
  if (!store || !userId) return;
  try {
    if (!text || !text.trim()) { store.removeItem(draftKey(userId)); return; }
    store.setItem(draftKey(userId), JSON.stringify({ text, visibility, savedAt: Date.now() }));
  } catch { /* storage may be full or blocked; the draft simply is not kept */ }
}

export function clearDraft(userId, storage) {
  const store = storageFor(storage);
  if (!store || !userId) return;
  try { store.removeItem(draftKey(userId)); } catch { /* ignore */ }
}
