import { useEffect, useMemo, useRef, useState } from 'react';
import type { RecordedFieldInput } from '../../shared/form';
import { describeSelector } from '../../shared/form';
import { IconSearch } from './icons';

interface Props {
  fields: RecordedFieldInput[];
  includeSecrets: boolean;
  onToggleSecrets: (include: boolean) => void;
  onAdd: (selected: RecordedFieldInput[]) => void;
  onCancel: () => void;
}

type OriginFilter = 'all' | 'control' | 'text';

/** `groupOf` always names a group, so the empty string can stand for all of them. */
const ALL_GROUPS = '';

/** Anything a recording did not mark is a real control — that is the older shape. */
const originOf = (field: RecordedFieldInput): 'control' | 'text' => field.origin ?? 'control';

/** Forms first, then the block a field sits in; a page with neither has one group. */
const groupOf = (field: RecordedFieldInput): string =>
  field.form ?? field.section ?? 'Elsewhere on the page';

/** Everything the row puts on screen, so the filter matches what the eye reads. */
const displayText = (field: RecordedFieldInput): string =>
  [
    field.label ?? '',
    field.anchor?.text ?? '',
    groupOf(field),
    describeSelector(field.selectors),
    field.value,
  ]
    .join('\n')
    .toLowerCase();

/** The shown rows between two of them, both ends included. */
const between = (order: number[], from: number, to: number): number[] => {
  const start = order.indexOf(from);
  const end = order.indexOf(to);
  if (start === -1 || end === -1) return [to];
  return order.slice(Math.min(start, end), Math.max(start, end) + 1);
};

export default function RecordedFieldsDialog({
  fields,
  includeSecrets,
  onToggleSecrets,
  onAdd,
  onCancel,
}: Props) {
  const [chosen, setChosen] = useState<ReadonlySet<number>>(() => new Set());
  const [query, setQuery] = useState('');
  const [origin, setOrigin] = useState<OriginFilter>('all');
  const [group, setGroup] = useState(ALL_GROUPS);
  /*
   * A label forwards its click to the checkbox and the forwarded event carries
   * no modifier state, so `onChange` can never see shift. The row takes it from
   * the gesture that caused the change instead.
   */
  const shiftHeld = useRef(false);
  const lastTouched = useRef<number | null>(null);

  // A fresh recording starts fully selected, and carrying the previous filters
  // over would hide rows the user never chose to hide.
  useEffect(() => {
    setChosen(new Set(fields.map((_, index) => index)));
    setQuery('');
    setOrigin('all');
    setGroup(ALL_GROUPS);
    lastTouched.current = null;
  }, [fields]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const field of fields) {
      const name = groupOf(field);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts];
  }, [fields]);

  // Both filters are offered only when the page really has both kinds: on an
  // ordinary form they would be controls that can change nothing.
  const mixedOrigins =
    fields.some((field) => originOf(field) === 'text') &&
    fields.some((field) => originOf(field) === 'control');

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      fields.flatMap((field, index) => {
        if (origin !== 'all' && originOf(field) !== origin) return [];
        if (group !== ALL_GROUPS && groupOf(field) !== group) return [];
        if (needle && !displayText(field).includes(needle)) return [];
        return [index];
      }),
    [fields, origin, group, needle],
  );

  const sections = useMemo(() => {
    const byGroup = new Map<string, number[]>();
    for (const index of visible) {
      const name = groupOf(fields[index]);
      const rows = byGroup.get(name);
      if (rows) rows.push(index);
      else byGroup.set(name, [index]);
    }
    return [...byGroup];
  }, [fields, visible]);

  /*
   * The list paints group by group, so the rows between two of them on screen
   * are not the rows between them in document order. Every selection that
   * means "these rows" — a shift range, All/None/Invert — walks this order,
   * the one the user is looking at.
   */
  const shown = useMemo(() => sections.flatMap(([, rows]) => rows), [sections]);

  const setMany = (indexes: number[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const index of indexes) {
        if (on) next.add(index);
        else next.delete(index);
      }
      return next;
    });

  const invert = (indexes: number[]) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const index of indexes) {
        if (current.has(index)) next.delete(index);
        else next.add(index);
      }
      return next;
    });

  const toggle = (index: number) => {
    const on = !chosen.has(index);
    /*
     * Shift extends from the last row touched over the rows the list is
     * *showing*, in the order it shows them — never over the ones a filter
     * hid, or one gesture in a filtered view would drag in fields the user
     * cannot see.
     *
     * The span is worked out here and not inside the updater, because React
     * runs an updater later — by then `lastTouched` is already this row.
     */
    const from = shiftHeld.current ? lastTouched.current : null;
    const span = from === null || from === index ? [index] : between(shown, from, index);
    lastTouched.current = index;
    setMany(span, on);
  };

  const filtered = visible.length !== fields.length;
  const clearFilters = () => {
    setQuery('');
    setOrigin('all');
    setGroup(ALL_GROUPS);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fields found on the page"
      className="absolute inset-0 z-30 flex items-end bg-[oklch(20%_0.02_260/0.45)]"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[85%] w-full flex-col rounded-t-[var(--radius-lg)] border border-b-0 border-line bg-surface shadow-[var(--shadow-float)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="toolbar rounded-t-[var(--radius-lg)]">
          <h3 className="m-0 flex-1 text-[12px] font-semibold text-ink">Fields found on the page</h3>
          <label className="flex items-center gap-1.5 text-[11px] text-mute">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => onToggleSecrets(event.target.checked)}
            />
            include passwords
          </label>
        </div>

        {fields.length > 0 && (
          <>
            <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
              <div className="relative min-w-0 flex-1">
                <IconSearch className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
                <input
                  className="field field-sm !pl-7"
                  placeholder="Filter by label, value or selector"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <span
                className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint"
                title={`${chosen.size} of ${fields.length} selected`}
              >
                {chosen.size}/{fields.length}
              </span>
            </div>

            {(mixedOrigins || groups.length > 1) && (
              <div className="flex shrink-0 items-center gap-1.5 border-b border-line px-2 py-1.5">
                {mixedOrigins && (
                  <div className="seg shrink-0">
                    {(
                      [
                        ['all', 'All', 'Everything the page answered with'],
                        ['control', 'Fields', 'Real form controls — input, select, textarea'],
                        ['text', 'Text', 'Widgets read off the page, with no form control behind them'],
                      ] as [OriginFilter, string, string][]
                    ).map(([value, label, hint]) => (
                      <button
                        key={value}
                        aria-selected={origin === value}
                        onClick={() => setOrigin(value)}
                        className="seg-item"
                        title={hint}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
                {groups.length > 1 && (
                  <select
                    className="field field-sm min-w-0 flex-1"
                    value={group}
                    onChange={(event) => setGroup(event.target.value)}
                    title="Only the fields of one form or block"
                    aria-label="Form or block"
                  >
                    <option value={ALL_GROUPS}>All forms ({fields.length})</option>
                    {groups.map(([name, count]) => (
                      <option key={name} value={name}>
                        {name} ({count})
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}

            <div className="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5">
              <button
                onClick={() => setMany(shown, true)}
                disabled={shown.length === 0}
                className="btn btn-sm btn-ghost"
                title="Select every row shown"
              >
                All
              </button>
              <button
                onClick={() => setMany(shown, false)}
                disabled={shown.length === 0}
                className="btn btn-sm btn-ghost"
                title="Clear every row shown"
              >
                None
              </button>
              <button
                onClick={() => invert(shown)}
                disabled={shown.length === 0}
                className="btn btn-sm btn-ghost"
                title="Flip every row shown"
              >
                Invert
              </button>
              <span className="min-w-0 flex-1 truncate text-right text-[10.5px] text-faint">
                {filtered ? `${visible.length} of ${fields.length} shown` : 'Shift-click for a range'}
              </span>
            </div>
          </>
        )}

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {fields.length === 0 ? (
            <p className="empty">
              Nothing filled in on this page yet — type into the form first, then record.
            </p>
          ) : visible.length === 0 ? (
            <p className="empty">
              No field matches these filters.{' '}
              <button onClick={clearFilters} className="btn btn-link">
                Clear them
              </button>
            </p>
          ) : (
            sections.map(([name, rows]) => {
              const inGroup = rows.filter((index) => chosen.has(index)).length;
              return (
                <div key={name} className="space-y-1.5">
                  {/* One group is the whole list: naming it adds a header and no choice. */}
                  {sections.length > 1 && (
                    <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-surface py-1">
                      <span className="eyebrow min-w-0 flex-1 truncate" title={name}>
                        {name}
                      </span>
                      <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                        {inGroup}/{rows.length}
                      </span>
                      <button
                        onClick={() => setMany(rows, inGroup < rows.length)}
                        className="btn btn-sm btn-ghost shrink-0"
                      >
                        {inGroup < rows.length ? 'All' : 'None'}
                      </button>
                    </div>
                  )}

                  {rows.map((index) => {
                    const field = fields[index];
                    const picked = chosen.has(index);
                    return (
                      <label
                        key={index}
                        onMouseDown={(event) => {
                          shiftHeld.current = event.shiftKey;
                        }}
                        onKeyDown={(event) => {
                          shiftHeld.current = event.shiftKey;
                        }}
                        className={`flex select-none items-start gap-2 rounded-[var(--radius-md)] border p-2 text-[11px] ${
                          picked ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={picked}
                          onChange={() => toggle(index)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold text-ink">{field.label ?? 'field'}</span>
                          {field.anchor && (
                            <span className="ml-1.5 text-faint">in “{field.anchor.text}”</span>
                          )}
                          <span className="block truncate font-mono text-mute">
                            {describeSelector(field.selectors)}
                          </span>
                          {/* A field left blank is part of the case, not a gap in it. */}
                          <span className="block truncate text-faint">
                            {field.value === '' ? <em>left blank</em> : field.value}
                          </span>
                        </span>
                        {originOf(field) === 'text' && (
                          <span
                            className="chip shrink-0"
                            title="Read off the page — no form control behind it"
                          >
                            text
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex shrink-0 gap-1.5 border-t border-line p-2">
          <button
            onClick={() => onAdd(fields.filter((_, index) => chosen.has(index)))}
            disabled={chosen.size === 0}
            className="btn btn-lg btn-primary flex-1"
          >
            Add {chosen.size} field{chosen.size === 1 ? '' : 's'}
          </button>
          <button onClick={onCancel} className="btn btn-lg btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
