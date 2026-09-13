export function inspectionWindow(previous, now = Date.now() / 1000) {
  const requestedStart = previous ? Date.parse(previous) / 1000 : now - 86400;
  if (!Number.isFinite(requestedStart) || requestedStart > now)
    throw Error("Invalid inspection cursor");
  const start = Math.max(requestedStart, now - 7 * 86400);
  const day = Math.floor(now / 86400) * 86400,
    due = day + 9 * 3600 <= now ? day + 9 * 3600 : day - 86400 + 9 * 3600;
  return {
    requestedStart,
    start,
    end: now,
    truncated: start !== requestedStart,
    scheduledFor: new Date(due * 1000).toISOString(),
    scheduleDelaySeconds: Math.max(0, now - due),
    missedWindows: Math.max(0, Math.floor((now - requestedStart) / 86400) - 1),
  };
}
