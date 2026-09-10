import { useState } from 'react';
import { IconChevron, IconClose, IconPlus, IconTarget } from './icons';
import {
  newField,
  type FieldReadiness,
  type FieldSelector,
  type FieldStrategy,
  type FormCase,
  type FormProfile,
  type ProfileField,
  type ScreenSignature,
} from '../../shared/form';
import type { ScreenOutcome } from '../../inject/run';

const STRATEGIES: FieldStrategy[] = ['testid', 'id', 'name', 'label', 'aria', 'placeholder', 'css'];

const SOURCE_KINDS = [
  { value: 'literal', label: 'Text' },
  { value: 'template', label: 'Template' },
  { value: 'ref', label: 'Same as' },
  { value: 'expr', label: 'Formula' },
] as const;

const PLACEHOLDERS: Record<string, string> = {
  literal: 'tester@dev.local',
  template: "qa+{{seq('user')}}@dev.local",
  ref: 'password',
  expr: 'qty * price',
};

interface Props {
  profiles: FormProfile[];
  activeId?: string;
  /** Already narrowed to the active profile by the panel. */
  cases: FormCase[];
  activeCaseId?: string;
  screen?: ScreenOutcome;
  screenBusy?: boolean;
  preview: Record<string, string>;
  errors: string[];
  disabled?: boolean;
  onSelect: (profileId: string) => void;
  onSelectCase: (caseId: string | undefined) => void;
  onCreateCase: () => void;
  onChangeCase: (formCase: FormCase) => void;
  onDeleteCase: () => void;
  onCheckScreen: () => void;
  onChangeScreen: (screen: ScreenSignature | undefined) => void;
  onChange: (profile: FormProfile) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onFill: () => void;
  onRecord: () => void;
  onPick: (fieldId?: string) => void;
}

export default function ProfilesCard({
  profiles,
  activeId,
  cases,
  activeCaseId,
  screen,
  screenBusy,
  preview,
  errors,
  disabled,
  onSelect,
  onSelectCase,
  onCreateCase,
  onChangeCase,
  onDeleteCase,
  onCheckScreen,
  onChangeScreen,
  onChange,
  onCreate,
  onDuplicate,
  onDelete,
  onFill,
  onRecord,
  onPick,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [screenOpen, setScreenOpen] = useState(false);
  const active = profiles.find((profile) => profile.id === activeId);
  const activeCase = cases.find((item) => item.id === activeCaseId);
  const enabledCount = active?.fields.filter((field) => field.enabled).length ?? 0;

  /** Overriding a value edits the case; the profile's own source is left intact. */
  const setOverride = (key: string, value: string) => {
    if (!activeCase) return;
    onChangeCase({ ...activeCase, values: { ...activeCase.values, [key]: value } });
  };

  const clearOverride = (key: string) => {
    if (!activeCase) return;
    const { [key]: _drop, ...rest } = activeCase.values;
    onChangeCase({ ...activeCase, values: rest });
  };

  const updateField = (fieldId: string, patch: Partial<ProfileField>) => {
    if (!active) return;
    onChange({
      ...active,
      fields: active.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    });
  };

  const updateSelector = (field: ProfileField, index: number, patch: Partial<FieldSelector>) => {
    updateField(field.id, {
      selectors: field.selectors.map((selector, i) =>
        i === index ? { ...selector, ...patch } : selector,
      ),
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="toolbar">
        <select
          className="field field-sm min-w-0 flex-1"
          value={activeId ?? ''}
          onChange={(e) => onSelect(e.target.value)}
          aria-label="Active profile"
        >
          {profiles.length === 0 && <option value="">no profiles yet</option>}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </select>
        <button onClick={onCreate} className="btn btn-sm btn-secondary" title="New profile">
          <IconPlus />
          New
        </button>
        {active && (
          <>
            <button
              onClick={onDuplicate}
              className="btn btn-sm btn-ghost"
              title="Duplicate this profile"
            >
              Copy
            </button>
            <button
              onClick={onDelete}
              className="btn btn-sm btn-ghost btn-danger"
              title="Delete this profile"
            >
              Delete
            </button>
          </>
        )}
      </div>

      {active && (
        <div className="flex items-center gap-1.5 border-b border-line bg-inset px-2 py-1">
          <select
            className="field field-sm min-w-0 flex-1"
            value={activeCaseId ?? ''}
            onChange={(e) => onSelectCase(e.target.value || undefined)}
            aria-label="Active case"
            title="A case is one named set of values for this screen"
          >
            <option value="">profile defaults</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <button
            onClick={onCreateCase}
            className="btn btn-sm btn-icon btn-ghost"
            title="New case — the same screen, different data"
          >
            <IconPlus />
          </button>
          {activeCase && (
            <button
              onClick={onDeleteCase}
              className="btn btn-sm btn-icon btn-ghost btn-danger"
              title="Delete this case"
            >
              <IconClose />
            </button>
          )}
          <ScreenStatus
            profiles={profiles}
            active={active}
            screen={screen}
            busy={screenBusy}
            onEdit={() => setScreenOpen((open) => !open)}
            onSwitch={onSelect}
          />
        </div>
      )}

      {!active ? (
        <p className="empty">
          Create a profile to stop retyping the same form.
          <br />
          Values can copy each other or be computed, so a signup form fills in one click.
        </p>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
            <div className="flex gap-1.5">
              <input
                className="field min-w-0 flex-1"
                value={active.name}
                onChange={(e) => onChange({ ...active, name: e.target.value })}
                placeholder="Profile name"
                aria-label="Profile name"
              />
              <input
                className="field field-mono min-w-0 flex-1"
                value={active.siteScope ?? ''}
                onChange={(e) => onChange({ ...active, siteScope: e.target.value })}
                placeholder="site scope (optional)"
                title="Only offered on URLs matching this pattern"
              />
            </div>

            {activeCase && (
              <label className="flex items-center gap-2 text-[11px] text-mute">
                <span className="w-20 shrink-0">Case name</span>
                <input
                  className="field min-w-0 flex-1"
                  value={activeCase.name}
                  onChange={(e) => onChangeCase({ ...activeCase, name: e.target.value })}
                  placeholder="what makes this row of data different"
                  aria-label="Case name"
                />
              </label>
            )}

            {screenOpen && (
              <ScreenEditor
                signature={active.screen}
                sample={screen?.sample ?? []}
                busy={screenBusy}
                onChange={onChangeScreen}
                onCheck={onCheckScreen}
              />
            )}

            {errors.length > 0 && (
              <ul className="m-0 list-disc space-y-0.5 rounded-[var(--radius-md)] border border-[var(--bad-line)] bg-bad-soft py-1.5 pr-2 pl-5 text-[11px] text-bad">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            )}

            <div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <p className="eyebrow m-0">Fields</p>
                <span className="text-[10.5px] text-faint tabular-nums">
                  {enabledCount} of {active.fields.length} will fill
                </span>
              </div>

              {active.fields.length === 0 ? (
                <p className="empty !py-4">Add a field, or pick one straight off the page.</p>
              ) : (
                <div className="card overflow-hidden">
                  {active.fields.map((field, index) => (
                    <div key={field.id} className={index > 0 ? 'border-t border-line' : undefined}>
                      <div className="flex items-center gap-1.5 px-1.5 py-1.5">
                        <input
                          type="checkbox"
                          checked={field.enabled}
                          onChange={(e) => updateField(field.id, { enabled: e.target.checked })}
                          title="Include when filling"
                        />
                        <input
                          className="field field-mono field-sm w-24 shrink-0"
                          value={field.key}
                          onChange={(e) => updateField(field.id, { key: e.target.value })}
                          placeholder="key"
                          aria-label="Field key"
                        />
                        {!activeCase ? (
                          <>
                            <select
                              className="field field-sm !w-auto shrink-0"
                              value={field.source.kind}
                              onChange={(e) =>
                                updateField(field.id, {
                                  source: {
                                    kind: e.target.value as typeof field.source.kind,
                                    value: field.source.value,
                                  },
                                })
                              }
                              aria-label="Value kind"
                            >
                              {SOURCE_KINDS.map((kind) => (
                                <option key={kind.value} value={kind.value}>
                                  {kind.label}
                                </option>
                              ))}
                            </select>
                            <input
                              className="field field-sm min-w-0 flex-1"
                              value={field.source.value}
                              onChange={(e) =>
                                updateField(field.id, {
                                  source: { kind: field.source.kind, value: e.target.value },
                                })
                              }
                              placeholder={PLACEHOLDERS[field.source.kind]}
                              aria-label="Value"
                            />
                          </>
                        ) : field.key in activeCase.values ? (
                          <>
                            <button
                              className="chip chip-btn chip-accent"
                              onClick={() => clearOverride(field.key)}
                              title="This case sets its own value — click to go back to the profile’s"
                            >
                              case
                            </button>
                            <input
                              className="field field-sm min-w-0 flex-1"
                              value={activeCase.values[field.key]}
                              onChange={(e) => setOverride(field.key, e.target.value)}
                              placeholder="value for this case"
                              aria-label={`Value for ${field.key} in this case`}
                            />
                          </>
                        ) : (
                          <>
                            <button
                              className="chip chip-btn"
                              onClick={() =>
                                setOverride(field.key, preview[field.key] ?? field.source.value)
                              }
                              title="Takes the profile’s value — click to set one for this case"
                            >
                              {SOURCE_KINDS.find((kind) => kind.value === field.source.kind)?.label}
                            </button>
                            <input
                              className="field field-sm field-bare min-w-0 flex-1 text-faint"
                              value={preview[field.key] ?? field.source.value}
                              readOnly
                              aria-label={`Value for ${field.key} from the profile`}
                              title="Choose “profile defaults” above to edit the profile itself"
                            />
                          </>
                        )}
                        <button
                          onClick={() => setOpenId(openId === field.id ? null : field.id)}
                          className="btn btn-sm btn-icon btn-ghost"
                          aria-expanded={openId === field.id}
                          title="Selectors and follow-up"
                        >
                          <IconChevron
                            className={`transition-transform ${openId === field.id ? 'rotate-90' : ''}`}
                          />
                        </button>
                      </div>

                      {!activeCase &&
                        field.source.kind !== 'literal' &&
                        preview[field.key] !== undefined && (
                          <p className="m-0 truncate px-2 pb-1.5 pl-[2.1rem] font-mono text-[10.5px] text-faint">
                            → {preview[field.key]}
                          </p>
                        )}

                      {openId === field.id && (
                        <div className="space-y-2 border-t border-line bg-inset p-2">
                          <p className="eyebrow m-0">Selectors — first unique match wins</p>
                          {field.selectors.map((selector, index) => (
                            <div key={index} className="flex gap-1.5">
                              <select
                                className="field field-sm !w-auto"
                                value={selector.strategy}
                                onChange={(e) =>
                                  updateSelector(field, index, {
                                    strategy: e.target.value as FieldStrategy,
                                  })
                                }
                                aria-label="Strategy"
                              >
                                {STRATEGIES.map((strategy) => (
                                  <option key={strategy} value={strategy}>
                                    {strategy}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="field field-mono field-sm min-w-0 flex-1"
                                value={selector.value}
                                onChange={(e) =>
                                  updateSelector(field, index, { value: e.target.value })
                                }
                                placeholder={selector.strategy === 'css' ? '#email' : 'value'}
                                aria-label="Selector value"
                              />
                              <button
                                className="btn btn-sm btn-icon btn-ghost btn-danger"
                                title="Remove this selector"
                                onClick={() =>
                                  updateField(field.id, {
                                    selectors: field.selectors.filter((_, i) => i !== index),
                                  })
                                }
                              >
                                ×
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-3">
                            <button
                              className="btn-link"
                              onClick={() =>
                                updateField(field.id, {
                                  selectors: [...field.selectors, { strategy: 'css', value: '' }],
                                })
                              }
                            >
                              Add fallback
                            </button>
                            <button className="btn-link" onClick={() => onPick(field.id)}>
                              Pick from page
                            </button>
                          </div>

                          {/*
                            Recording sets the anchor itself, and only when a label
                            repeats on screen — but the user has to be able to see
                            why a field is scoped, and widen it when the section
                            heading changes.
                          */}
                          <label className="flex items-center gap-2 border-t border-line pt-2 text-[11px] text-mute">
                            <span className="w-20 shrink-0">Only inside</span>
                            <input
                              className="field field-sm min-w-0 flex-1"
                              value={field.anchor?.text ?? ''}
                              onChange={(e) =>
                                updateField(field.id, {
                                  anchor: e.target.value ? { text: e.target.value } : undefined,
                                })
                              }
                              placeholder="a section containing this text — whole page if blank"
                            />
                          </label>

                          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-2 text-[11px] text-mute">
                            <span className="w-20 shrink-0">Wait until</span>
                            <label className="flex min-w-0 flex-1 items-center gap-1">
                              <input
                                className="field field-sm min-w-0 flex-1"
                                value={field.waitFor?.optionText ?? ''}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    waitFor: cleanReadiness({
                                      ...field.waitFor,
                                      optionText: e.target.value || undefined,
                                    }),
                                  })
                                }
                                placeholder="an option reads…"
                                aria-label="Wait for option text"
                              />
                            </label>
                            <label className="flex items-center gap-1">
                              or
                              <input
                                type="number"
                                className="field field-sm w-14"
                                value={field.waitFor?.minOptions ?? ''}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    waitFor: cleanReadiness({
                                      ...field.waitFor,
                                      minOptions: Number(e.target.value) || undefined,
                                    }),
                                  })
                                }
                                aria-label="Minimum options"
                              />
                              options exist
                            </label>
                          </div>

                          <div className="flex flex-wrap items-center gap-2.5 border-t border-line pt-2">
                            <label className="flex items-center gap-1 text-[11px] text-mute">
                              wait
                              <input
                                type="number"
                                className="field field-sm w-14"
                                value={field.after?.waitMs ?? ''}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    after: {
                                      ...field.after,
                                      waitMs: Number(e.target.value) || undefined,
                                    },
                                  })
                                }
                              />
                              ms after
                            </label>
                            <label className="flex items-center gap-1 text-[11px] text-mute">
                              <input
                                type="checkbox"
                                checked={field.after?.blur ?? false}
                                onChange={(e) =>
                                  updateField(field.id, {
                                    after: { ...field.after, blur: e.target.checked },
                                  })
                                }
                              />
                              blur
                            </label>
                            <input
                              className="field field-mono field-sm min-w-[6rem] flex-1"
                              value={field.framePattern ?? ''}
                              onChange={(e) =>
                                updateField(field.id, { framePattern: e.target.value || undefined })
                              }
                              placeholder="frame URL contains…"
                              aria-label="Frame pattern"
                            />
                            <button
                              className="btn-link btn-danger"
                              onClick={() =>
                                onChange({
                                  ...active,
                                  fields: active.fields.filter((item) => item.id !== field.id),
                                })
                              }
                            >
                              Remove field
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-1.5">
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => onChange({ ...active, fields: [...active.fields, newField()] })}
              >
                <IconPlus />
                Add field
              </button>
              <button className="btn btn-sm btn-secondary" onClick={() => onPick()}>
                <IconTarget />
                Pick from page
              </button>
              <button
                className="btn btn-sm btn-ghost"
                onClick={onRecord}
                title="Read the form as filled"
              >
                Read the page
              </button>
            </div>
          </div>

          <div className="shrink-0 border-t border-line bg-surface p-2">
            <button onClick={onFill} disabled={disabled} className="btn btn-lg btn-primary w-full">
              Fill {enabledCount} field{enabledCount === 1 ? '' : 's'} on the page
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Which of the known screens the tab is showing. A wizard's steps share one
 * URL, so this is the only thing that can tell "this profile is broken" from
 * "you are on a different step" — and naming the step that IS showing is what
 * makes the second case actionable rather than just less alarming.
 */
function ScreenStatus({
  profiles,
  active,
  screen,
  busy,
  onEdit,
  onSwitch,
}: {
  profiles: FormProfile[];
  active: FormProfile;
  screen?: ScreenOutcome;
  busy?: boolean;
  onEdit: () => void;
  onSwitch: (profileId: string) => void;
}) {
  const texts = active.screen?.texts.filter((text) => text.trim() !== '') ?? [];
  if (texts.length === 0) {
    return (
      <button
        className="chip chip-btn"
        onClick={onEdit}
        title="This profile fills whatever page is open. Give it a screen to recognise."
      >
        any screen
      </button>
    );
  }

  if (busy) return <span className="chip chip-pending">checking</span>;

  const score = screen?.scores.find((entry) => entry.id === active.id);
  const onScreen = score !== undefined && score.total > 0 && score.matched === score.total;
  const showing =
    screen?.best && screen.best !== active.id
      ? profiles.find((profile) => profile.id === screen.best)
      : undefined;

  return (
    <>
      <button
        className={`chip chip-btn ${onScreen ? 'chip-ok' : showing ? 'chip-warn' : ''}`}
        onClick={onEdit}
        title={
          onScreen
            ? `The page shows all ${score.total} of this screen’s texts.`
            : score
              ? `Only ${score.matched} of ${score.total} of this screen’s texts are visible${
                  showing ? ` — ${showing.name} is the screen showing.` : '.'
                }`
              : 'Not checked yet.'
        }
      >
        {onScreen ? 'on screen' : showing ? 'other step' : score ? `${score.matched}/${score.total}` : 'unchecked'}
      </button>
      {showing && (
        <button
          className="btn btn-sm btn-link shrink-0"
          onClick={() => onSwitch(showing.id)}
          title="This screen is the one showing — switch to it"
        >
          {showing.name}
        </button>
      )}
    </>
  );
}

/**
 * The signature is edited as plain visible text because that is what the user
 * can verify by looking at the page — a selector would be one more thing to
 * keep in sync with a screen they can already read.
 */
function ScreenEditor({
  signature,
  sample,
  busy,
  onChange,
  onCheck,
}: {
  signature?: ScreenSignature;
  sample: string[];
  busy?: boolean;
  onChange: (next: ScreenSignature | undefined) => void;
  onCheck: () => void;
}) {
  const texts = signature?.texts ?? [];
  const write = (next: string[]) => onChange(next.length > 0 ? { texts: next } : undefined);
  const unused = sample.filter((text) => !texts.includes(text));

  return (
    <div className="card space-y-2 bg-inset p-2">
      <div className="flex items-baseline justify-between">
        <p className="eyebrow m-0">Recognise this screen by</p>
        <button className="btn btn-sm btn-ghost" onClick={onCheck} disabled={busy}>
          {busy ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {texts.length === 0 ? (
        <p className="note m-0">
          Every text listed here must be visible on the page at once. Leave it empty and this
          profile fills whatever is open.
        </p>
      ) : (
        texts.map((text, index) => (
          <div key={index} className="flex gap-1.5">
            <input
              className="field field-sm min-w-0 flex-1"
              value={text}
              onChange={(e) =>
                write(texts.map((item, i) => (i === index ? e.target.value : item)))
              }
              placeholder="a heading or label only this step shows"
              aria-label={`Screen text ${index + 1}`}
            />
            <button
              className="btn btn-sm btn-icon btn-ghost btn-danger"
              onClick={() => write(texts.filter((_item, i) => i !== index))}
              title="Remove this text"
            >
              <IconClose />
            </button>
          </div>
        ))
      )}

      <div className="flex flex-wrap gap-1.5">
        <button className="btn btn-sm btn-secondary" onClick={() => write([...texts, ''])}>
          <IconPlus />
          Add text
        </button>
        {unused.slice(0, 6).map((text) => (
          <button
            key={text}
            className="chip chip-btn"
            onClick={() => write([...texts, text])}
            title="Visible on the page right now — add it to the signature"
          >
            {text.length > 28 ? `${text.slice(0, 27)}…` : text}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Drops the whole readiness block once its last condition is cleared. */
function cleanReadiness(next: FieldReadiness): FieldReadiness | undefined {
  return next.optionText || next.minOptions || next.timeoutMs ? next : undefined;
}
