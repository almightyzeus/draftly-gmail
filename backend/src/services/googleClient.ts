import { google } from 'googleapis';
import { env } from '../config/env.js';

/**
 * Create a new OAuth2 client configured with Google credentials.
 * Each client instance should be used for a specific user/account to avoid
 * credential leakage between users in multi-user environments.
 */
export function createOAuth2Client() {
  return new google.auth.OAuth2(
    env.google.clientId,
    env.google.clientSecret,
    env.google.redirectUri
  );
}
