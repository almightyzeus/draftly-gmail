import { describe, expect, it } from 'vitest';
import { emailPlainText, htmlToText, looksLikeHtml } from '../src/utils/htmlToText.js';

describe('htmlToText', () => {
  it('keeps paragraph and line structure and drops markup', () => {
    const html = '<html><head><title>x</title><style>p{color:red}</style></head><body>' +
      '<p>Hi Chinmay,</p><p>Could you send the <b>Q3</b> forecast?<br>By Friday please.</p>' +
      '<ul><li>Marketing</li><li>Infra</li></ul><div>Thanks,<br/>Priya</div></body></html>';

    expect(htmlToText(html)).toBe('Hi Chinmay,\n\nCould you send the Q3 forecast?\nBy Friday please.\n\n- Marketing\n- Infra\n\nThanks,\nPriya');
  });

  it('removes scripts, styles, comments and hidden head content', () => {
    const html = '<!-- tracking --><script>steal()</script><style>.x{}</style><p>Visible</p><noscript>nope</noscript>';
    expect(htmlToText(html)).toBe('Visible');
  });

  it('decodes entities once (no double decoding)', () => {
    expect(htmlToText('<p>Tom &amp; Jerry &lt;3 &nbsp;caf&eacute; &#8212; &#x2713; &quot;hi&quot; &amp;lt;tag&amp;gt;</p>'))
      .toBe('Tom & Jerry <3 caf&eacute; — ✓ "hi" &lt;tag&gt;');
  });

  it('separates table cells and rows', () => {
    expect(htmlToText('<table><tr><td>Item</td><td>Qty</td></tr><tr><td>Laptop</td><td>2</td></tr></table>'))
      .toBe('Item Qty\nLaptop 2');
  });

  it('handles empty input', () => {
    expect(htmlToText(undefined)).toBe('');
    expect(htmlToText('')).toBe('');
  });
});

describe('emailPlainText', () => {
  it('prefers a real text/plain body', () => {
    expect(emailPlainText({ bodyPlain: 'Plain version', bodyHtml: '<p>HTML version</p>' })).toBe('Plain version');
  });

  it('falls back to text from the HTML body for HTML-only emails', () => {
    expect(emailPlainText({ bodyPlain: '', bodyHtml: '<p>Only <i>HTML</i></p>' })).toBe('Only HTML');
  });

  it('converts legacy rows that stored HTML as "plain text"', () => {
    expect(emailPlainText({ bodyPlain: '<div>Legacy <b>row</b></div>', bodyHtml: null })).toBe('Legacy row');
  });

  it('recognises HTML documents but not plain text that merely mentions tags', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('  <table width="100%">')).toBe(true);
    expect(looksLikeHtml('Use the <b> tag for bold')).toBe(false);
  });
});
