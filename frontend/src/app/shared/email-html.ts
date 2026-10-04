/** Attributes that make the browser fetch a URL as soon as the HTML renders. */
const AUTO_LOADING_ATTRS = /\s(src|srcset|background|poster)="([^"]*)"/gi;
/** http(s) or protocol-relative URLs; inline data: and cid: images are left alone. */
const REMOTE_URL = /(^|[\s,])(https?:)?\/\//i;

/**
 * Remove remote image URLs from already-sanitized email HTML, so opening an
 * email does not tell the sender (via tracking pixels) that it was read.
 * Expects Angular sanitizer output, which always uses double-quoted attributes.
 */
export function blockRemoteImages(sanitizedHtml: string): { html: string; blocked: number } {
  let blocked = 0;
  const html = sanitizedHtml.replace(AUTO_LOADING_ATTRS, (match, _name: string, value: string) => {
    if (REMOTE_URL.test(value)) {
      blocked++;
      return '';
    }
    return match;
  });
  return { html, blocked };
}
