import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/** No overlay for actions that finish faster than this (avoids a flash). */
export const BUSY_OVERLAY_SHOW_DELAY_MS = 300;
/** Once shown, the overlay stays at least this long (avoids a blink). */
export const BUSY_OVERLAY_MIN_VISIBLE_MS = 400;
/** Default time after which `slowMessage` replaces `message`. */
export const BUSY_OVERLAY_SLOW_AFTER_MS = 4000;

/**
 * Full-page overlay shown while a user action (sign in, register, generate,
 * save, approve, reject, send, save preferences) is in progress. It blocks every click, including the top bar,
 * traps keyboard focus and announces the message to screen readers.
 */
@Component({
  selector: 'app-busy-overlay',
  imports: [CdkTrapFocus, MatProgressSpinnerModule],
  templateUrl: './busy-overlay.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BusyOverlayComponent implements OnChanges, OnDestroy {
  /** True while the action runs. */
  @Input() active = false;
  /** What is happening, e.g. "Sending reply…". */
  @Input() message = '';
  /**
   * Wait before showing, so fast actions never flash it. Use 0 for actions
   * that are always slow (e.g. generating a draft) to show it at once.
   */
  @Input() delay = BUSY_OVERLAY_SHOW_DELAY_MS;
  /** Optional text that replaces `message` once the action runs long, so it does not look stuck. */
  @Input() slowMessage = '';
  /** How long the action runs before `slowMessage` is shown. */
  @Input() slowAfter = BUSY_OVERLAY_SLOW_AFTER_MS;

  /** Whether the overlay is on screen (lags `active` by the delays above). */
  visible = false;
  /** The message on screen; kept while the overlay closes. */
  shownMessage = '';

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private slowTimer: ReturnType<typeof setTimeout> | null = null;
  /** True once `slowMessage` has replaced `message` for the current action. */
  private isSlow = false;
  private shownAt = 0;

  constructor(private changeDetector: ChangeDetectorRef) {}

  ngOnChanges(): void {
    if (this.active) {
      if (this.message && !this.isSlow) {
        this.shownMessage = this.message;
      }
      this.clearHideTimer();
      if (!this.visible && !this.showTimer) {
        if (this.delay > 0) {
          this.showTimer = setTimeout(() => {
            this.showTimer = null;
            this.show();
            this.changeDetector.markForCheck();
          }, this.delay);
        } else {
          this.show();
        }
      }
      if (this.slowMessage && !this.slowTimer && !this.isSlow) {
        this.slowTimer = setTimeout(() => {
          this.slowTimer = null;
          this.isSlow = true;
          this.shownMessage = this.slowMessage;
          this.changeDetector.markForCheck();
        }, this.slowAfter);
      }
      return;
    }

    this.clearShowTimer();
    this.clearSlowTimer();
    this.isSlow = false;
    if (this.visible && !this.hideTimer) {
      const remaining = BUSY_OVERLAY_MIN_VISIBLE_MS - (Date.now() - this.shownAt);
      if (remaining > 0) {
        this.hideTimer = setTimeout(() => {
          this.hideTimer = null;
          this.visible = false;
          this.changeDetector.markForCheck();
        }, remaining);
      } else {
        this.visible = false;
      }
    }
  }

  ngOnDestroy(): void {
    this.clearShowTimer();
    this.clearHideTimer();
    this.clearSlowTimer();
  }

  private show(): void {
    this.visible = true;
    this.shownAt = Date.now();
  }

  private clearSlowTimer(): void {
    if (this.slowTimer) {
      clearTimeout(this.slowTimer);
      this.slowTimer = null;
    }
  }

  private clearShowTimer(): void {
    if (this.showTimer) {
      clearTimeout(this.showTimer);
      this.showTimer = null;
    }
  }

  private clearHideTimer(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  }
}
