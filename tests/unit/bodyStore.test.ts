import { beforeEach, describe, expect, it } from 'vitest';
import { collectGarbage } from '../../src/shared/bodyStore';

/** Enough of chrome.storage.local for the garbage collector to walk. */
function fakeStorage(initial: Record<string, unknown>) {
  const data = { ...initial };
  return {
    data,
    api: {
      get: async (keys: string | string[] | null) => {
        if (keys === null) return { ...data };
        const list = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(list.filter((key) => key in data).map((key) => [key, data[key]]));
      },
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
      remove: async (keys: string | string[]) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key];
      },
    },
  };
}

describe('collectGarbage', () => {
  let store: ReturnType<typeof fakeStorage>;

  const install = (initial: Record<string, unknown>) => {
    store = fakeStorage(initial);
    (globalThis as Record<string, unknown>).chrome = { storage: { local: store.api } };
  };

  beforeEach(() => {
    delete (globalThis as Record<string, unknown>).chrome;
  });

  it('keeps a body a stub rule still replays after its story is gone', async () => {
    install({
      mutationRules: [{ id: 'rl_1', bodyKeys: ['kept'] }],
      'body:kept': '{"a":1}',
      'body:orphan': '{"b":2}',
    });

    expect(await collectGarbage(new Set())).toBe(1);
    expect(store.data['body:kept']).toBe('{"a":1}');
    expect(store.data['body:orphan']).toBeUndefined();
  });

  it('deletes a body nothing references', async () => {
    install({ mutationRules: [], 'body:orphan': '{}' });

    expect(await collectGarbage(new Set())).toBe(1);
    expect(store.data['body:orphan']).toBeUndefined();
  });
});
