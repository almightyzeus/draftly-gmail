import crypto from 'crypto';

export interface ReplyRecipients {
  to: string[];
  cc: string[];
}

export interface ReplyMessageInput {
  from?: string | null;
  /** One mailbox, or several (Reply-To may list more than one). */
  to: string | string[];
  cc?: string[];
  subject: string;
  /** Plain-text body as approved by the user. */
  body: string;
  inReplyTo?: string;
  references?: string;
}

/**
 * Header values here come partly from inbound mail (the sender's From and
 * Subject). A CR or LF would end the header and let the sender inject new
 * ones (e.g. a hidden Bcc), so line breaks are collapsed to a single space.
 */
export function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

/**
 * RFC 2047 "B" encoding for non-ASCII header text. ASCII text is returned as is.
 * Long values are split into several encoded words (each at most 75 chars),
 * without splitting a multi-byte character.
 */
export function encodeHeaderText(value: string): string {
  if (!/[^\x20-\x7e]/.test(value)) {
    return value;
  }

  const words: string[] = [];
  let chunk = '';
  for (const char of value) {
    if (Buffer.byteLength(chunk + char, 'utf8') > 45) {
      words.push(chunk);
      chunk = '';
    }
    chunk += char;
  }
  if (chunk) {
    words.push(chunk);
  }

  return words
    .map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`)
    .join('\r\n ');
}

const ADDRESS = /^[^\s<>@",;:()\[\]\\]+@[^\s<>@",;:()\[\]\\]+$/;

/**
 * The address of the first mailbox in a From/To value (original case), or null.
 * Compare addresses case-insensitively.
 */
export function mailboxAddress(value: string | null | undefined): string | null {
  const sanitized = sanitizeHeaderValue(value ?? '');
  const angle = sanitized.match(/<([^<>]+)>/);
  const address = (angle ? angle[1] : sanitized.split(/[\s,;]+/)[0]).trim();
  return ADDRESS.test(address) ? address : null;
}

/**
 * Turn the inbound From value into exactly one recipient mailbox. Only the
 * first <address> (or a bare address) is kept, so text a sender appends to
 * their From header can never add recipients (e.g. via group syntax).
 */
export function formatMailbox(value: string): string {
  const sanitized = sanitizeHeaderValue(value);
  const angle = sanitized.match(/<([^<>]+)>/);
  const address = mailboxAddress(value);

  if (!address) {
    throw new Error('Cannot determine a valid reply address');
  }

  const name = angle
    ? sanitized.slice(0, angle.index).trim().replace(/^"(.*)"$/, '$1').replace(/["\\]/g, '').trim()
    : '';
  if (!name) {
    return address;
  }

  const phrase = /[^\x20-\x7e]/.test(name) ? encodeHeaderText(name) : `"${name}"`;
  return `${phrase} <${address}>`;
}

/** Upper bound on the recipients of one reply (To and Cc together). */
export const MAX_REPLY_RECIPIENTS = 50;

/**
 * Split an address-list header (To, Cc, Reply-To) into single mailboxes, e.g.
 * `"Doe, Jane" <jane@x.com>, bob@y.com` → two entries. Commas inside quotes or
 * angle brackets do not split. Group syntax (`Team: a@x.com, b@y.com;`) is
 * flattened. Entries without a valid address are dropped. Each entry is a
 * sanitized single mailbox that formatMailbox accepts.
 */
export function parseMailboxList(value: string | null | undefined): string[] {
  const sanitized = sanitizeHeaderValue(value ?? '');
  const segments: string[] = [];
  let current = '';
  let inQuotes = false;
  let inAngle = false;

  for (const char of sanitized) {
    if (char === '"' && !inAngle) inQuotes = !inQuotes;
    else if (char === '<' && !inQuotes) inAngle = true;
    else if (char === '>' && !inQuotes) inAngle = false;

    if ((char === ',' || char === ';') && !inQuotes && !inAngle) {
      segments.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  segments.push(current);

  return segments
    .map((segment) => segment.trim().replace(/^[^"<>@]*:\s*/, '')) // group label
    .filter((segment) => segment && mailboxAddress(segment))
    .slice(0, MAX_REPLY_RECIPIENTS);
}

/**
 * Who a reply goes to, as a mail client would address it:
 * - To: the Reply-To mailboxes when the message has a Reply-To header,
 *   otherwise its sender (From, one mailbox).
 * - Cc (reply all only): the message's other recipients (To and Cc, plus the
 *   sender when Reply-To redirected the reply).
 * The user's own address and duplicates (case-insensitive) are removed, and
 * the total is capped at MAX_REPLY_RECIPIENTS.
 */
export function replyRecipients(
  message: { from?: string | null; to?: string | null; cc?: string | null; replyTo?: string | null },
  ownAddress: string | null | undefined,
  replyAll: boolean
): ReplyRecipients {
  const own = ownAddress?.toLowerCase();
  const seen = new Set<string>(own ? [own] : []);
  const take = (mailboxes: string[]) =>
    mailboxes.filter((mailbox) => {
      const address = (mailboxAddress(mailbox) as string).toLowerCase();
      if (seen.has(address)) return false;
      seen.add(address);
      return true;
    });

  const replyToList = parseMailboxList(message.replyTo);
  const sender = parseMailboxList(message.from).slice(0, 1);
  const to = take(replyToList.length ? replyToList : sender);

  const cc = replyAll
    ? take([
        ...(replyToList.length ? sender : []),
        ...parseMailboxList(message.to),
        ...parseMailboxList(message.cc),
      ])
    : [];

  return { to, cc: cc.slice(0, Math.max(0, MAX_REPLY_RECIPIENTS - to.length)) };
}

/** Address-list header value: each mailbox formatted, folded one per line. */
function formatMailboxList(mailboxes: string[]): string {
  return mailboxes.map((mailbox) => formatMailbox(mailbox)).join(',\r\n ');
}

/** Base64 with 76-character lines, as MIME requires. */
function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

/** Escape plain text and keep its line breaks, as the HTML part of a reply. */
export function plainTextToHtml(plainText: string): string {
  return plainText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>\r\n');
}

/**
 * Build the RFC 822 reply (multipart/alternative: plain text + HTML) that is
 * stored as the Gmail draft and later sent.
 */
export function buildRawReply(input: ReplyMessageInput): string {
  const boundary = `draftly-${crypto.randomBytes(16).toString('hex')}`;
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (to.length === 0) {
    throw new Error('Cannot determine a valid reply address');
  }

  const headers = [
    ...(input.from ? [`From: ${sanitizeHeaderValue(input.from)}`] : []),
    `To: ${formatMailboxList(to)}`,
    ...(input.cc?.length ? [`Cc: ${formatMailboxList(input.cc)}`] : []),
    `Subject: ${encodeHeaderText(sanitizeHeaderValue(input.subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${sanitizeHeaderValue(input.inReplyTo)}`);
  }
  if (input.references) {
    headers.push(`References: ${sanitizeHeaderValue(input.references)}`);
  }

  const part = (contentType: string, content: string) =>
    [
      `--${boundary}`,
      `Content-Type: ${contentType}; charset="UTF-8"`,
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(content),
    ].join('\r\n');

  return [
    headers.join('\r\n'),
    '',
    part('text/plain', input.body),
    part('text/html', plainTextToHtml(input.body)),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
