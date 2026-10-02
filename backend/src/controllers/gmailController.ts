import { Response, NextFunction } from 'express';
import { GmailOAuthService } from '../services/gmailOAuthService.js';
import { GmailService } from '../services/gmailService.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Redirect user to Google OAuth consent screen
 */
export const connectOAuth = (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const userEmail = req.email;
    const url = GmailOAuthService.generateAuthUrl(userId, userEmail);
    res.redirect(url);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Handle OAuth callback from Google
 * Verifies the state parameter to ensure secure user identification
 */
export const handleOAuthCallback = async (req: any, res: Response, next: NextFunction) => {
  try {
    const code = req.query.code as string;
    const state = req.query.state as string;

    if (!code) {
      return res.status(400).json({ error: 'Missing authorization code' });
    }

    // Verify state token and extract userId
    let userId: string;
    try {
      userId = GmailOAuthService.verifyOAuthStateToken(state);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Invalid OAuth state';
      logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth state verification failed');
      return res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent(errorMessage)}`);
    }

    await GmailOAuthService.handleCallback(code, state);

    // Redirect to dashboard using configured FRONTEND_URL
    res.redirect(`${env.frontendUrl}/dashboard`);
  } catch (error) {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'OAuth callback error');
    res.redirect(`${env.frontendUrl}/login?error=${encodeURIComponent('gmail_connection_failed')}`);
  }
};

/**
 * Revoke Gmail account access
 */
export const revokeOAuth = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    await GmailOAuthService.revoke(userId);
    res.json({ message: 'Gmail account revoked' });
  } catch (error) {
    handleError(error, res);
  }
};

const MAX_SEARCH_QUERY_LENGTH = 500;
const MAX_PAGE_TOKEN_LENGTH = 512;
const MAX_LIST_LIMIT = 100;
const DEFAULT_LIST_LIMIT = 20;
// Gmail page tokens are opaque; only reject values that cannot be a token.
const PAGE_TOKEN_PATTERN = /^[A-Za-z0-9_\-.~+/=]+$/;
// Whitespace, quotes and brackets would change the meaning of `label:<value>`.
const LABEL_PATTERN = /^[^\s"'(){}]{1,100}$/;

type ParsedListOptions =
  | { error: string }
  | {
      options: {
        label: string;
        unread: boolean;
        limit: number;
        q?: string;
        pageToken?: string;
      };
    };

/**
 * Validate the listing query string. Repeated params (arrays) are rejected.
 */
function parseListOptions(query: Record<string, unknown>): ParsedListOptions {
  const { label = 'INBOX', unread, limit, q, pageToken } = query;

  if (typeof label !== 'string' || !LABEL_PATTERN.test(label)) {
    return { error: 'label must be a single Gmail label name without spaces, quotes or brackets' };
  }

  if (unread !== undefined && unread !== 'true' && unread !== 'false') {
    return { error: 'unread must be "true" or "false"' };
  }

  let limitNum = DEFAULT_LIST_LIMIT;
  if (limit !== undefined) {
    limitNum = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : NaN;
    if (!Number.isInteger(limitNum) || limitNum < 1 || limitNum > MAX_LIST_LIMIT) {
      return { error: `limit must be an integer between 1 and ${MAX_LIST_LIMIT}` };
    }
  }

  let search: string | undefined;
  if (q !== undefined) {
    if (typeof q !== 'string' || q.length > MAX_SEARCH_QUERY_LENGTH) {
      return { error: `q must be a single search string of at most ${MAX_SEARCH_QUERY_LENGTH} characters` };
    }
    search = q.trim() || undefined;
  }

  if (
    pageToken !== undefined &&
    (typeof pageToken !== 'string' ||
      pageToken.length > MAX_PAGE_TOKEN_LENGTH ||
      !PAGE_TOKEN_PATTERN.test(pageToken))
  ) {
    return { error: 'pageToken is invalid' };
  }

  return {
    options: {
      label,
      unread: unread === 'true',
      limit: limitNum,
      ...(search && { q: search }),
      ...(pageToken && { pageToken: pageToken as string }),
    },
  };
}

/**
 * Fetch one page of emails from Gmail
 * Query params: q (Gmail search syntax), pageToken, limit, label, unread
 * Response: { emails, nextPageToken }
 */
export const fetchEmails = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const parsed = parseListOptions(req.query || {});

    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }

    const result = await GmailService.fetchEmails(userId, parsed.options);
    res.json(result);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Get a single email
 */
export const getEmail = async (req: any, res: Response) => {
  try {
    const userId = req.userId;
    const gmailMessageId = req.params.gmailMessageId as string;

    const email = await GmailService.getEmail(userId, gmailMessageId);
    res.json(email);
  } catch (error) {
    handleError(error, res);
  }
};

/**
 * Generic error handler for gmail controller
 */
function handleError(error: any, res: Response): void {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ error: error.message });
  } else {
    logger.error(error instanceof Error ? error : new Error(String(error)), 'Gmail controller error');
    res.status(500).json({ error: 'Failed to process Gmail request' });
  }
}
