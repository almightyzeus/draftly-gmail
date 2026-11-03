/**
 * Messages for the error codes the backend's Gmail OAuth callback appends to
 * the dashboard URL (`/dashboard?gmailError=<code>`). Only known codes are
 * shown verbatim; anything else gets the generic message, so URL text is never
 * displayed to the user.
 */
const GMAIL_CONNECT_ERRORS: Record<string, string> = {
  access_denied: 'Gmail was not connected because access was not granted on the Google screen.',
  missing_code: 'Google did not return an authorization code. Please try connecting Gmail again.',
  state_expired: 'The Gmail connection took too long and expired. Please try connecting again.',
  state_invalid: 'The Gmail connection could not be verified. Please try connecting again.',
  connection_failed: 'Gmail could not be connected. Please try again.',
};

export function gmailConnectErrorMessage(code: string | null | undefined): string | null {
  if (!code) {
    return null;
  }
  return GMAIL_CONNECT_ERRORS[code] ?? GMAIL_CONNECT_ERRORS['connection_failed'];
}
