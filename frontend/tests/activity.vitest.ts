import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { ACTIVITY_PAGE_SIZE, ActivityComponent } from '../src/app/pages/activity.component';
import { ActivityLog, ActivityService } from '../src/app/services/activity.service';
import { ACTIVITY_FILTERS, describeActivity } from '../src/app/shared/activity-format';

const log = (overrides: Partial<ActivityLog> = {}): ActivityLog => ({
  _id: 'log-1',
  action: 'DRAFT_SENT',
  entityType: 'Draft',
  entityId: 'draft-1',
  level: 'info',
  meta: {},
  createdAt: '2026-11-03T10:00:00.000Z',
  ...overrides,
});

describe('describeActivity', () => {
  it.each([
    ['DRAFT_GENERATED', { tone: 'friendly' }, 'Draft generated', 'Friendly tone'],
    ['DRAFT_GENERATED', { tone: 'formal', isConsolidated: true, emailCount: 3 }, 'Draft generated', 'Formal tone · 3 emails answered together'],
    ['DRAFT_EDITED', { bodyLength: 120, replyAll: true, status: 'APPROVED' }, 'Draft edited', '120 characters · reply all · synced to Gmail'],
    ['DRAFT_EDITED', { bodyLength: 80, replyAll: false, status: 'PENDING' }, 'Draft edited', '80 characters'],
    ['DRAFT_APPROVED', {}, 'Draft approved', 'Saved to your Gmail drafts'],
    ['DRAFT_SENT', {}, 'Reply sent', ''],
    ['DRAFT_REJECTED', { previousStatus: 'PENDING' }, 'Draft rejected', ''],
    ['DRAFT_REJECTED', { previousStatus: 'APPROVED' }, 'Approved draft withdrawn', 'Removed from your Gmail drafts'],
    ['DRAFT_SUPERSEDED', { supersededBy: 'd2' }, 'Draft replaced', 'A newer draft was generated for the same email'],
  ])('%s %j', (action, meta, title, detail) => {
    expect(describeActivity(log({ action, meta }))).toMatchObject({ title, detail });
  });

  it('describes unknown actions generically and tolerates missing meta', () => {
    expect(describeActivity(log({ action: 'GMAIL_SYNC_FAILED', level: 'warn', meta: null }))).toEqual({
      icon: 'warning',
      title: 'Gmail sync failed',
      detail: '',
    });
    expect(describeActivity(log({ action: 'DRAFT_GENERATED', meta: null })).detail).toBe('');
  });

  it('offers a filter for every described action', () => {
    expect(ACTIVITY_FILTERS.map((f) => f.value)).toEqual([
      '',
      'DRAFT_GENERATED',
      'DRAFT_EDITED',
      'DRAFT_APPROVED',
      'DRAFT_SENT',
      'DRAFT_REJECTED',
      'DRAFT_SUPERSEDED',
    ]);
  });
});

describe('ActivityService', () => {
  it('requests one page, adding the action only when filtering', () => {
    const http = { get: vi.fn().mockReturnValue(of({ logs: [], total: 0 })) };
    const service = new ActivityService(http as any);

    service.getActivity({ limit: 25, skip: 50 }).subscribe();
    expect(http.get).toHaveBeenCalledWith('api/logs', { params: { limit: '25', skip: '50' } });

    service.getActivity({ limit: 25, skip: 0, action: 'DRAFT_SENT' }).subscribe();
    expect(http.get).toHaveBeenLastCalledWith('api/logs', { params: { limit: '25', skip: '0', action: 'DRAFT_SENT' } });
  });
});

describe('ActivityComponent', () => {
  let api: { getActivity: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };

  const create = () => {
    const component = new ActivityComponent(api as any, router as any);
    component.ngOnInit();
    return component;
  };

  beforeEach(() => {
    api = { getActivity: vi.fn(() => of({ logs: [log()], total: 1 })) };
    router = { navigate: vi.fn() };
  });

  it('loads the first page and links entries to their draft', () => {
    api.getActivity.mockReturnValue(
      of({ logs: [log(), log({ _id: 'log-2', entityType: 'User', entityId: null, action: 'DRAFT_APPROVED' })], total: 2 })
    );
    const component = create();

    expect(api.getActivity).toHaveBeenCalledWith({ limit: ACTIVITY_PAGE_SIZE, skip: 0, action: undefined });
    expect(component.isLoading).toBe(false);
    expect(component.total).toBe(2);
    expect(component.items.map((item) => [item.title, item.draftLink])).toEqual([
      ['Reply sent', ['/draft', 'draft-1']],
      ['Draft approved', null],
    ]);
  });

  it('filters from the first page and ignores selecting the same filter again', () => {
    api.getActivity.mockReturnValue(of({ logs: [log()], total: 100 }));
    const component = create();
    component.goToPage(2);
    expect(api.getActivity).toHaveBeenLastCalledWith({ limit: ACTIVITY_PAGE_SIZE, skip: 2 * ACTIVITY_PAGE_SIZE, action: undefined });

    component.setFilter('DRAFT_SENT');
    expect(component.pageIndex).toBe(0);
    expect(component.filterLabel).toBe('Sent');
    expect(api.getActivity).toHaveBeenLastCalledWith({ limit: ACTIVITY_PAGE_SIZE, skip: 0, action: 'DRAFT_SENT' });

    const calls = api.getActivity.mock.calls.length;
    component.setFilter('DRAFT_SENT');
    expect(api.getActivity).toHaveBeenCalledTimes(calls);

    // Deselecting the chip (undefined) shows everything again.
    component.setFilter(undefined);
    expect(component.action).toBe('');
    expect(api.getActivity).toHaveBeenLastCalledWith({ limit: ACTIVITY_PAGE_SIZE, skip: 0, action: undefined });
  });

  it('pages between newer and older entries within the total', () => {
    api.getActivity.mockReturnValue(of({ logs: Array.from({ length: ACTIVITY_PAGE_SIZE }, (_, i) => log({ _id: `l${i}` })), total: 60 }));
    const component = create();
    expect(component.rangeLabel).toBe('1–25 of 60');
    expect(component.isLastPage).toBe(false);

    component.goToPage(-1);
    expect(api.getActivity).toHaveBeenCalledTimes(1);

    component.goToPage(2);
    api.getActivity.mockReturnValue(of({ logs: [log()], total: 60 }));
    component.load();
    expect(component.isLastPage).toBe(true);
    expect(component.rangeLabel).toBe('51–51 of 60');

    const calls = api.getActivity.mock.calls.length;
    component.goToPage(3);
    expect(api.getActivity).toHaveBeenCalledTimes(calls);
  });

  it('keeps only the latest response when filters change quickly', () => {
    const slow = new Subject<any>();
    const fast = new Subject<any>();
    api.getActivity.mockReturnValueOnce(of({ logs: [], total: 0 })).mockReturnValueOnce(slow).mockReturnValueOnce(fast);
    const component = create();

    component.setFilter('DRAFT_EDITED');
    component.setFilter('DRAFT_SENT');
    fast.next({ logs: [log()], total: 1 });
    slow.next({ logs: [log({ _id: 'stale', action: 'DRAFT_EDITED' }), log({ _id: 'stale-2', action: 'DRAFT_EDITED' })], total: 2 });

    expect(component.items.map((item) => item.log._id)).toEqual(['log-1']);
    expect(component.total).toBe(1);
  });

  it('shows the error with a retry', () => {
    api.getActivity
      .mockReturnValueOnce(throwError(() => ({ status: 500, error: { error: 'Failed to fetch activity logs' } })))
      .mockReturnValueOnce(of({ logs: [log()], total: 1 }));
    const component = create();

    expect(component.error).toBe('Failed to fetch activity logs');
    expect(component.isLoading).toBe(false);

    component.load();
    expect(component.error).toBeNull();
    expect(component.items).toHaveLength(1);
  });

  it('goes back to the dashboard', () => {
    create().goBack();
    expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
  });
});
