/** Timing formatters shared by the log list and the expanded exchange. */

/** Wall-clock start, so a slow row can be lined up against what the app was doing. */
export function formatClock(startedAt: number): string {
  const at = new Date(startedAt);
  const pad = (value: number, size = 2) => String(value).padStart(size, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}.${pad(at.getMilliseconds(), 3)}`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** The thresholds a person actually notices: a third of a second, a second, three. */
export function durationColor(ms: number): string {
  if (ms >= 3000) return 'text-bad';
  if (ms >= 1000) return 'text-warn';
  if (ms >= 300) return 'text-mute';
  return 'text-faint';
}
