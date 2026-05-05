import { google } from 'googleapis';
import { env } from '../config/env.js';
export const oauth2Client = new google.auth.OAuth2(env.google.clientId, env.google.clientSecret, env.google.redirectUri);
