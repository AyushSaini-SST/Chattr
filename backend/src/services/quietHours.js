// Quiet hours are stored as local wall-clock times ("HH:MM") plus the
// user's UTC offset in minutes, so the server can evaluate them without a
// timezone database. The window may cross midnight (22:00 → 07:00).
function minutesOf(value) {
  const [hours, minutes] = String(value).split(':').map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  return hours * 60 + minutes;
}

export function isWithinQuietHours(quietHours, now = new Date()) {
  if (!quietHours?.enabled) return false;
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  if (start === null || end === null || start === end) return false;
  const offset = Number.isFinite(quietHours.timezoneOffset) ? quietHours.timezoneOffset : 0;
  const local = new Date(now.getTime() + offset * 60 * 1000);
  const current = local.getUTCHours() * 60 + local.getUTCMinutes();
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}
