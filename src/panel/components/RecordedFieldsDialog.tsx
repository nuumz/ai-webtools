import { useEffect, useState } from 'react';
import type { RecordedFieldInput } from '../../shared/form';
import { describeSelector } from '../../shared/form';

interface Props {
  fields: RecordedFieldInput[];
  includeSecrets: boolean;
  onToggleSecrets: (include: boolean) => void;
  onAdd: (selected: RecordedFieldInput[]) => void;
  onCancel: () => void;
}

export default function RecordedFieldsDialog({
  fields,
  includeSecrets,
  onToggleSecrets,
  onAdd,
  onCancel,
}: Props) {
  const [chosen, setChosen] = useState<number[]>([]);

  useEffect(() => setChosen(fields.map((_, index) => index)), [fields]);

  const toggle = (index: number) =>
    setChosen((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fields found on the page"
      className="absolute inset-0 z-30 flex items-end bg-[oklch(20%_0.02_260/0.45)]"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[75%] w-full flex-col rounded-t-[var(--radius-lg)] border border-b-0 border-line bg-surface shadow-[var(--shadow-float)]"
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

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {fields.length === 0 ? (
            <p className="empty">
              Nothing filled in on this page yet — type into the form first, then record.
            </p>
          ) : (
            fields.map((field, index) => (
              <label
                key={index}
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-line p-2 text-[11px] hover:border-line-strong"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chosen.includes(index)}
                  onChange={() => toggle(index)}
                />
                <span className="min-w-0">
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
              </label>
            ))
          )}
        </div>

        <div className="flex shrink-0 gap-1.5 border-t border-line p-2">
          <button
            onClick={() => onAdd(chosen.map((index) => fields[index]).filter(Boolean))}
            disabled={chosen.length === 0}
            className="btn btn-lg btn-primary flex-1"
          >
            Add {chosen.length} field{chosen.length === 1 ? '' : 's'}
          </button>
          <button onClick={onCancel} className="btn btn-lg btn-secondary">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
