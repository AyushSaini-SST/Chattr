export const FOLLOW_RELATIONSHIPS_CHANGED = 'chattr:follow-relationships-changed';

export function publishFollowRelationshipChange(detail = {}, target = window) {
  target.dispatchEvent(new CustomEvent(FOLLOW_RELATIONSHIPS_CHANGED, { detail }));
}

export function subscribeToFollowRelationshipChanges(onChange, target = window) {
  target.addEventListener(FOLLOW_RELATIONSHIPS_CHANGED, onChange);
  return () => target.removeEventListener(FOLLOW_RELATIONSHIPS_CHANGED, onChange);
}
