export type StageTiming = { id: string; label: string; stage: string; enteredAt: string | null; dueDate: string | null; reason?: string };

export function currentStageEntry(stage: string, events: { stage: string; changed_at: string }[], truncated = false) {
  // Consecutive duplicate events do not restart the same stage; a reopen does.
  if (!events.length || events[0].stage !== stage) return null;
  let entered = events[0].changed_at;
  for (const event of events) {
    if (events.some((candidate) => candidate.changed_at === event.changed_at && candidate.stage !== event.stage)) return null;
    if (event.stage !== stage) return entered;
    entered = event.changed_at;
  }
  return truncated ? null : entered;
}

export function elapsedStageTime(enteredAt: string | null, now = Date.now()) {
  if (!enteredAt) return "Stage entry not recorded";
  const entered = Date.parse(enteredAt);
  if (!Number.isFinite(entered) || !Number.isFinite(now) || entered > now) return "Stage time requires review";
  const minutes = Math.floor((now - entered) / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ${minutes % 60} min` : `${Math.floor(hours / 24)} d ${hours % 24} h`;
}
