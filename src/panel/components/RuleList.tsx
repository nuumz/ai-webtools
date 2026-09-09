import type { MutationRule } from '../../shared/types';

interface Props {
  rules: MutationRule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (rule: MutationRule) => void;
}

const badgeFor = (rule: MutationRule) =>
  rule.type === 'STUB' ? 'STUB' : rule.type.replace('MUTATE_', '');

export default function RuleList({ rules, onToggle, onDelete, onEdit }: Props) {
  if (rules.length === 0) {
    return <p className="text-gray-400 text-center italic mt-10">No rules yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`border rounded-md p-3 flex flex-col gap-2 shadow-sm transition-opacity ${
            rule.isActive ? 'bg-white' : 'opacity-50 bg-gray-100'
          }`}
        >
          <div className="flex justify-between items-center gap-2">
            <span className="text-xs font-bold text-slate-800 bg-slate-200 px-2 py-1 rounded">
              {rule.method} • {badgeFor(rule)}
              {rule.type === 'STUB' && rule.status ? ` • ${rule.status}` : ''}
            </span>
            <div className="flex gap-2">
              <button onClick={() => onToggle(rule.id)} className="text-blue-600 hover:underline text-xs">
                {rule.isActive ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => onEdit(rule)} className="text-slate-600 hover:underline text-xs">
                Edit
              </button>
              <button onClick={() => onDelete(rule.id)} className="text-red-600 hover:underline text-xs">
                Delete
              </button>
            </div>
          </div>
          <code className="text-xs text-gray-600 break-all">{rule.urlPattern}</code>
          <pre className="text-[11px] text-gray-500 bg-slate-50 rounded p-2 overflow-x-auto max-h-24">
            {JSON.stringify(rule.payload, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
