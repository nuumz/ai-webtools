import { describe, expect, it } from 'vitest';
import { applyOps, getPath, parsePath, type PathOp } from '../../src/shared/pathOps';

const source = () => ({
  status: 'PENDING',
  data: {
    items: [
      { sku: 'a', price: 100, inStock: true },
      { sku: 'b', price: 200, inStock: true },
    ],
    total: 300,
  },
});

describe('parsePath', () => {
  it('reads keys, indices and wildcards', () => {
    expect(parsePath('data.items[0].price')).toEqual([
      { kind: 'key', key: 'data' },
      { kind: 'key', key: 'items' },
      { kind: 'index', index: 0 },
      { kind: 'key', key: 'price' },
    ]);
    expect(parsePath('items[*]')).toEqual([{ kind: 'key', key: 'items' }, { kind: 'wildcard' }]);
  });
});

describe('applyOps', () => {
  it('is the identity without ops', () => {
    const input = source();
    expect(applyOps(input)).toBe(input);
    expect(applyOps(input, [])).toBe(input);
  });

  it('sets one array element without touching its siblings', () => {
    const result = applyOps(source(), [{ op: 'set', path: 'data.items[0].price', value: 0 }]) as ReturnType<typeof source>;
    expect(result.data.items[0].price).toBe(0);
    expect(result.data.items[1].price).toBe(200);
  });

  it('never mutates the input', () => {
    const input = source();
    applyOps(input, [{ op: 'set', path: 'data.items[0].price', value: 0 }]);
    expect(input.data.items[0].price).toBe(100);
  });

  it('applies a wildcard to every element', () => {
    const result = applyOps(source(), [{ op: 'set', path: 'data.items[*].inStock', value: false }]) as ReturnType<typeof source>;
    expect(result.data.items.map((item) => item.inStock)).toEqual([false, false]);
  });

  it('deletes keys and array elements', () => {
    const withoutTotal = applyOps(source(), [{ op: 'delete', path: 'data.total' }]) as { data: object };
    expect('total' in withoutTotal.data).toBe(false);

    const withoutFirst = applyOps(source(), [{ op: 'delete', path: 'data.items[0]' }]) as ReturnType<typeof source>;
    expect(withoutFirst.data.items.map((item) => item.sku)).toEqual(['b']);
  });

  it('appends, merges and copies', () => {
    const appended = applyOps(source(), [
      { op: 'append', path: 'data.items', value: { sku: 'c', price: 50 } },
    ]) as ReturnType<typeof source>;
    expect(appended.data.items).toHaveLength(3);

    const merged = applyOps(source(), [
      { op: 'merge', path: 'data.items[1]', value: { price: 5, note: 'sale' } },
    ]) as { data: { items: { sku: string; price: number; note?: string }[] } };
    expect(merged.data.items[1]).toEqual({ sku: 'b', price: 5, inStock: true, note: 'sale' });

    const copied = applyOps(source(), [{ op: 'copy', from: 'data.items[1].price', path: 'data.total' }]) as ReturnType<typeof source>;
    expect(copied.data.total).toBe(200);
  });

  it('creates missing containers on the way to a set', () => {
    const result = applyOps({}, [{ op: 'set', path: 'meta.flags[0]', value: 'x' }]);
    expect(result).toEqual({ meta: { flags: ['x'] } });
  });

  it('applies ops in order', () => {
    const result = applyOps(source(), [
      { op: 'set', path: 'status', value: 'APPROVED' },
      { op: 'copy', from: 'status', path: 'data.echo' },
    ]) as { data: { echo: string } };
    expect(result.data.echo).toBe('APPROVED');
  });

  it('survives a path that does not resolve', () => {
    const result = applyOps(source(), [
      { op: 'delete', path: 'nothing.here[3]' },
      { op: 'set', path: 'status', value: 'DONE' },
    ]) as ReturnType<typeof source>;
    expect(result.status).toBe('DONE');
  });
});

describe('getPath', () => {
  it('reads through indices and returns undefined for misses', () => {
    expect(getPath(source(), 'data.items[1].sku')).toBe('b');
    expect(getPath(source(), 'data.missing.deep')).toBeUndefined();
  });
});

const _typecheck: PathOp[] = [{ op: 'set', path: 'a', value: 1 }];
void _typecheck;
