import { useEffect, useState } from 'react';
import type { PathOp } from '../../shared/pathOps';
import type { HttpMethod, MutationRule, RuleType } from '../../shared/types';

export type RuleDraft = Omit<MutationRule, 'id' | 'isActive'>;

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'MUTATE_RESPONSE', label: 'Mutate Response' },
  { value: 'MUTATE_REQUEST', label: 'Mutate Request (Payload)' },
  { value: 'STUB', label: 'Full Stub (No Network)' },
];

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

type FaultKind = 'none' | 'status' | 'network-error' | 'timeout';

interface Props {
  editing?: MutationRule;
  /** Prefilled from a captured exchange; a new object identity re-hydrates the form. */
  initialDraft?: RuleDraft;
  onSubmit: (draft: RuleDraft) => void;
  onCancel?: () => void;
}

export default function RuleForm({ editing, initialDraft, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<RuleType>('MUTATE_RESPONSE');
  const [method, setMethod] = useState<HttpMethod>('ANY');
  const [urlPattern, setUrlPattern] = useState('/api/users/*');
  const [status, setStatus] = useState('200');
  const [payloadJson, setPayloadJson] = useState('{\n  "role": "ADMIN"\n}');
  const [error, setError] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [delayMs, setDelayMs] = useState('');
  const [jitterMs, setJitterMs] = useState('');
  const [faultKind, setFaultKind] = useState<FaultKind>('none');
  const [faultStatus, setFaultStatus] = useState('500');
  const [opsJson, setOpsJson] = useState('');

  useEffect(() => {
    if (!editing) return;
    hydrate(editing);
  }, [editing]);

  useEffect(() => {
    if (!initialDraft) return;
    hydrate(initialDraft);
  }, [initialDraft]);

  function hydrate(source: RuleDraft) {
    setType(source.type);
    setMethod(source.method);
    setUrlPattern(source.urlPattern);
    setStatus(String(source.status ?? 200));
    setPayloadJson(JSON.stringify(source.payload ?? {}, null, 2));
    // Round-trip the advanced fields too, or editing a rule silently clears them.
    setDelayMs(source.delayMs ? String(source.delayMs) : '');
    setJitterMs(source.jitterMs ? String(source.jitterMs) : '');
    setFaultKind(source.fault?.kind ?? 'none');
    setFaultStatus(String(source.fault?.kind === 'status' ? source.fault.status : 500));
    setOpsJson(source.ops && source.ops.length > 0 ? JSON.stringify(source.ops, null, 2) : '');
    setAdvanced(Boolean(source.delayMs || source.jitterMs || source.fault || source.ops?.length));
    setError(null);
  }

  const handleSubmit = () => {
    if (!urlPattern.trim()) {
      setError('A URL pattern is required.');
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(payloadJson);
    } catch {
      setError('Invalid JSON in payload.');
      return;
    }
    let ops: PathOp[] | undefined;
    if (opsJson.trim()) {
      try {
        const parsed: unknown = JSON.parse(opsJson);
        if (!Array.isArray(parsed)) throw new Error('not an array');
        ops = parsed as PathOp[];
      } catch {
        setError('Edits must be a JSON array of operations.');
        return;
      }
    }

    setError(null);
    onSubmit({
      type,
      method,
      urlPattern: urlPattern.trim(),
      payload,
      ...(type === 'STUB' ? { status: Number(status) || 200 } : {}),
      ...(Number(delayMs) > 0 ? { delayMs: Number(delayMs) } : {}),
      ...(Number(jitterMs) > 0 ? { jitterMs: Number(jitterMs) } : {}),
      ...(ops && ops.length > 0 ? { ops } : {}),
      ...(faultKind === 'none'
        ? {}
        : {
            fault:
              faultKind === 'status'
                ? { kind: 'status' as const, status: Number(faultStatus) || 500 }
                : { kind: faultKind },
          }),
    });
    if (!editing) setUrlPattern('/api/*');
  };

  return (
    <div className="panel-card mb-3 p-3.5">
      <h2 className="mb-3 border-b border-line pb-2 text-[13px] font-semibold">
        {editing ? 'Edit rule' : 'New rule'}
      </h2>

      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            className="field flex-1"
            value={type}
            onChange={(e) => setType(e.target.value as RuleType)}
          >
            {RULE_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            className="field w-24"
            value={method}
            onChange={(e) => setMethod(e.target.value as HttpMethod)}
          >
            {METHODS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          placeholder="/api/v1/users/* (supports URLPattern)"
          className="field field-mono"
          value={urlPattern}
          onChange={(e) => setUrlPattern(e.target.value)}
        />

        {type === 'STUB' && (
          <label className="flex items-center gap-2 text-[12px] text-mute">
            <span className="font-medium">Status code</span>
            <input
              type="number"
              className="field field-mono field-sm w-24"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </label>
        )}

        <div>
          <label className="mb-1 block text-[11px] font-medium text-mute">
            {type === 'STUB' ? 'Payload (returned as-is)' : 'Payload (JSON to merge/override)'}
          </label>
          <textarea
            className="field field-mono field-area"
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.target.value)}
            spellCheck={false}
          />
        </div>

        <button onClick={() => setAdvanced((open) => !open)} className="btn-link">
          {advanced ? '▾' : '▸'} Timing, failures and field edits
        </button>

        {advanced && (
          <div className="space-y-2 rounded-[var(--radius-md)] border border-line bg-inset p-2.5">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
              <label className="flex items-center gap-1">
                delay
                <input
                  type="number"
                  className="field field-sm w-20"
                  value={delayMs}
                  onChange={(e) => setDelayMs(e.target.value)}
                  placeholder="0"
                />
                ms
              </label>
              <label className="flex items-center gap-1">
                ± jitter
                <input
                  type="number"
                  className="field field-sm w-20"
                  value={jitterMs}
                  onChange={(e) => setJitterMs(e.target.value)}
                  placeholder="0"
                />
                ms
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-mute">
              <span>fail with</span>
              <select
                className="field field-sm !w-auto"
                value={faultKind}
                onChange={(e) => setFaultKind(e.target.value as FaultKind)}
              >
                <option value="none">nothing — respond normally</option>
                <option value="status">an error status</option>
                <option value="network-error">a network error</option>
                <option value="timeout">a request that never answers</option>
              </select>
              {faultKind === 'status' && (
                <input
                  type="number"
                  className="field field-sm w-20"
                  value={faultStatus}
                  onChange={(e) => setFaultStatus(e.target.value)}
                />
              )}
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-faint">
                Field edits — JSON array, e.g.{' '}
                <code className="font-mono">{`[{"op":"set","path":"items[0].price","value":0}]`}</code>
              </label>
              <textarea
                className="field field-mono field-area !min-h-[5rem]"
                value={opsJson}
                onChange={(e) => setOpsJson(e.target.value)}
                spellCheck={false}
                placeholder="[]"
              />
            </div>
          </div>
        )}

        {error && <p className="m-0 text-[12px] text-bad">{error}</p>}

        <div className="flex gap-2">
          <button onClick={handleSubmit} className="btn btn-primary flex-1 !h-9">
            {editing ? 'Update rule' : 'Save rule'}
          </button>
          {onCancel && (
            <button onClick={onCancel} className="btn btn-ghost !h-9">
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
