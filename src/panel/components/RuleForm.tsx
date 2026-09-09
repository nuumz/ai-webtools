import { useEffect, useState } from 'react';
import type { HttpMethod, MutationRule, RuleType } from '../../shared/types';

export type RuleDraft = Omit<MutationRule, 'id' | 'isActive'>;

const RULE_TYPES: { value: RuleType; label: string }[] = [
  { value: 'MUTATE_RESPONSE', label: 'Mutate Response' },
  { value: 'MUTATE_REQUEST', label: 'Mutate Request (Payload)' },
  { value: 'STUB', label: 'Full Stub (No Network)' },
];

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

interface Props {
  editing?: MutationRule;
  onSubmit: (draft: RuleDraft) => void;
  onCancel?: () => void;
}

export default function RuleForm({ editing, onSubmit, onCancel }: Props) {
  const [type, setType] = useState<RuleType>('MUTATE_RESPONSE');
  const [method, setMethod] = useState<HttpMethod>('ANY');
  const [urlPattern, setUrlPattern] = useState('/api/users/*');
  const [status, setStatus] = useState('200');
  const [payloadJson, setPayloadJson] = useState('{\n  "role": "ADMIN"\n}');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    setType(editing.type);
    setMethod(editing.method);
    setUrlPattern(editing.urlPattern);
    setStatus(String(editing.status ?? 200));
    setPayloadJson(JSON.stringify(editing.payload ?? {}, null, 2));
    setError(null);
  }, [editing]);

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
    setError(null);
    onSubmit({
      type,
      method,
      urlPattern: urlPattern.trim(),
      payload,
      ...(type === 'STUB' ? { status: Number(status) || 200 } : {}),
    });
    if (!editing) setUrlPattern('/api/*');
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <h2 className="font-semibold text-gray-700 mb-3 border-b pb-2">
        {editing ? 'Edit Rule' : 'Add New Rule'}
      </h2>

      <div className="space-y-3">
        <div className="flex gap-2">
          <select
            className="border rounded p-2 bg-gray-50 text-gray-700 flex-1"
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
            className="border rounded p-2 bg-gray-50 text-gray-700 w-24"
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
          className="w-full border rounded p-2 font-mono text-xs"
          value={urlPattern}
          onChange={(e) => setUrlPattern(e.target.value)}
        />

        {type === 'STUB' && (
          <label className="flex items-center gap-2 text-xs text-gray-500">
            <span className="font-semibold">Status code</span>
            <input
              type="number"
              className="border rounded p-1.5 w-24 font-mono"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            />
          </label>
        )}

        <div>
          <label className="text-xs text-gray-500 font-semibold mb-1 block">
            {type === 'STUB' ? 'Payload (returned as-is)' : 'Payload (JSON to merge/override)'}
          </label>
          <textarea
            className="w-full border rounded p-2 font-mono text-xs h-32 bg-slate-50"
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.target.value)}
            spellCheck={false}
          />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            className="flex-1 bg-slate-800 text-white rounded py-2 hover:bg-slate-700 font-medium transition"
          >
            {editing ? 'Update Rule' : 'Save Rule'}
          </button>
          {editing && onCancel && (
            <button
              onClick={onCancel}
              className="px-4 border border-gray-300 rounded py-2 text-gray-600 hover:bg-gray-100 transition"
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
