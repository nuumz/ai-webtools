import { useState } from 'react';
import type { FormFillField } from '../../shared/types';

interface Props {
  fields: FormFillField[];
  onChange: (fields: FormFillField[]) => void;
}

export default function AutoFillCard({ fields, onChange }: Props) {
  const [open, setOpen] = useState(false);

  const update = (index: number, patch: Partial<FormFillField>) => {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <button
        onClick={() => setOpen((value) => !value)}
        className="w-full flex justify-between items-center font-semibold text-gray-700"
      >
        <span>Auto-Fill Fields</span>
        <span className="text-xs text-gray-400">{open ? 'Hide' : `${fields.length} field(s)`}</span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {fields.map((field, index) => (
            <div key={index} className="flex gap-2">
              <input
                className="border rounded p-1.5 font-mono text-xs flex-1 min-w-0"
                placeholder="#selector"
                value={field.selector}
                onChange={(e) => update(index, { selector: e.target.value })}
              />
              <input
                className="border rounded p-1.5 text-xs flex-1 min-w-0"
                placeholder="value"
                value={field.value}
                onChange={(e) => update(index, { value: e.target.value })}
              />
              <button
                className="text-red-600 text-xs px-1 hover:underline"
                onClick={() => onChange(fields.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            className="w-full border border-dashed border-gray-300 rounded py-1.5 text-xs text-gray-500 hover:bg-gray-50"
            onClick={() => onChange([...fields, { selector: '', value: '' }])}
          >
            + Add field
          </button>
        </div>
      )}
    </div>
  );
}
