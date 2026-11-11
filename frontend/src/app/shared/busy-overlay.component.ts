import { ChangeDetectionStrategy, ChangeDetectorRef, Component, Input, OnChanges, OnDestroy } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/** No overlay for actions that finish faster than this (avoids a flash). */
export const BUSY_OVERLAY_SHOW_DELAY_MS = 300;
/** Once shown, the overlay stays at least this long (avoids a blink). */
export const BUSY_OVERLAY_MIN_VISIBLE_MS = 400;

/**
 * Full-page overlay shown while a user action (generate, save, approve,
 * reject, send) is in progress. It blocks every click, including the top bar,
 * traps keyboard focus and announces the message to screen readers.
 */
@Component({
  selector: 'app-busy-overlay',
  imports: [CdkTrapFocus, MatProgressSpinnerModule],
  templateUrl: './busy-overlay.component.html',
  styleUrls: ['./busy-overlay.component.css'],
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class BusyOverlayComponent implements OnChanges, OnDestroy {
  /** True while the action runs. */
  @Input() active = false;
  /** What is happening, e.g. "Sending reply…". */
  @Input() message = '';

  /** Whether the overlay is on screen (lags `active` by the delays above). */
  visible = false;
  /** The message on screen; kept while the overlay closes. */
  shownMessage = '';

  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private hideTimer: ReturnType<typeof setTimeout> | null = null;
  private shownAt = 0;

  constructor(private changeDetector: ChangeDetectorRef) {}

  ngOnChanges(): void {
    if (this.active) {
      if (this.message) {
        this.shownMessage = this.message;
      }
      this.clearHideTimer();
      if (!this.visible && !this.showTimer) {
        this.showTimer = setTimeout(() => {
          this.showTimer = null;
          this.visible = true;
          this.shownAt = Date.now();
          this.changeDetector.markForCheck();
        }, BUSY_OVERLAY_SHOW_DELAY_MS);
      }
      return;
    }

    this.clearShowTimer();
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
