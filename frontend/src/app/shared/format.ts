/**
 * Display name from a From/To header value: "Alice <alice@x.com>" -> "Alice",
 * a bare address is returned as is.
 */
export function senderName(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const name = value.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return name || value.replace(/[<>]/g, '').trim();
}

/**
 * Compact date for lists: time for today, "Mar 4" this year, "3/4/24" for
 * earlier years (short enough for the narrow date column).
 */
export function formatListDate(value: string | Date | null | undefined, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  // en-US to match Angular's DatePipe (the app's locale) used on detail pages.
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  if (date.getFullYear() !== now.getFullYear()) {
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Full date and time for a list date's tooltip: "Mar 4, 2024, 9:05 AM". */
export function formatFullDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) {
    return '';
  }
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
