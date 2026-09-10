import { useState } from 'react';
import { IconChevron } from './icons';
import type { MutationRule } from '../../shared/types';

interface Props {
  rules: MutationRule[];
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (rule: MutationRule) => void;
}

const TYPE_LABEL: Record<MutationRule['type'], string> = {
  STUB: 'stub',
  MUTATE_RESPONSE: 'response',
  MUTATE_REQUEST: 'request',
};

export default function RuleList({ rules, onToggle, onDelete, onEdit }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (rules.length === 0) {
    return (
      <p className="empty">
        No rules yet.
        <br />
        Open a request in Network, then <span className="text-mute">Make rule</span>.
      </p>
    );
  }

  return (
    <div className="card overflow-hidden">
      {rules.map((rule, index) => {
        const open = openId === rule.id;
        // Timing and edits are settings; only a fault changes what the page gets.
        const notes = [
          rule.delayMs ? `${rule.delayMs} ms` : undefined,
          rule.jitterMs ? `±${rule.jitterMs} ms` : undefined,
          rule.ops?.length ? `${rule.ops.length} edit${rule.ops.length > 1 ? 's' : ''}` : undefined,
        ].filter(Boolean) as string[];
        const fault = rule.fault
          ? rule.fault.kind === 'status'
            ? `fails ${rule.fault.status}`
            : rule.fault.kind
          : undefined;

        return (
          <div key={rule.id} className={index > 0 ? 'border-t border-line' : undefined}>
            <div
              className={`flex items-center gap-2 px-2 py-1.5 ${rule.isActive ? '' : 'opacity-55'}`}
            >
              <input
                type="checkbox"
                checked={rule.isActive}
                onChange={() => onToggle(rule.id)}
                title={rule.isActive ? 'Active — click to pause' : 'Paused — click to activate'}
              />
              <span
                className={`chip w-[4.75rem] justify-center ${rule.type === 'STUB' ? 'chip-accent' : ''}`}
              >
                {TYPE_LABEL[rule.type]}
                {rule.type === 'STUB' && rule.status ? ` ${rule.status}` : ''}
              </span>
              <span className="log-cell w-9 font-semibold text-mute">{rule.method}</span>
              <button
                onClick={() => setOpenId(open ? null : rule.id)}
                className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-ink"
                title={rule.urlPattern}
              >
                {rule.urlPattern}
              </button>
              {notes.map((note) => (
                <span key={note} className="chip">
                  {note}
                </span>
              ))}
              {fault && <span className="chip chip-warn">{fault}</span>}
              <button
                onClick={() => setOpenId(open ? null : rule.id)}
                className="btn btn-sm btn-icon btn-ghost"
                aria-expanded={open}
                title={open ? 'Hide payload' : 'Show payload'}
              >
                <IconChevron className={`transition-transform ${open ? 'rotate-90' : ''}`} />
              </button>
            </div>

            {open && (
              <div className="space-y-2 border-t border-line bg-inset p-2">
                <p className="eyebrow m-0">
                  {rule.type === 'STUB' ? 'Returned as-is' : 'Merged into the payload'}
                </p>
                <pre className="code-block max-h-48">{JSON.stringify(rule.payload, null, 2)}</pre>
                <div className="flex justify-end gap-3">
                  <button onClick={() => onEdit(rule)} className="btn-link">
                    Edit rule
                  </button>
                  <button onClick={() => onDelete(rule.id)} className="btn-link btn-danger">
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
