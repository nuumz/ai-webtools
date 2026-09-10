import { useEffect, useState } from 'react';
import { IconClose } from './icons';
import { durationColor, formatClock, formatDuration } from '../format';
import type { BodySnapshot, ExchangeMeta } from '../../shared/capture';
import type { HttpMethod } from '../../shared/types';
import type { RuleDraft } from './RuleForm';
import type { ExchangeBodies } from '../hooks/useNetworkLog';

interface Props {
  exchange: ExchangeMeta;
  bodies?: ExchangeBodies;
  onLoadBody: (exchangeId: string) => void;
  onCreateRule: (draft: RuleDraft) => void;
  onClose: () => void;
}

type View = 'response' | 'request' | 'rule';

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const VIEWS: [View, string][] = [
  ['response', 'Response'],
  ['request', 'Request'],
  ['rule', 'Make rule'],
];

export default function ExchangeDetail({ exchange, bodies, onLoadBody, onCreateRule, onClose }: Props) {
  const [view, setView] = useState<View>('response');
  const [matchQuery, setMatchQuery] = useState(exchange.search.length > 0);

  useEffect(() => {
    if (!bodies) onLoadBody(exchange.id);
  }, [bodies, exchange.id, onLoadBody]);

  // A different row in the same pane starts over, or the pane keeps showing the
  // previous request's chosen view and query-match decision.
  useEffect(() => {
    setView('response');
    setMatchQuery(exchange.search.length > 0);
  }, [exchange.id, exchange.search]);

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
    <div>
      <header className="sticky top-0 z-10 flex h-9 items-center gap-2 border-b border-line bg-surface px-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={exchange.url}>
          <span className="font-semibold text-mute">{exchange.method}</span> {exchange.pathname}
          <span className="text-faint">{exchange.search}</span>
        </span>
        <div className="seg" role="tablist">
          {VIEWS.map(([id, label]) => (
            <button
              key={id}
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className="seg-item"
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={onClose} className="btn btn-sm btn-icon btn-ghost" title="Close (Esc)">
          <IconClose />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-inset px-2 py-1 font-mono text-[10.5px] text-faint">
        <span className="tabular-nums" title="Started at">
          {formatClock(exchange.startedAt)}
        </span>
        <span aria-hidden>·</span>
        <span className={`tabular-nums ${durationColor(exchange.durationMs)}`}>
          {formatDuration(exchange.durationMs)}
        </span>
        <span aria-hidden>·</span>
        <span>{exchange.transport.toUpperCase()}</span>
        <span aria-hidden>·</span>
        <span className="min-w-0 truncate">{exchange.contentType || 'unknown type'}</span>
        {exchange.outcome !== 'ok' && exchange.outcome !== 'pending' && (
          <span className="font-semibold text-bad">{exchange.outcome}</span>
        )}
      </div>

      <div className="p-2">
        {view === 'response' && <BodyBlock body={bodies?.response} loading={bodies === undefined} />}
        {view === 'request' && <BodyBlock body={bodies?.request} loading={bodies === undefined} />}
        {view === 'rule' && (
          <div className="space-y-2.5">
            <div>
              <p className="eyebrow m-0 mb-1">Matches</p>
              <code className="block break-all rounded-[var(--radius-md)] border border-line bg-inset px-2 py-1.5 font-mono text-[11px] text-mute">
                {method === 'ANY' ? '' : `${method} `}
                {urlPattern}
              </code>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-mute">
              <input
                type="checkbox"
                checked={matchQuery}
                onChange={(e) => setMatchQuery(e.target.checked)}
              />
              Include the query string
            </label>
            <div className="flex flex-wrap gap-1.5 border-t border-line pt-2.5">
              <button
                onClick={() => onCreateRule(draft('STUB'))}
                className="btn btn-sm btn-primary"
                disabled={bodies === undefined || stubBlocked !== undefined}
                title={stubBlocked}
              >
                Stub this response
              </button>
              <button
                onClick={() => onCreateRule(draft('MUTATE_RESPONSE'))}
                className="btn btn-sm btn-secondary"
              >
                Mutate response
              </button>
              <button
                onClick={() => onCreateRule(draft('MUTATE_REQUEST'))}
                className="btn btn-sm btn-secondary"
              >
                Mutate request
              </button>
            </div>
            {stubBlocked && <p className="m-0 text-[11px] leading-relaxed text-warn">{stubBlocked}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function BodyBlock({ body, loading }: { body?: BodySnapshot; loading: boolean }) {
  if (loading) return <p className="m-0 text-[11px] text-faint">Loading body…</p>;
  if (!body || !body.text) return <p className="m-0 text-[11px] text-faint">No body captured.</p>;

  const parsed = parseJson(body.text);
  return (
    <div className="space-y-1">
      {(body.truncated || body.redacted) && (
        <p className="m-0 text-[10.5px]">
          {body.truncated && (
            <span className="text-warn">truncated — {formatBytes(body.bytes)} on the wire</span>
          )}
          {body.truncated && body.redacted && <span className="text-faint"> · </span>}
          {body.redacted && <span className="text-accent">redacted</span>}
        </p>
      )}
      <pre className="code-block">
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
