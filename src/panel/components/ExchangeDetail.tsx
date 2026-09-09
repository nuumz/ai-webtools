import { useEffect, useState } from 'react';
import type { BodySnapshot, ExchangeMeta } from '../../shared/capture';
import type { HttpMethod } from '../../shared/types';
import type { RuleDraft } from './RuleForm';
import type { ExchangeBodies } from '../hooks/useNetworkLog';

interface Props {
  exchange: ExchangeMeta;
  bodies?: ExchangeBodies;
  onLoadBody: (exchangeId: string) => void;
  onCreateRule: (draft: RuleDraft) => void;
}

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export default function ExchangeDetail({ exchange, bodies, onLoadBody, onCreateRule }: Props) {
  const [matchQuery, setMatchQuery] = useState(exchange.search.length > 0);

  useEffect(() => {
    if (!bodies) onLoadBody(exchange.id);
  }, [bodies, exchange.id, onLoadBody]);

  // A bare-text pattern would substring-match the whole URL, so always emit a
  // pathname or a full URL — the latter when the query string is what differs.
  const urlPattern = matchQuery
    ? `${exchange.origin}${exchange.pathname}${exchange.search}`
    : exchange.pathname;

  const method: HttpMethod = METHODS.includes(exchange.method as HttpMethod)
    ? (exchange.method as HttpMethod)
    : 'ANY';

  const responsePayload = parseJson(bodies?.response?.text);

  const draft = (type: RuleDraft['type']): RuleDraft => ({
    type,
    method,
    urlPattern,
    payload: type === 'STUB' ? (responsePayload ?? {}) : {},
    ...(type === 'STUB' ? { status: exchange.status || 200 } : {}),
  });

  return (
    <div className="border-t border-gray-200 bg-slate-50 p-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-gray-500">
        <span>{exchange.durationMs} ms</span>
        <span>·</span>
        <span>{exchange.transport.toUpperCase()}</span>
        <span>·</span>
        <span>{exchange.contentType || 'unknown type'}</span>
        {exchange.outcome !== 'ok' && (
          <span className="text-red-600 font-semibold">{exchange.outcome}</span>
        )}
      </div>

      <BodyBlock title="Request" body={bodies?.request} />
      <BodyBlock title="Response" body={bodies?.response} />

      <label className="flex items-center gap-2 text-[11px] text-gray-600">
        <input type="checkbox" checked={matchQuery} onChange={(e) => setMatchQuery(e.target.checked)} />
        Match the query string too
      </label>
      <code className="block text-[11px] text-gray-500 break-all">{urlPattern}</code>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onCreateRule(draft('STUB'))}
          className="bg-slate-800 text-white rounded px-2.5 py-1.5 text-xs hover:bg-slate-700"
          disabled={bodies === undefined}
        >
          Stub this response
        </button>
        <button
          onClick={() => onCreateRule(draft('MUTATE_RESPONSE'))}
          className="border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white"
        >
          Mutate response
        </button>
        <button
          onClick={() => onCreateRule(draft('MUTATE_REQUEST'))}
          className="border border-slate-300 rounded px-2.5 py-1.5 text-xs text-slate-700 hover:bg-white"
        >
          Mutate request
        </button>
      </div>
    </div>
  );
}

function BodyBlock({ title, body }: { title: string; body?: BodySnapshot }) {
  if (!body || !body.text) {
    return (
      <div>
        <p className="text-[11px] font-semibold text-gray-500 mb-1">{title}</p>
        <p className="text-[11px] text-gray-400 italic">no body captured</p>
      </div>
    );
  }
  const parsed = parseJson(body.text);
  return (
    <div>
      <p className="text-[11px] font-semibold text-gray-500 mb-1">
        {title}
        {body.truncated && <span className="text-amber-600"> · truncated at 64 KB</span>}
        {body.redacted && <span className="text-indigo-600"> · redacted</span>}
      </p>
      <pre className="text-[11px] bg-white border border-gray-200 rounded p-2 overflow-x-auto max-h-40">
        {parsed !== undefined ? JSON.stringify(parsed, null, 2) : body.text}
      </pre>
    </div>
  );
}

function parseJson(text?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
