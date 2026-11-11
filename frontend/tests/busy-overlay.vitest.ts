import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BUSY_OVERLAY_MIN_VISIBLE_MS,
  BUSY_OVERLAY_SHOW_DELAY_MS,
  BUSY_OVERLAY_SLOW_AFTER_MS,
  BusyOverlayComponent,
} from '../src/app/shared/busy-overlay.component';

describe('BusyOverlayComponent', () => {
  let changeDetector: { markForCheck: ReturnType<typeof vi.fn> };
  let overlay: BusyOverlayComponent;

  /** Sets the inputs the way Angular would, then runs ngOnChanges. */
  const set = (active: boolean, message = overlay.message) => {
    overlay.active = active;
    overlay.message = message;
    overlay.ngOnChanges();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    changeDetector = { markForCheck: vi.fn() };
    overlay = new BusyOverlayComponent(changeDetector as any);
  });

  afterEach(() => {
    overlay.ngOnDestroy();
    vi.useRealTimers();
  });

  it('never shows for an action that finishes within the show delay', () => {
    set(true, 'Saving changes…');
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS - 1);
    set(false, '');

    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS + BUSY_OVERLAY_MIN_VISIBLE_MS);
    expect(overlay.visible).toBe(false);
  });

  it('shows after the delay with the action message', () => {
    set(true, 'Sending reply…');
    expect(overlay.visible).toBe(false);

    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS);
    expect(overlay.visible).toBe(true);
    expect(overlay.shownMessage).toBe('Sending reply…');
    expect(changeDetector.markForCheck).toHaveBeenCalled();
  });

  it('stays up for the minimum time, keeping its message while closing', () => {
    set(true, 'Approving and saving to Gmail…');
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS + 100);
    set(false, '');

    expect(overlay.visible).toBe(true);
    expect(overlay.shownMessage).toBe('Approving and saving to Gmail…');

    vi.advanceTimersByTime(BUSY_OVERLAY_MIN_VISIBLE_MS - 100 - 1);
    expect(overlay.visible).toBe(true);
    vi.advanceTimersByTime(1);
    expect(overlay.visible).toBe(false);
  });

  it('hides at once when it has already been up for the minimum time', () => {
    set(true, 'Generating…');
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS + BUSY_OVERLAY_MIN_VISIBLE_MS);
    set(false, '');
    expect(overlay.visible).toBe(false);
  });

  it('stays up without flicker when a new action starts while it is closing', () => {
    set(true, 'Saving changes…');
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS);
    set(false, '');
    set(true, 'Sending reply…');

    vi.advanceTimersByTime(BUSY_OVERLAY_MIN_VISIBLE_MS * 2);
    expect(overlay.visible).toBe(true);
    expect(overlay.shownMessage).toBe('Sending reply…');
  });

  it('shows at once when the delay is 0 (always-slow actions such as generating)', () => {
    overlay.delay = 0;
    set(true, 'Reading the thread and drafting a reply…');
    expect(overlay.visible).toBe(true);
    expect(overlay.shownMessage).toBe('Reading the thread and drafting a reply…');
  });

  it('switches to the slow message when the action runs long, and resets for the next action', () => {
    overlay.delay = 0;
    overlay.slowMessage = 'Still working…';
    set(true, 'Drafting…');

    vi.advanceTimersByTime(BUSY_OVERLAY_SLOW_AFTER_MS - 1);
    expect(overlay.shownMessage).toBe('Drafting…');
    vi.advanceTimersByTime(1);
    expect(overlay.shownMessage).toBe('Still working…');

    // A later input change during the same action does not undo the slow message.
    set(true, 'Drafting…');
    expect(overlay.shownMessage).toBe('Still working…');

    set(false, '');
    vi.advanceTimersByTime(BUSY_OVERLAY_MIN_VISIBLE_MS);
    set(true, 'Drafting…');
    expect(overlay.shownMessage).toBe('Drafting…');
  });

  it('never shows the slow message for an action that finishes in time', () => {
    overlay.slowMessage = 'Still working…';
    set(true, 'Saving changes…');
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS);
    set(false, '');
    vi.advanceTimersByTime(BUSY_OVERLAY_SLOW_AFTER_MS * 2);
    expect(overlay.shownMessage).toBe('Saving changes…');
    expect(overlay.visible).toBe(false);
  });

  it('clears pending timers when the page is destroyed (e.g. after navigating away)', () => {
    overlay.slowMessage = 'Still working…';
    set(true, 'Sending reply…');
    overlay.ngOnDestroy();
    vi.advanceTimersByTime(BUSY_OVERLAY_SLOW_AFTER_MS);
    vi.advanceTimersByTime(BUSY_OVERLAY_SHOW_DELAY_MS);
    expect(overlay.visible).toBe(false);
    expect(changeDetector.markForCheck).not.toHaveBeenCalled();
  });
});
