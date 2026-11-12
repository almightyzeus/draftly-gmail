import { ChangeDetectionStrategy, Component, Input, booleanAttribute } from '@angular/core';

/**
 * Draft status pill (PENDING, APPROVED, SENT, REJECTED), coloured by status.
 * Colours are picked in the template from the `data-status` attribute.
 */
@Component({
  selector: 'app-status-badge',
  templateUrl: './status-badge.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class StatusBadgeComponent {
  @Input({ required: true }) status = '';
  /** Light background for a badge placed on the primary-coloured top bar. */
  @Input({ transform: booleanAttribute }) onPrimary = false;
}
