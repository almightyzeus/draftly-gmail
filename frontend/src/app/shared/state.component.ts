import { ChangeDetectionStrategy, Component, Input, booleanAttribute } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

/**
 * Centred loading, empty or error message for a page or a list. Shows a
 * spinner or an icon, then the projected content: one or more `<p>` lines and
 * an optional action button.
 *
 *   <app-state spinner><p>Loading drafts…</p></app-state>
 *   <app-state icon="error_outline" error role="alert"><p>{{ error }}</p><button …>Try again</button></app-state>
 */
@Component({
  selector: 'app-state',
  imports: [MatIconModule, MatProgressSpinnerModule],
  templateUrl: './state.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class StateComponent {
  /** Material icon name shown above the message (ignored when `spinner` is set). */
  @Input() icon = '';
  /** Show a loading spinner instead of an icon. */
  @Input({ transform: booleanAttribute }) spinner = false;
  /** Error colours instead of muted text. */
  @Input({ transform: booleanAttribute }) error = false;
}
