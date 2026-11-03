import type { ActivityLog } from '../services/activity.service';

export interface ActivityDescription {
  icon: string;
  title: string;
  /** Secondary line, e.g. the tone or the length; empty when there is nothing to add. */
  detail: string;
}

/** Filter chips of the activity page; the values match the backend's action names. */
export const ACTIVITY_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT_GENERATED', label: 'Generated' },
  { value: 'DRAFT_EDITED', label: 'Edited' },
  { value: 'DRAFT_APPROVED', label: 'Approved' },
  { value: 'DRAFT_SENT', label: 'Sent' },
  { value: 'DRAFT_REJECTED', label: 'Rejected' },
  { value: 'DRAFT_SUPERSEDED', label: 'Replaced' },
];

const capitalize = (text: string) => (text ? text[0].toUpperCase() + text.slice(1) : text);

/** A readable line for one activity log entry. Unknown actions get a generic description. */
export function describeActivity(log: ActivityLog): ActivityDescription {
  const meta = log.meta ?? {};

  switch (log.action) {
    case 'DRAFT_GENERATED': {
      const parts = [meta['tone'] ? `${capitalize(meta['tone'])} tone` : ''];
      if (meta['isConsolidated'] && meta['emailCount'] > 1) {
        parts.push(`${meta['emailCount']} emails answered together`);
      }
      return { icon: 'auto_awesome', title: 'Draft generated', detail: parts.filter(Boolean).join(' · ') };
    }
    case 'DRAFT_EDITED': {
      const parts = [
        typeof meta['bodyLength'] === 'number' ? `${meta['bodyLength']} characters` : '',
        meta['replyAll'] === true ? 'reply all' : '',
        meta['status'] === 'APPROVED' ? 'synced to Gmail' : '',
      ];
      return { icon: 'edit', title: 'Draft edited', detail: parts.filter(Boolean).join(' · ') };
    }
    case 'DRAFT_APPROVED':
      return { icon: 'check_circle', title: 'Draft approved', detail: 'Saved to your Gmail drafts' };
    case 'DRAFT_SENT':
      return { icon: 'send', title: 'Reply sent', detail: '' };
    case 'DRAFT_REJECTED':
      return meta['previousStatus'] === 'APPROVED'
        ? { icon: 'block', title: 'Approved draft withdrawn', detail: 'Removed from your Gmail drafts' }
        : { icon: 'block', title: 'Draft rejected', detail: '' };
    case 'DRAFT_SUPERSEDED':
      return { icon: 'swap_horiz', title: 'Draft replaced', detail: 'A newer draft was generated for the same email' };
    default:
      return {
        icon: log.level === 'info' ? 'info' : 'warning',
        title: capitalize(log.action.toLowerCase().replace(/_/g, ' ')),
        detail: '',
      };
  }
}
