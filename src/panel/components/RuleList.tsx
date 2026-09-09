import type React from 'react';
import type { MutationRule } from '../../shared/types';

interface Props {
  rules: MutationRule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (rule: MutationRule) => void;
}

const badgeFor = (rule: MutationRule) =>
  rule.type === 'STUB' ? 'STUB' : rule.type.replace('MUTATE_', '');

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="chip chip-warn">{children}</span>;
}

export default function RuleList({ rules, onToggle, onDelete, onEdit }: Props) {
  if (rules.length === 0) {
    return <p className="panel-empty">No rules yet — stub from Network or add one above.</p>;
  }

  return (
    <div className="space-y-2">
      {rules.map((rule) => (
        <div
          key={rule.id}
          className={`panel-card flex flex-col gap-2 p-3 ${rule.isActive ? '' : 'opacity-50'}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="chip">
              {rule.method} · {badgeFor(rule)}
              {rule.type === 'STUB' && rule.status ? ` · ${rule.status}` : ''}
            </span>
            <div className="flex items-center gap-3">
              <button onClick={() => onToggle(rule.id)} className="btn-link">
                {rule.isActive ? 'Disable' : 'Enable'}
              </button>
              <button onClick={() => onEdit(rule)} className="btn-link">
                Edit
              </button>
              <button onClick={() => onDelete(rule.id)} className="btn-link btn-danger">
                Delete
              </button>
            </div>
          </div>
          <code className="break-all font-mono text-[11px] text-mute">{rule.urlPattern}</code>
          {(rule.delayMs || rule.fault || rule.ops?.length) && (
            <div className="flex flex-wrap gap-1">
              {rule.delayMs ? <Chip>{rule.delayMs} ms</Chip> : null}
              {rule.fault && (
                <Chip>{rule.fault.kind === 'status' ? `fails ${rule.fault.status}` : rule.fault.kind}</Chip>
              )}
              {rule.ops?.length ? (
                <Chip>{rule.ops.length === 1 ? '1 edit' : `${rule.ops.length} edits`}</Chip>
              ) : null}
            </div>
          )}
          <pre className="code-block max-h-24">{JSON.stringify(rule.payload, null, 2)}</pre>
        </div>
      ))}
    </div>
  );
}
