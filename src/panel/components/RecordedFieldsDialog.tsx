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
    <div className="absolute inset-0 z-10 flex items-end bg-[oklch(8%_0.02_75/0.55)]" onClick={onCancel}>
      <div
        className="flex max-h-[75%] w-full flex-col rounded-t-[var(--radius-lg)] border border-b-0 border-line bg-surface shadow-[0_-12px_32px_oklch(0%_0_0/0.4)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line p-3">
          <h3 className="m-0 text-[13px] font-semibold text-ink">Fields found on the page</h3>
          <label className="flex items-center gap-1.5 text-[11px] text-mute">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => onToggleSecrets(event.target.checked)}
            />
            include passwords
          </label>
        </div>

        <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
          {fields.length === 0 ? (
            <p className="panel-empty">
              Nothing filled in on this page yet — type into the form first, then record.
            </p>
          ) : (
            fields.map((field, index) => (
              <label
                key={index}
                className="flex items-start gap-2 rounded-[var(--radius-md)] border border-line p-2 text-[11px]"
              >
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chosen.includes(index)}
                  onChange={() => toggle(index)}
                />
                <span className="min-w-0">
                  <span className="font-semibold text-ink">{field.label ?? 'field'}</span>
                  <span className="block truncate font-mono text-mute">
                    {describeSelector(field.selectors)}
                  </span>
                  <span className="block truncate text-faint">{field.value}</span>
                </span>
              </label>
            ))
          )}
        </div>

        <div className="flex gap-2 border-t border-line p-3">
          <button
            onClick={() => onAdd(chosen.map((index) => fields[index]).filter(Boolean))}
            disabled={chosen.length === 0}
            className="btn btn-primary flex-1 !h-9"
          >
            Add {chosen.length} field(s)
          </button>
          <button onClick={onCancel} className="btn btn-ghost !h-9">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
