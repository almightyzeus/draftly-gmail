import { describe, expect, it } from 'vitest';
import { buildRawReply, encodeHeaderText, formatMailbox, sanitizeHeaderValue } from '../src/utils/mimeMessage.js';

/**
 * Split a raw message into its header lines (up to the first blank line).
 * Bare CR or LF count as line breaks too, as they do for many mail parsers.
 */
const headerLines = (raw: string) => raw.split('\r\n\r\n')[0].split(/\r\n|\n|\r/);

const decodeParts = (raw: string) => {
  const boundary = raw.match(/boundary="([^"]+)"/)![1];
  return raw
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((part) => {
      const [head, body] = part.split('\r\n\r\n');
      return { head, text: Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8') };
    });
};

const baseInput = {
  from: 'me@gmail.com',
  to: 'Sender <sender@example.com>',
  subject: 'Re: Question',
  body: 'Hello,\nThanks!',
  inReplyTo: '<m1@example.com>',
  references: '<m0@example.com> <m1@example.com>',
};

describe('buildRawReply', () => {
  it('builds threaded multipart/alternative with base64 plain and HTML parts', () => {
    const raw = buildRawReply(baseInput);
    const headers = headerLines(raw);

    expect(headers).toEqual(
      expect.arrayContaining([
        'From: me@gmail.com',
        'To: "Sender" <sender@example.com>',
        'Subject: Re: Question',
        'MIME-Version: 1.0',
        'In-Reply-To: <m1@example.com>',
        'References: <m0@example.com> <m1@example.com>',
      ])
    );
    const [plain, html] = decodeParts(raw);
    expect(plain.head).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(plain.head).toContain('Content-Transfer-Encoding: base64');
    expect(plain.text).toBe('Hello,\nThanks!');
    expect(html.head).toContain('Content-Type: text/html; charset="UTF-8"');
    expect(html.text).toBe('Hello,<br>\r\nThanks!');
  });

  it.each([
    ['Subject', { subject: 'Re: Hi\r\nBcc: attacker@evil.example' }],
    ['To', { to: 'victim@example.com\r\nBcc: attacker@evil.example' }],
    ['To (bare LF)', { to: 'victim@example.com\nBcc: attacker@evil.example' }],
    ['References', { references: '<m1@example.com>\r\nBcc: attacker@evil.example' }],
  ])('neutralises a header injection attempt via %s', (_field, override) => {
    const raw = buildRawReply({ ...baseInput, ...override });
    const headers = headerLines(raw);

    expect(headers.some((line) => /^bcc:/i.test(line))).toBe(false);
    expect(headers.filter((line) => /^[A-Za-z-]+:/.test(line)).map((l) => l.split(':')[0])).toEqual(
      expect.not.arrayContaining(['Bcc'])
    );
  });

  it('cannot be broken by body text that looks like a boundary or header', () => {
    const body = '--draftly-fake\r\nContent-Type: text/html\r\n\r\n<script>x</script>\nBcc: a@b.c';
    const raw = buildRawReply({ ...baseInput, body });

    expect(decodeParts(raw)[0].text).toBe(body);
    expect(headerLines(raw).some((line) => /^bcc:/i.test(line))).toBe(false);
    expect(raw).not.toContain('<script>');
  });

  it('uses a random boundary per message', () => {
    const boundary = (raw: string) => raw.match(/boundary="([^"]+)"/)![1];
    expect(boundary(buildRawReply(baseInput))).not.toBe(boundary(buildRawReply(baseInput)));
  });

  it('keeps body lines within MIME limits for long bodies', () => {
    const raw = buildRawReply({ ...baseInput, body: 'x'.repeat(5000) });
    expect(raw.split('\r\n').every((line) => line.length <= 998)).toBe(true);
  });
});

describe('formatMailbox (reply recipient)', () => {
  it.each([
    ['Sender <sender@example.com>', '"Sender" <sender@example.com>'],
    ['"Doe, John" <john@example.com>', '"Doe, John" <john@example.com>'],
    ['sender@example.com', 'sender@example.com'],
    ['<sender@example.com>', 'sender@example.com'],
  ])('formats %s', (input, expected) => {
    expect(formatMailbox(input)).toBe(expected);
  });

  it('encodes a non-ASCII display name', () => {
    const formatted = formatMailbox('José Núñez <jose@example.com>');
    expect(formatted).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <jose@example.com>$/);
  });

  it.each([
    'Victim <victim@example.com>\r\nBcc: attacker@evil.example',
    'Victim <victim@example.com> Bcc: attacker@evil.example;',
    'Victim <victim@example.com>, attacker@evil.example',
  ])('keeps only the first mailbox from %j', (input) => {
    const formatted = formatMailbox(input);
    expect(formatted).toBe('"Victim" <victim@example.com>');
    expect(formatted).not.toContain('attacker');
  });

  it('keeps only the first bare address', () => {
    expect(formatMailbox('victim@example.com\r\nBcc: attacker@evil.example')).toBe('victim@example.com');
    expect(formatMailbox('victim@example.com, attacker@evil.example')).toBe('victim@example.com');
  });

  it.each(['', 'not an address', 'a@b@c', 'Name <>'])('rejects an unusable From value %j', (input) => {
    expect(() => formatMailbox(input)).toThrow('Cannot determine a valid reply address');
  });
});

describe('header helpers', () => {
  it('collapses CR/LF in header values', () => {
    expect(sanitizeHeaderValue('a\r\nb\nc\rd')).toBe('a b c d');
  });

  it('leaves ASCII subjects alone and RFC 2047-encodes non-ASCII ones', () => {
    expect(encodeHeaderText('Re: Hello')).toBe('Re: Hello');

    const subject = 'Re: Café ☕ — résumé '.repeat(4);
    const encoded = encodeHeaderText(subject);
    const words = encoded.split('\r\n ');
    expect(words.every((w) => /^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/.test(w) && w.length <= 75)).toBe(true);
    const decoded = words.map((w) => Buffer.from(w.slice(10, -2), 'base64').toString('utf8')).join('');
    expect(decoded).toBe(subject);
  });
});
