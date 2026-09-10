import { useEffect, useState } from 'react';
import { IconClose } from './icons';
import { durationColor, formatClock, formatDuration } from '../format';
import type { BodySnapshot, ExchangeMeta } from '../../shared/capture';
import type { HttpMethod } from '../../shared/types';
import type { RuleDraft } from './RuleForm';
import type { ExchangeBodies } from '../hooks/useNetworkLog';
import { caseFromPayload } from '../../shared/payloadCase';
import type { FormCase, FormProfile } from '../../shared/form';

interface Props {
  exchange: ExchangeMeta;
  bodies?: ExchangeBodies;
  profiles: FormProfile[];
  onLoadBody: (exchangeId: string) => void;
  onCreateRule: (draft: RuleDraft) => void;
  onSaveCase: (formCase: FormCase) => void;
  onClose: () => void;
}

type View = 'response' | 'request' | 'rule' | 'case';

const METHODS: HttpMethod[] = ['ANY', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

// Nouns, and short ones: four segments have to fit a 400px panel, and a verb
// bought nothing that the panel each one opens does not already say.
const VIEWS: [View, string][] = [
  ['response', 'Response'],
  ['request', 'Request'],
  ['rule', 'Rule'],
  ['case', 'Case'],
];

export default function ExchangeDetail({
  exchange,
  bodies,
  profiles,
  onLoadBody,
  onCreateRule,
  onSaveCase,
  onClose,
}: Props) {
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
        {view === 'case' && (
          <PayloadCase
            key={exchange.id}
            profiles={profiles}
            payload={responsePayload}
            loading={bodies === undefined}
            defaultName={`${exchange.method} ${exchange.pathname}`}
            onSave={onSaveCase}
          />
        )}
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

/**
 * Turns a captured response into a case, once. A live binding would be smaller
 * to build and wrong to use: a fixture that changes when a new response is
 * recorded has stopped being a test case.
 *
 * The count is the headline because picking the wrong exchange is the mistake
 * this screen exists to catch — three of fifteen fields matched is not a thin
 * payload, it is the wrong request, and nothing else on the screen says so.
 */
function PayloadCase({
  profiles,
  payload,
  loading,
  defaultName,
  onSave,
}: {
  profiles: FormProfile[];
  payload: unknown;
  loading: boolean;
  defaultName: string;
  onSave: (formCase: FormCase) => void;
}) {
  const [profileId, setProfileId] = useState(profiles[0]?.id);
  const [name, setName] = useState(defaultName);
  const [saved, setSaved] = useState(false);

  const profile = profiles.find((entry) => entry.id === profileId);

  if (loading) return <p className="empty !py-4">Reading the response…</p>;
  if (payload === undefined) {
    return (
      <p className="empty !py-4">
        This response is not JSON, so there are no values to lift out of it.
      </p>
    );
  }
  if (profiles.length === 0 || !profile) {
    return (
      <p className="empty !py-4">
        A case needs a profile to belong to — the selectors live there, and only the values come
        from this response. Make one in the Fill tab first.
      </p>
    );
  }

  const { formCase, match } = caseFromPayload(profile, payload, name.trim() || defaultName);
  const total = profile.fields.length;
  // Fewer than half is the shape of a wrong pick, not of a sparse response.
  const thin = total > 0 && match.matched.length * 2 < total;

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5">
        <select
          className="field field-sm min-w-0 flex-1"
          value={profileId ?? ''}
          onChange={(e) => {
            setProfileId(e.target.value);
            setSaved(false);
          }}
          aria-label="Profile this case belongs to"
        >
          {profiles.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </div>

      <input
        className="field field-sm w-full"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
        placeholder="Case name"
        aria-label="Case name"
      />

      <p className={`m-0 text-[12px] ${thin ? 'text-warn' : 'text-ink'}`}>
        <span className="font-semibold tabular-nums">{match.matched.length}</span> of{' '}
        <span className="tabular-nums">{total}</span> field{total === 1 ? '' : 's'} matched
        {thin && ' — that usually means this is the wrong response'}
      </p>

      {match.matched.length > 0 && (
        <div>
          <p className="eyebrow m-0 mb-1">From the response</p>
          <ul className="card m-0 list-none overflow-hidden p-0">
            {match.matched.map((entry) => (
              <li
                key={entry.key}
                className="flex items-baseline gap-2 border-b border-line px-2 py-1 text-[11px] last:border-b-0"
              >
                <span className="w-24 shrink-0 truncate font-mono text-ink">{entry.key}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-faint" title={entry.path}>
                  {entry.path}
                </span>
                <span className="min-w-0 max-w-[9rem] truncate text-mute">
                  {formCase.values[entry.key] === '' ? (
                    <em className="text-faint">blank</em>
                  ) : (
                    formCase.values[entry.key]
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {match.unmatched.length > 0 && (
        <div>
          <p className="eyebrow m-0 mb-1">Keeping their own value</p>
          <p className="m-0 font-mono text-[11px] text-mute">{match.unmatched.join(', ')}</p>
        </div>
      )}

      {match.unused.length > 0 && (
        <p className="note m-0" title={match.unused.slice(0, 40).join('\n')}>
          {match.unused.length} value{match.unused.length === 1 ? '' : 's'} in the response matched
          no field.
        </p>
      )}

      <div className="flex items-center gap-2 border-t border-line pt-2.5">
        <button
          className="btn btn-sm btn-primary"
          disabled={match.matched.length === 0 || saved}
          onClick={() => {
            onSave(formCase);
            setSaved(true);
          }}
        >
          {saved ? 'Saved' : 'Save case'}
        </button>
        {saved && <span className="text-[11px] text-faint">Pick it in the Fill tab.</span>}
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
