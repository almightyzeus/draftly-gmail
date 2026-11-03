import { describe, expect, it } from 'vitest';
import {
  MAX_REPLY_RECIPIENTS,
  buildRawReply,
  encodeHeaderText,
  formatMailbox,
  parseMailboxList,
  replyRecipients,
  sanitizeHeaderValue,
} from '../src/utils/mimeMessage.js';

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

describe('parseMailboxList', () => {
  it('splits on commas outside quotes and angle brackets', () => {
    expect(parseMailboxList('"Doe, Jane" <jane@x.com>, bob@y.com,  <odd,ity@z.com>')).toEqual([
      '"Doe, Jane" <jane@x.com>',
      'bob@y.com',
    ]);
  });

  it('flattens group syntax and drops entries without a valid address', () => {
    expect(parseMailboxList('Team: a@x.com, B <b@x.com>; undisclosed-recipients:;, not an address')).toEqual([
      'a@x.com',
      'B <b@x.com>',
    ]);
    expect(parseMailboxList(null)).toEqual([]);
    expect(parseMailboxList('')).toEqual([]);
  });

  it('collapses line breaks so a header cannot be injected', () => {
    const [entry] = parseMailboxList('a@x.com\r\nBcc: evil@x.com');
    expect(entry).not.toMatch(/[\r\n]/);
  });

  it(`keeps at most ${MAX_REPLY_RECIPIENTS} entries`, () => {
    const many = Array.from({ length: MAX_REPLY_RECIPIENTS + 10 }, (_, i) => `u${i}@x.com`).join(', ');
    expect(parseMailboxList(many)).toHaveLength(MAX_REPLY_RECIPIENTS);
  });
});

describe('replyRecipients', () => {
  const message = {
    from: 'Alice <alice@x.com>',
    to: 'Me <me@gmail.com>, Bob <bob@x.com>',
    cc: 'carol@x.com, BOB@x.com',
  };

  it('replies to the sender only by default', () => {
    expect(replyRecipients(message, 'me@gmail.com', false)).toEqual({ to: ['Alice <alice@x.com>'], cc: [] });
  });

  it('reply all copies the other recipients, without the user or duplicates (case-insensitive)', () => {
    expect(replyRecipients(message, 'ME@gmail.com', true)).toEqual({
      to: ['Alice <alice@x.com>'],
      cc: ['Bob <bob@x.com>', 'carol@x.com'],
    });
  });

  it('uses Reply-To instead of From, and Cc-s the sender on reply all', () => {
    const withReplyTo = { ...message, replyTo: 'List <list@x.com>, alice@x.com' };
    expect(replyRecipients(withReplyTo, 'me@gmail.com', false)).toEqual({
      to: ['List <list@x.com>', 'alice@x.com'],
      cc: [],
    });
    expect(replyRecipients({ ...message, replyTo: 'List <list@x.com>' }, 'me@gmail.com', true)).toEqual({
      to: ['List <list@x.com>'],
      cc: ['Alice <alice@x.com>', 'Bob <bob@x.com>', 'carol@x.com'],
    });
  });

  it('only takes the first mailbox of a From header', () => {
    expect(replyRecipients({ from: 'a@x.com, b@x.com' }, null, false).to).toEqual(['a@x.com']);
  });

  it(`caps To and Cc together at ${MAX_REPLY_RECIPIENTS}`, () => {
    const to = Array.from({ length: 40 }, (_, i) => `t${i}@x.com`).join(', ');
    const cc = Array.from({ length: 40 }, (_, i) => `c${i}@x.com`).join(', ');
    const result = replyRecipients({ from: 'a@x.com', to, cc }, null, true);
    expect(result.to.length + result.cc.length).toBe(MAX_REPLY_RECIPIENTS);
  });
});

describe('buildRawReply with several recipients', () => {
  it('writes To and Cc as folded address lists of formatted mailboxes', () => {
    const raw = buildRawReply({
      ...baseInput,
      to: ['List <list@x.com>', 'alice@x.com'],
      cc: ['"Doe, Jane" <jane@x.com>', 'José <jose@x.com>'],
    });

    expect(raw).toContain('To: "List" <list@x.com>,\r\n alice@x.com\r\n');
    expect(raw).toMatch(/Cc: "Doe, Jane" <jane@x\.com>,\r\n =\?UTF-8\?B\?[^?]+\?= <jose@x\.com>\r\n/);
  });

  it('omits Cc when there is none, and refuses an empty To', () => {
    expect(buildRawReply({ ...baseInput, cc: [] })).not.toContain('Cc:');
    expect(() => buildRawReply({ ...baseInput, to: [] })).toThrow('Cannot determine a valid reply address');
  });
});
