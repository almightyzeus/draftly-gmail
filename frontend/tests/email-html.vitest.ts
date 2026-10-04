import { describe, expect, it, vi } from 'vitest';
import { of } from 'rxjs';
import { blockRemoteImages } from '../src/app/shared/email-html';
import { EmailDetailComponent } from '../src/app/pages/email-detail.component';

describe('blockRemoteImages', () => {
  it('removes remote image URLs (http, https, protocol-relative)', () => {
    const html =
      '<p>Hi</p><img src="https://tracker.example.com/open.gif" width="1" height="1">' +
      '<img src="http://cdn.example.com/logo.png" alt="Logo"><img src="//img.example.com/a.png">';

    const result = blockRemoteImages(html);

    expect(result.blocked).toBe(3);
    expect(result.html).not.toMatch(/example\.com/);
    expect(result.html).toContain('alt="Logo"');
    expect(result.html).toContain('<p>Hi</p>');
  });

  it('also blocks srcset, background and poster URLs', () => {
    const html =
      '<img srcset="https://a.example.com/1x.png 1x, https://a.example.com/2x.png 2x">' +
      '<table background="https://bg.example.com/x.png"><tr><td>x</td></tr></table>' +
      '<video poster="https://p.example.com/p.jpg"></video>';

    const result = blockRemoteImages(html);

    expect(result.blocked).toBe(3);
    expect(result.html).not.toMatch(/example\.com/);
  });

  it('keeps inline data: and cid: images and leaves links alone', () => {
    const html =
      '<img src="data:image/png;base64,AAAA"><img src="cid:logo@mail">' +
      '<a href="https://example.com/article">Read more</a>';

    const result = blockRemoteImages(html);

    expect(result.blocked).toBe(0);
    expect(result.html).toBe(html);
  });
});

describe('EmailDetailComponent remote images', () => {
  const load = (bodyHtml: string) => {
    const gmail = { getEmailDetail: vi.fn(() => of({ gmailMessageId: 'm1', threadId: 't1', bodyHtml })) };
    // Stand-in for Angular's sanitizer: returns the (already safe) HTML unchanged.
    const sanitizer = { sanitize: vi.fn((_ctx: number, value: string) => value) };
    const component = new EmailDetailComponent(
      { params: of({ gmailMessageId: 'm1' }) } as any,
      { navigate: vi.fn() } as any,
      gmail as any,
      {} as any,
      sanitizer as any
    );
    component.ngOnInit();
    return component;
  };

  it('hides remote images until the user chooses to show them', () => {
    const component = load('<p>Hello</p><img src="https://tracker.example.com/pixel.gif">');

    expect(component.blockedImageCount).toBe(1);
    expect(component.safeBodyHtml).not.toContain('tracker.example.com');

    component.showRemoteImages();

    expect(component.blockedImageCount).toBe(0);
    expect(component.safeBodyHtml).toContain('https://tracker.example.com/pixel.gif');
  });

  it('shows no notice for emails without remote images', () => {
    const component = load('<p>Just text</p>');
    expect(component.blockedImageCount).toBe(0);
    expect(component.safeBodyHtml).toBe('<p>Just text</p>');
  });
});
