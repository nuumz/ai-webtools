import { useState } from 'react';
import { IconChevron, IconPlus, IconTarget } from './icons';
import {
  newField,
  type FieldSelector,
  type FieldStrategy,
  type FormProfile,
  type ProfileField,
} from '../../shared/form';

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
  preview: Record<string, string>;
  errors: string[];
  disabled?: boolean;
  onSelect: (profileId: string) => void;
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
  preview,
  errors,
  disabled,
  onSelect,
  onChange,
  onCreate,
  onDuplicate,
  onDelete,
  onFill,
  onRecord,
  onPick,
}: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const active = profiles.find((profile) => profile.id === activeId);
  const enabledCount = active?.fields.filter((field) => field.enabled).length ?? 0;

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

                      {field.source.kind !== 'literal' && preview[field.key] !== undefined && (
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
