const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  '#39': "'",
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
  zwnj: '',
  zwj: '',
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code) => safeCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => safeCodePoint(parseInt(code, 16)))
    .replace(/&([a-z0-9#]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match)
    // Last, so "&amp;lt;" becomes the literal text "&lt;" rather than "<".
    .replace(/&amp;/gi, '&');
}

function safeCodePoint(code: number): string {
  return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/**
 * Readable plain text from an email's HTML body, for the AI prompt.
 * Not a renderer: it keeps paragraph/line structure and drops markup, styles,
 * scripts and hidden head content.
 */
export function htmlToText(html: string | null | undefined): string {
  if (!html) {
    return '';
  }

  const text = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(head|style|script|title|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    // A list item / table row breaks the line once (its opening <li> or closing </tr>).
    .replace(/<\/(p|div|tr|ul|ol|table|blockquote|section|article|header|footer|h[1-6])\s*>/gi, '\n')
    .replace(/<(p|div|table|blockquote|h[1-6]|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v ]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True when a "plain text" body is actually HTML markup (legacy cached rows). */
export function looksLikeHtml(text: string | null | undefined): boolean {
  return /^\s*<(!doctype|html|head|body|div|table|p|span|center|meta|style)\b/i.test(text ?? '');
}

/**
 * The best plain-text version of a cached email: the text/plain part when it
 * exists, otherwise text derived from the HTML.
 */
export function emailPlainText(email: { bodyPlain?: string | null; bodyHtml?: string | null }): string {
  const plain = email.bodyPlain?.trim();
  if (plain && !looksLikeHtml(plain)) {
    return plain;
  }
  return htmlToText(email.bodyHtml || plain || '');
}
