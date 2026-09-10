import { useEffect, useState } from 'react';
import type { BodySnapshot, ExchangeMeta } from '../../shared/capture';
import type { HttpMethod } from '../../shared/types';
import type { RuleDraft } from './RuleForm';
import { durationColor, formatClock, formatDuration } from '../format';
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

  const urlPattern = matchQuery
    ? `${exchange.origin}${exchange.pathname}${exchange.search}`
    : exchange.pathname;

  const method: HttpMethod = METHODS.includes(exchange.method as HttpMethod)
    ? (exchange.method as HttpMethod)
    : 'ANY';

  const responsePayload = parseJson(bodies?.response?.text);
  // A truncated body is broken JSON: stubbing it would hand the app `{}` and the
  // page would die on the first field it reads. Say so instead of shipping it.
  const stubBlocked =
    bodies === undefined || responsePayload !== undefined
      ? undefined
      : bodies.response?.truncated
        ? `Response is ${formatBytes(bodies.response.bytes)} — over the capture limit, so only part of it was kept. Raise the limit in Settings and record it again.`
        : 'Response body is not JSON — nothing to stub';

  const draft = (type: RuleDraft['type']): RuleDraft => ({
    type,
    method,
    urlPattern,
    payload: type === 'STUB' ? (responsePayload ?? {}) : {},
    ...(type === 'STUB' ? { status: exchange.status || 200 } : {}),
  });

  return (
    <div className="space-y-3 border-t border-line bg-inset p-3">
      <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-faint">
        <span className="tabular-nums" title="Started">
          {formatClock(exchange.startedAt)}
        </span>
        <span aria-hidden>·</span>
        <span className={`tabular-nums font-semibold ${durationColor(exchange.durationMs)}`} title="Time to response">
          {formatDuration(exchange.durationMs)}
        </span>
        <span aria-hidden>·</span>
        <span>{exchange.transport.toUpperCase()}</span>
        <span aria-hidden>·</span>
        <span>{exchange.contentType || 'unknown type'}</span>
        {exchange.outcome !== 'ok' && exchange.outcome !== 'pending' && (
          <span className="font-semibold text-bad">{exchange.outcome}</span>
        )}
      </div>

      <BodyBlock title="Request" body={bodies?.request} />
      <BodyBlock title="Response" body={bodies?.response} />

      <label className="flex items-center gap-2 text-[11px] text-mute">
        <input type="checkbox" checked={matchQuery} onChange={(e) => setMatchQuery(e.target.checked)} />
        Match the query string too
      </label>
      <code className="block break-all font-mono text-[11px] text-faint">{urlPattern}</code>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onCreateRule(draft('STUB'))}
          className="btn btn-primary"
          disabled={bodies === undefined || stubBlocked !== undefined}
          title={stubBlocked}
        >
          Stub this response
        </button>
        <button onClick={() => onCreateRule(draft('MUTATE_RESPONSE'))} className="btn btn-ghost">
          Mutate response
        </button>
        <button onClick={() => onCreateRule(draft('MUTATE_REQUEST'))} className="btn btn-ghost">
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
        <p className="mb-1 text-[11px] font-semibold text-mute">{title}</p>
        <p className="m-0 text-[11px] italic text-faint">no body captured</p>
      </div>
    );
  }
  const parsed = parseJson(body.text);
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold text-mute">
        {title}
        {body.truncated && (
          <span className="text-warn"> · truncated — {formatBytes(body.bytes)} on the wire</span>
        )}
        {body.redacted && <span className="text-accent"> · redacted</span>}
      </p>
      <pre className="code-block max-h-40">
        {parsed !== undefined ? JSON.stringify(parsed, null, 2) : body.text}
      </pre>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function parseJson(text?: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
