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
 * Compact date for lists: time for today, "Mar 4" this year, "Mar 4, 2024" otherwise.
 */
export function formatListDate(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  // en-US to match Angular's DatePipe (the app's locale) used on detail pages.
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  });
}
