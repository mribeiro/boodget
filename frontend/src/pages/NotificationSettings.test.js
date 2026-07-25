import { computeNotificationSettingsPatch, computeDossierOptIn } from './NotificationSettings.jsx';

describe('computeNotificationSettingsPatch', () => {
  it('maps checked=true to 1', () => {
    expect(computeNotificationSettingsPatch('enabled', true)).toEqual({ enabled: 1 });
  });

  it('maps checked=false to 0 (regression: used to always resolve truthy via the DOM event)', () => {
    expect(computeNotificationSettingsPatch('enabled', false)).toEqual({ enabled: 0 });
  });

  it('works for the repeat_enabled field too', () => {
    expect(computeNotificationSettingsPatch('repeat_enabled', false)).toEqual({ repeat_enabled: 0 });
    expect(computeNotificationSettingsPatch('repeat_enabled', true)).toEqual({ repeat_enabled: 1 });
  });
});

describe('computeDossierOptIn', () => {
  it('appends the dossier id when checked', () => {
    expect(computeDossierOptIn([1, 9], 5, true)).toEqual([1, 9, 5]);
  });

  it('removes the dossier id when unchecked (regression: used to append a duplicate instead)', () => {
    expect(computeDossierOptIn([1, 5, 9], 5, false)).toEqual([1, 9]);
  });

  it('is a no-op removal when the id is not present', () => {
    expect(computeDossierOptIn([1, 9], 5, false)).toEqual([1, 9]);
  });

  it('does not duplicate the id when checked twice (guards the original bug shape)', () => {
    const once = computeDossierOptIn([], 5, true);
    expect(once).toEqual([5]);
  });
});
