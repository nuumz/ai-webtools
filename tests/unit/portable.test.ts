import { describe, expect, it } from 'vitest';
import { SCHEMA_VERSION, migrateState } from '../../src/shared/portable';

describe('migrateState', () => {
  it('fills in a complete shape from nothing', () => {
    const state = migrateState(undefined);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.mutationRules).toEqual([]);
    expect(state.formProfiles).toEqual([]);
    expect(state.stories).toEqual([]);
    expect(state.settings.enabled).toBe(true);
  });

  it('turns a day-one formFillFields export into a profile', () => {
    const state = migrateState({
      formFillFields: [{ selector: '#email', value: 'a@b.c' }],
    });
    expect(state.formProfiles).toHaveLength(1);
    expect(state.formProfiles[0].fields[0].selectors).toEqual([{ strategy: 'css', value: '#email' }]);
    expect(state.formProfiles[0].fields[0].source).toEqual({ kind: 'literal', value: 'a@b.c' });
  });

  it('prefers real profiles over the legacy list', () => {
    const state = migrateState({
      formProfiles: [{ id: 'p1', name: 'Kept', vars: {}, fields: [] }],
      formFillFields: [{ selector: '#email', value: 'a@b.c' }],
    });
    expect(state.formProfiles.map((profile) => profile.name)).toEqual(['Kept']);
  });

  it('drops malformed stories and defaults their parts', () => {
    const state = migrateState({
      stories: [
        { meta: { id: 's1', name: 'Good' } },
        { entries: [] },
        { meta: {} },
      ],
    });
    expect(state.stories).toHaveLength(1);
    expect(state.stories[0].entries).toEqual([]);
    expect(state.stories[0].bodies).toEqual({});
  });

  it('reads a file written before cases existed', () => {
    expect(migrateState({ formProfiles: [] }).formCases).toEqual([]);
  });

  it('keeps the cases a newer file carries', () => {
    const formCases = [{ id: 'cs_1', profileId: 'pf_1', name: 'minor', values: { middleName: '' } }];
    // The blank value is the point: a case that drops it cannot restore the form.
    expect(migrateState({ formCases }).formCases).toEqual(formCases);
  });

  it('carries where a case came from, and survives one that has no source', () => {
    const formCases = [
      {
        id: 'cs_1',
        profileId: 'pf_1',
        name: 'GET /api/customer',
        values: { first: 'กุลชรี' },
        from: { exchangeId: 'ex_1', method: 'GET', url: 'https://api/x', at: 1 },
        paths: { first: 'customer.names.0.first' },
      },
      // Written by hand, or by a build from before provenance existed.
      { id: 'cs_2', profileId: 'pf_1', name: 'blank', values: {} },
    ];
    expect(migrateState({ formCases }).formCases).toEqual(formCases);
  });

  it('normalizes settings from an older export', () => {
    const state = migrateState({ settings: { enabled: false } });
    expect(state.settings.enabled).toBe(false);
    expect(state.settings.captureEnabled).toBe(false);
    expect(state.settings.syncEnabled).toBe(false);
    expect(state.settings.lastProfileByOrigin).toEqual({});
  });
});
