import { useState } from 'react';
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
  onSelect,
  onChange,
  onCreate,
  onDuplicate,
  onDelete,
  onFill,
  onRecord,
  onPick,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const active = profiles.find((profile) => profile.id === activeId);

  const updateField = (fieldId: string, patch: Partial<ProfileField>) => {
    if (!active) return;
    onChange({
      ...active,
      fields: active.fields.map((field) => (field.id === fieldId ? { ...field, ...patch } : field)),
    });
  };

  const updateSelector = (field: ProfileField, index: number, patch: Partial<FieldSelector>) => {
    updateField(field.id, {
      selectors: field.selectors.map((selector, i) => (i === index ? { ...selector, ...patch } : selector)),
    });
  };

  return (
    <div className="panel-card p-3.5">
      <div className="mb-3 flex items-center justify-between gap-2 border-b border-line pb-2">
        <h2 className="m-0 shrink-0 text-[13px] font-semibold">Form profiles</h2>
        <div className="flex items-center gap-1.5">
          <select
            className="field field-sm max-w-[9rem]"
            value={activeId ?? ''}
            onChange={(e) => onSelect(e.target.value)}
          >
            {profiles.length === 0 && <option value="">no profiles</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <button onClick={onRecord} className="btn btn-ghost" title="Record the filled form">
            Record
          </button>
          <button onClick={onCreate} className="btn btn-ghost" title="New profile">
            New
          </button>
          {active && (
            <>
              <button onClick={onDuplicate} className="btn btn-ghost" title="Duplicate">
                Dup
              </button>
              <button onClick={onDelete} className="btn btn-ghost btn-danger" title="Delete">
                Del
              </button>
            </>
          )}
        </div>
      </div>

      {!active ? (
        <p className="panel-empty">
          Create a profile to stop retyping the same form. Values can copy each other or be
          computed, so a signup form fills in one click.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="field min-w-0 flex-1"
              value={active.name}
              onChange={(e) => onChange({ ...active, name: e.target.value })}
              placeholder="Profile name"
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
            <ul className="m-0 list-disc pl-4 text-[11px] text-bad">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            {active.fields.map((field) => (
              <div key={field.id} className="overflow-hidden rounded-[var(--radius-md)] border border-line">
                <div className="flex items-center gap-1.5 p-1.5">
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
                  />
                  <select
                    className="field field-sm w-auto shrink-0"
                    value={field.source.kind}
                    onChange={(e) =>
                      updateField(field.id, {
                        source: { kind: e.target.value as typeof field.source.kind, value: field.source.value },
                      })
                    }
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
                      updateField(field.id, { source: { kind: field.source.kind, value: e.target.value } })
                    }
                    placeholder={PLACEHOLDERS[field.source.kind]}
                  />
                  <button
                    onClick={() => setExpandedId(expandedId === field.id ? null : field.id)}
                    className="btn-link shrink-0 px-1"
                    title="Selectors and follow-up"
                  >
                    {expandedId === field.id ? '▾' : '▸'}
                  </button>
                </div>

                {field.source.kind !== 'literal' && preview[field.key] !== undefined && (
                  <p className="truncate px-2 pb-1.5 font-mono text-[10px] text-faint">→ {preview[field.key]}</p>
                )}

                {expandedId === field.id && (
                  <div className="space-y-2 border-t border-line bg-inset p-2">
                    <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-faint">
                      Selectors — tried in order, first unique match wins
                    </p>
                    {field.selectors.map((selector, index) => (
                      <div key={index} className="flex gap-1.5">
                        <select
                          className="field field-sm w-auto"
                          value={selector.strategy}
                          onChange={(e) =>
                            updateSelector(field, index, { strategy: e.target.value as FieldStrategy })
                          }
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
                          onChange={(e) => updateSelector(field, index, { value: e.target.value })}
                          placeholder={selector.strategy === 'css' ? '#email' : 'value'}
                        />
                        <button
                          className="btn-link btn-danger px-1"
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
                        + fallback selector
                      </button>
                      <button className="btn-link" onClick={() => onPick(field.id)}>
                        Pick from page
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2">
                      <label className="flex items-center gap-1 text-[11px] text-mute">
                        wait
                        <input
                          type="number"
                          className="field field-sm w-16"
                          value={field.after?.waitMs ?? ''}
                          onChange={(e) =>
                            updateField(field.id, {
                              after: { ...field.after, waitMs: Number(e.target.value) || undefined },
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
                            updateField(field.id, { after: { ...field.after, blur: e.target.checked } })
                          }
                        />
                        blur
                      </label>
                      <input
                        className="field field-mono field-sm min-w-[6rem] flex-1"
                        value={field.framePattern ?? ''}
                        onChange={(e) => updateField(field.id, { framePattern: e.target.value || undefined })}
                        placeholder="frame URL contains…"
                      />
                      <button
                        className="btn-link btn-danger"
                        onClick={() =>
                          onChange({ ...active, fields: active.fields.filter((item) => item.id !== field.id) })
                        }
                      >
                        remove field
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              className="btn btn-ghost"
              onClick={() => onChange({ ...active, fields: [...active.fields, newField()] })}
            >
              + Add field
            </button>
            <button className="btn btn-ghost" onClick={() => onPick()}>
              Pick
            </button>
            <button onClick={onFill} className="btn btn-primary flex-1">
              Fill form
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
