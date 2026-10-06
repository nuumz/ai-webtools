import { useState } from 'react';
import type { ActionKind, ActionScript, ActionStep, StepOutcome } from '../../shared/actions';
import { newScript, newStep } from '../../shared/actions';
import type { PageOutcome, ReplayRequest, ReplayResult } from '../../inject/pageScript';
import { IconPlus, IconTarget } from './icons';

/** The step kinds in the order a script usually needs them. */
const KINDS: { id: ActionKind; label: string; hint: string }[] = [
  { id: 'click', label: 'Click', hint: 'Press the element the way a pointer does' },
  { id: 'waitFor', label: 'Wait for', hint: 'Hold until the element is there and usable' },
  { id: 'waitMs', label: 'Wait ms', hint: 'Hold for a fixed time' },
  { id: 'assertText', label: 'Expect text', hint: 'Stop unless this text is on screen' },
];

const WHY: Record<NonNullable<StepOutcome['why']>, string> = {
  missing: 'not found',
  hidden: 'hidden',
  disabled: 'disabled',
  timeout: 'timed out',
  text: 'text not on screen',
};

interface Props {
  scripts: ActionScript[];
  activeId?: string;
  /** Last run, keyed by step id. A step absent from it never ran. */
  outcomes: Record<string, StepOutcome>;
  running: boolean;
  disabled: boolean;
  /** Last answer from a call or an expression, shown under the Call section. */
  called?: PageOutcome;
  replayed?: ReplayResult;
  onSelect: (id: string) => void;
  onCreate: (script: ActionScript) => void;
  onChange: (script: ActionScript) => void;
  onDelete: (id: string) => void;
  onPickStep: (stepId: string) => void;
  onRun: (steps: ActionStep[]) => void;
  onCall: (path: string, args: unknown[] | undefined) => void;
  onEval: (source: string) => void;
  onReplay: (request: ReplayRequest) => void;
}

export default function ControlCard({
  scripts,
  activeId,
  outcomes,
  running,
  disabled,
  called,
  replayed,
  onSelect,
  onCreate,
  onChange,
  onDelete,
  onPickStep,
  onRun,
  onCall,
  onEval,
  onReplay,
}: Props) {
  const active = scripts.find((script) => script.id === activeId) ?? scripts[0];

  const editStep = (stepId: string, patch: Partial<ActionStep>) => {
    if (!active) return;
    onChange({
      ...active,
      steps: active.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="toolbar">
        <select
          className="field field-sm min-w-0 flex-1"
          value={active?.id ?? ''}
          disabled={scripts.length === 0}
          onChange={(event) => onSelect(event.target.value)}
        >
          {scripts.length === 0 && <option value="">No scripts yet</option>}
          {scripts.map((script) => (
            <option key={script.id} value={script.id}>
              {script.name}
            </option>
          ))}
        </select>
        <button className="btn btn-sm btn-secondary" onClick={() => onCreate(newScript('New script'))}>
          <IconPlus />
          Script
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={disabled || running || !active || active.steps.length === 0}
          onClick={() => active && onRun(active.steps)}
        >
          {running ? 'Running…' : 'Run all'}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {active && (
          <Section title="Steps">
            <div className="flex items-center gap-2 px-3 pb-2">
              <input
                className="field field-sm flex-1"
                value={active.name}
                onChange={(event) => onChange({ ...active, name: event.target.value })}
                aria-label="Script name"
              />
              <button className="btn btn-sm btn-danger" onClick={() => onDelete(active.id)}>
                Delete
              </button>
            </div>

            {active.steps.length === 0 && <p className="empty">Add a step, then point it at a button.</p>}

            {active.steps.map((step, index) => {
              const outcome = outcomes[step.id];
              const needsElement = step.kind === 'click' || step.kind === 'waitFor';
              return (
                <div key={step.id} className="card mx-3 mb-2 p-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] tabular-nums text-faint">{index + 1}</span>
                    <input
                      className="field field-sm min-w-0 flex-1"
                      placeholder={KINDS.find((kind) => kind.id === step.kind)?.hint}
                      value={step.label}
                      onChange={(event) => editStep(step.id, { label: event.target.value })}
                      aria-label="Step label"
                    />
                    <select
                      className="field field-sm w-24"
                      value={step.kind}
                      onChange={(event) => editStep(step.id, { kind: event.target.value as ActionKind })}
                      aria-label="Step kind"
                    >
                      {KINDS.map((kind) => (
                        <option key={kind.id} value={kind.id}>
                          {kind.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    {needsElement && (
                      <>
                        <button
                          className="btn btn-sm btn-secondary"
                          disabled={disabled || running}
                          onClick={() => onPickStep(step.id)}
                          title="Click the element on the page"
                        >
                          <IconTarget />
                          Pick
                        </button>
                        {/*
                         * Typed as well as picked: the words on a button are
                         * visible from across the room, so a script can be
                         * written straight off the screen — picking is for the
                         * controls whose text does not identify them.
                         */}
                        <input
                          className="field field-sm field-mono min-w-0 flex-1"
                          placeholder="Text on the button"
                          value={step.selectors[0]?.value ?? ''}
                          onChange={(event) =>
                            editStep(step.id, {
                              selectors:
                                event.target.value === ''
                                  ? []
                                  : [
                                      {
                                        strategy: step.selectors[0]?.strategy ?? 'text',
                                        value: event.target.value,
                                      },
                                      ...step.selectors.slice(1),
                                    ],
                            })
                          }
                          aria-label="Element"
                        />
                        <span className="chip">{step.selectors[0]?.strategy ?? 'text'}</span>
                      </>
                    )}
                    {step.kind === 'assertText' && (
                      <input
                        className="field field-sm min-w-0 flex-1"
                        placeholder="Text that must be visible"
                        value={step.text ?? ''}
                        onChange={(event) => editStep(step.id, { text: event.target.value })}
                        aria-label="Expected text"
                      />
                    )}
                    <input
                      className="field field-sm w-20 tabular-nums"
                      type="number"
                      placeholder={step.kind === 'waitMs' ? 'ms' : '3000'}
                      value={step.timeoutMs ?? ''}
                      onChange={(event) =>
                        editStep(step.id, {
                          timeoutMs: event.target.value === '' ? undefined : Number(event.target.value),
                        })
                      }
                      aria-label={step.kind === 'waitMs' ? 'Milliseconds' : 'Timeout in ms'}
                    />
                  </div>

                  <div className="mt-2 flex items-center gap-2">
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={disabled || running}
                      onClick={() => onRun([step])}
                    >
                      Run step
                    </button>
                    <button
                      className="btn btn-sm btn-link"
                      onClick={() =>
                        onChange({ ...active, steps: active.steps.filter((entry) => entry.id !== step.id) })
                      }
                    >
                      Remove
                    </button>
                    {outcome && (
                      <span className={`chip ${outcome.ok ? 'chip-ok' : 'chip-warn'}`}>
                        {outcome.ok ? 'ok' : (WHY[outcome.why ?? 'missing'] ?? 'failed')}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-2 px-3 pb-3">
              {KINDS.map((kind) => (
                <button
                  key={kind.id}
                  className="btn btn-sm btn-secondary"
                  onClick={() => onChange({ ...active, steps: [...active.steps, newStep(kind.id)] })}
                >
                  <IconPlus />
                  {kind.label}
                </button>
              ))}
            </div>
          </Section>
        )}

        <CallSection disabled={disabled} called={called} onCall={onCall} onEval={onEval} />
        <ReplaySection disabled={disabled} replayed={replayed} onReplay={onReplay} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-b border-line pb-1">
      <h2 className="eyebrow px-3 pt-3 pb-2">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Calling the app's own JavaScript.
 *
 * Two ways in, because a page's CSP decides which one is available: a call path
 * is just a property walk and always works, an expression is evaluated code and
 * a strict `script-src` refuses it.
 */
function CallSection({
  disabled,
  called,
  onCall,
  onEval,
}: {
  disabled: boolean;
  called?: PageOutcome;
  onCall: (path: string, args: unknown[] | undefined) => void;
  onEval: (source: string) => void;
}) {
  const [path, setPath] = useState('');
  const [args, setArgs] = useState('');
  const [source, setSource] = useState('');
  const [argsError, setArgsError] = useState<string | undefined>(undefined);

  const call = (withArgs: boolean) => {
    if (!withArgs) {
      setArgsError(undefined);
      onCall(path.trim(), undefined);
      return;
    }
    const text = args.trim();
    try {
      // A bare list is what a caller means by arguments, so an object or a lone
      // value is wrapped rather than rejected — only malformed JSON is an error.
      const parsed: unknown = text === '' ? [] : JSON.parse(text);
      setArgsError(undefined);
      onCall(path.trim(), Array.isArray(parsed) ? parsed : [parsed]);
    } catch (error) {
      setArgsError(error instanceof Error ? error.message : 'Arguments must be JSON');
    }
  };

  return (
    <Section title="Call the app">
      <div className="flex flex-col gap-2 px-3 pb-3">
        <input
          className="field field-sm field-mono"
          placeholder="__APP__.store.dispatch"
          value={path}
          onChange={(event) => setPath(event.target.value)}
          aria-label="Call path"
        />
        <input
          className="field field-sm field-mono"
          placeholder='["arg", 1] — JSON arguments'
          value={args}
          onChange={(event) => setArgs(event.target.value)}
          aria-label="Call arguments"
        />
        <div className="flex gap-2">
          <button className="btn btn-sm btn-primary" disabled={disabled || path.trim() === ''} onClick={() => call(true)}>
            Call
          </button>
          <button className="btn btn-sm btn-secondary" disabled={disabled || path.trim() === ''} onClick={() => call(false)}>
            Read value
          </button>
        </div>
        {argsError && <p className="note text-bad">{argsError}</p>}

        <textarea
          className="field field-sm field-mono field-area"
          rows={2}
          placeholder="Expression, e.g. window.__store.getState().user"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          aria-label="Expression"
        />
        <div>
          <button
            className="btn btn-sm btn-secondary"
            disabled={disabled || source.trim() === ''}
            onClick={() => onEval(source)}
          >
            Evaluate
          </button>
        </div>

        {called && <PageAnswer outcome={called} />}
      </div>
    </Section>
  );
}

function PageAnswer({ outcome }: { outcome: PageOutcome }) {
  if (outcome.kind === 'missing') return <p className="note text-warn">Nothing at “{outcome.path}”.</p>;
  if (outcome.kind === 'error') return <p className="note text-bad">{outcome.message}</p>;
  return (
    <div>
      <p className="eyebrow pb-1">{outcome.value.type}</p>
      <pre className="code-block max-h-48 overflow-auto">{outcome.value.text}</pre>
    </div>
  );
}

/** Sends a request with the page's own fetch, so its cookies and wrappers apply. */
function ReplaySection({
  disabled,
  replayed,
  onReplay,
}: {
  disabled: boolean;
  replayed?: ReplayResult;
  onReplay: (request: ReplayRequest) => void;
}) {
  const [method, setMethod] = useState('GET');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState('');
  const [body, setBody] = useState('');

  const send = () => {
    const parsed = headers
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes(':'))
      .map((line): [string, string] => {
        const at = line.indexOf(':');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim()];
      });
    onReplay({
      url: url.trim(),
      method,
      headers: parsed,
      ...(method === 'GET' || method === 'HEAD' || body === '' ? {} : { body }),
    });
  };

  return (
    <Section title="Send a request">
      <div className="flex flex-col gap-2 px-3 pb-3">
        <div className="flex gap-2">
          <select
            className="field field-sm w-24"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            aria-label="Method"
          >
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((verb) => (
              <option key={verb} value={verb}>
                {verb}
              </option>
            ))}
          </select>
          <input
            className="field field-sm field-mono min-w-0 flex-1"
            placeholder="/api/generate-raw"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            aria-label="URL"
          />
        </div>
        <textarea
          className="field field-sm field-mono field-area"
          rows={2}
          placeholder="Header: value (one per line)"
          value={headers}
          onChange={(event) => setHeaders(event.target.value)}
          aria-label="Headers"
        />
        <textarea
          className="field field-sm field-mono field-area"
          rows={3}
          placeholder="Request body"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-label="Request body"
        />
        <div>
          <button className="btn btn-sm btn-primary" disabled={disabled || url.trim() === ''} onClick={send}>
            Send
          </button>
        </div>

        {replayed && (
          <div>
            <p className="eyebrow pb-1">
              {replayed.error ? 'failed' : `${replayed.status} ${replayed.statusText}`} · {replayed.ms} ms
              {replayed.truncated && ' · truncated'}
            </p>
            <pre className="code-block max-h-48 overflow-auto">{replayed.error ?? replayed.body}</pre>
          </div>
        )}
      </div>
    </Section>
  );
}
