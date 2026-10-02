import crypto from 'crypto';

export interface ReplyMessageInput {
  from?: string | null;
  to: string;
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

/** Base64 with 76-character lines, as MIME requires. */
function base64Lines(text: string): string {
  return (Buffer.from(text, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n');
}

function plainTextToHtml(plainText: string): string {
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

  const headers = [
    ...(input.from ? [`From: ${sanitizeHeaderValue(input.from)}`] : []),
    `To: ${formatMailbox(input.to)}`,
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
