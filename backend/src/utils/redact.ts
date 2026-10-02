/**
 * Query parameters whose values must never reach the request log:
 * OAuth authorization codes and state tokens (credentials), and users' Gmail
 * search queries (private mailbox content).
 */
const SENSITIVE_QUERY_PARAMS = ['code', 'state', 'q'];

/**
 * Replace the values of sensitive query parameters in a request URL.
 * Paths and other parameters are kept so the log stays useful.
 */
export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }

  const params = new URLSearchParams(url.slice(queryStart + 1));
  let redacted = false;
  for (const name of SENSITIVE_QUERY_PARAMS) {
    if (params.has(name)) {
      params.set(name, '[redacted]');
      redacted = true;
    }
  }

  return redacted ? `${url.slice(0, queryStart)}?${params.toString()}` : url;
}
