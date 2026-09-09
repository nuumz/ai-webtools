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

  // A re-record replaces the list, so the old indices no longer mean anything.
  useEffect(() => setChosen(fields.map((_, index) => index)), [fields]);

  const toggle = (index: number) =>
    setChosen((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
    );

  return (
    <div className="absolute inset-0 bg-slate-900/40 flex items-end z-10" onClick={onCancel}>
      <div
        className="bg-white w-full max-h-[75%] rounded-t-lg shadow-lg flex flex-col"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-3 border-b flex items-center justify-between">
          <h3 className="font-semibold text-gray-700 text-sm">Fields found on the page</h3>
          <label className="flex items-center gap-1.5 text-[11px] text-gray-600">
            <input
              type="checkbox"
              checked={includeSecrets}
              onChange={(event) => onToggleSecrets(event.target.checked)}
            />
            include passwords
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {fields.length === 0 ? (
            <p className="text-xs text-gray-400 italic">
              Nothing filled in on this page yet — type into the form first, then record.
            </p>
          ) : (
            fields.map((field, index) => (
              <label key={index} className="flex items-start gap-2 text-[11px] border rounded p-1.5">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={chosen.includes(index)}
                  onChange={() => toggle(index)}
                />
                <span className="min-w-0">
                  <span className="font-semibold text-slate-700">{field.label ?? 'field'}</span>
                  <span className="block text-gray-500 font-mono truncate">
                    {describeSelector(field.selectors)}
                  </span>
                  <span className="block text-gray-400 truncate">{field.value}</span>
                </span>
              </label>
            ))
          )}
        </div>

        <div className="p-3 border-t flex gap-2">
          <button
            onClick={() => onAdd(chosen.map((index) => fields[index]).filter(Boolean))}
            disabled={chosen.length === 0}
            className="flex-1 bg-slate-800 text-white rounded py-1.5 text-xs hover:bg-slate-700 disabled:opacity-40"
          >
            Add {chosen.length} field(s)
          </button>
          <button onClick={onCancel} className="px-4 border rounded py-1.5 text-xs text-gray-600 hover:bg-gray-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
