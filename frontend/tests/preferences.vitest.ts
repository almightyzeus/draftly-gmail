import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { FormBuilder } from '@angular/forms';
import { PreferencesComponent } from '../src/app/pages/preferences.component';
import { PreferenceService } from '../src/app/services/preference.service';

const stored = { defaultTone: 'friendly' as const, signature: 'Best,\nAna', learningEmailCount: 7 };

describe('PreferencesComponent', () => {
  let api: { getPreferences: ReturnType<typeof vi.fn>; updatePreferences: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  const confirmWith = (answer: boolean) => ({ confirm: vi.fn(() => of(answer)) });

  const create = (confirm = confirmWith(true)) => {
    const component = new PreferencesComponent(new FormBuilder(), api as any, router as any, snackBar as any, confirm as any);
    component.ngOnInit();
    return component;
  };

  beforeEach(() => {
    api = {
      getPreferences: vi.fn(() => of(stored)),
      updatePreferences: vi.fn((changes: any) => of({ ...stored, ...changes })),
    };
    router = { navigate: vi.fn() };
    snackBar = { open: vi.fn() };
  });

  it('loads the stored preferences into an unchanged form', () => {
    const component = create();

    expect(component.isLoading).toBe(false);
    expect(component.form.getRawValue()).toEqual(stored);
    expect(component.form.pristine).toBe(true);
    expect(component.signatureLength).toBe('Best,\nAna'.length);
  });

  it('shows a load error with a retry', () => {
    api.getPreferences
      .mockReturnValueOnce(throwError(() => ({ status: 500, error: { error: 'Failed to fetch preferences' } })))
      .mockReturnValueOnce(of(stored));
    const component = create();

    expect(component.loadError).toBe('Failed to fetch preferences');
    expect(component.isLoading).toBe(false);

    component.load();
    expect(component.loadError).toBeNull();
    expect(component.form.get('defaultTone')?.value).toBe('friendly');
  });

  it('saves the form (signature trimmed at the end), confirms, and marks it unchanged', () => {
    const component = create();
    component.form.patchValue({ defaultTone: 'concise', signature: 'Cheers,\nAna\n\n  ', learningEmailCount: '3' });
    component.form.markAsDirty();

    component.save();

    expect(api.updatePreferences).toHaveBeenCalledWith({ defaultTone: 'concise', signature: 'Cheers,\nAna', learningEmailCount: 3 });
    expect(component.form.getRawValue()).toEqual({ defaultTone: 'concise', signature: 'Cheers,\nAna', learningEmailCount: 3 });
    expect(component.form.pristine).toBe(true);
    expect(component.isSaving).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Preferences saved.', 'Close', expect.any(Object));
  });

  it('does not save an unchanged form or a request already in flight', () => {
    const pending = new Subject<any>();
    api.updatePreferences.mockReturnValue(pending);
    const component = create();

    component.save();
    expect(api.updatePreferences).not.toHaveBeenCalled();

    component.form.patchValue({ defaultTone: 'formal' });
    component.form.markAsDirty();
    component.save();
    component.save();
    expect(api.updatePreferences).toHaveBeenCalledTimes(1);
    expect(component.isSaving).toBe(true);
  });

  it.each([
    ['a signature over 1000 characters', { signature: 'x'.repeat(1001) }],
    ['0 style examples', { learningEmailCount: 0 }],
    ['21 style examples', { learningEmailCount: 21 }],
    ['a fractional count', { learningEmailCount: 2.5 }],
    ['an empty count', { learningEmailCount: null }],
  ])('rejects %s without calling the API', (_label, change) => {
    const component = create();
    component.form.patchValue(change);
    component.form.markAsDirty();

    component.save();

    expect(component.form.invalid).toBe(true);
    expect(api.updatePreferences).not.toHaveBeenCalled();
  });

  it('keeps the form and shows the error when saving fails', () => {
    api.updatePreferences.mockReturnValue(throwError(() => ({ status: 400, error: { error: 'signature must be a string of at most 1000 characters' } })));
    const component = create();
    component.form.patchValue({ signature: 'New' });
    component.form.markAsDirty();

    component.save();

    expect(component.saveError).toBe('signature must be a string of at most 1000 characters');
    expect(component.form.get('signature')?.value).toBe('New');
    expect(component.form.dirty).toBe(true);
    expect(component.isSaving).toBe(false);
  });

  it('falls back to formal when the stored tone is unknown', () => {
    api.getPreferences.mockReturnValue(of({ ...stored, defaultTone: 'shouting' }));
    expect(create().form.get('defaultTone')?.value).toBe('formal');
  });

  describe('leaving the page', () => {
    it('goes straight back without changes', () => {
      const confirm = confirmWith(true);
      const component = create(confirm);

      component.goBack();

      expect(confirm.confirm).not.toHaveBeenCalled();
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('asks before discarding changes, and stays if the user cancels', () => {
      const keep = confirmWith(false);
      const component = create(keep);
      component.form.patchValue({ signature: 'Changed' });
      component.form.markAsDirty();

      component.goBack();
      expect(keep.confirm).toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();

      const discard = confirmWith(true);
      const other = create(discard);
      other.form.markAsDirty();
      other.goBack();
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });
  });
});

describe('PreferenceService.updatePreferences', () => {
  it('PUTs only the given fields and returns the stored preferences', () => {
    const http = { put: vi.fn().mockReturnValue(of(stored)) };
    const service = new PreferenceService(http as any);
    let result: any;

    service.updatePreferences({ signature: 'Best,\nAna' }).subscribe((value) => (result = value));

    expect(http.put).toHaveBeenCalledWith('api/preferences', { signature: 'Best,\nAna' });
    expect(result).toEqual(stored);
  });
});
