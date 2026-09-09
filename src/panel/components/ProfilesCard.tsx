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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3 border-b pb-2 gap-2">
        <h2 className="font-semibold text-gray-700 shrink-0">Form profiles</h2>
        <div className="flex items-center gap-1.5">
          <select
            className="border rounded p-1 text-xs max-w-[9rem]"
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
          <button onClick={onCreate} className="text-xs text-slate-600 hover:underline" title="New profile">
            ＋
          </button>
          {active && (
            <>
              <button onClick={onDuplicate} className="text-xs text-slate-600 hover:underline" title="Duplicate">
                ⧉
              </button>
              <button onClick={onDelete} className="text-xs text-red-600 hover:underline" title="Delete">
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {!active ? (
        <p className="text-xs text-gray-400 italic">
          Create a profile to stop retyping the same form. Values can copy each other or be
          computed, so a signup form fills in one click.
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              className="border rounded p-1.5 text-xs flex-1 min-w-0"
              value={active.name}
              onChange={(e) => onChange({ ...active, name: e.target.value })}
              placeholder="Profile name"
            />
            <input
              className="border rounded p-1.5 font-mono text-[11px] flex-1 min-w-0"
              value={active.siteScope ?? ''}
              onChange={(e) => onChange({ ...active, siteScope: e.target.value })}
              placeholder="site scope (optional)"
              title="Only offered on URLs matching this pattern"
            />
          </div>

          {errors.length > 0 && (
            <ul className="text-[11px] text-red-600 list-disc pl-4">
              {errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            {active.fields.map((field) => (
              <div key={field.id} className="border border-gray-200 rounded">
                <div className="flex items-center gap-1.5 p-1.5">
                  <input
                    type="checkbox"
                    checked={field.enabled}
                    onChange={(e) => updateField(field.id, { enabled: e.target.checked })}
                    title="Include when filling"
                  />
                  <input
                    className="border rounded p-1 text-[11px] w-24 shrink-0 font-mono"
                    value={field.key}
                    onChange={(e) => updateField(field.id, { key: e.target.value })}
                    placeholder="key"
                  />
                  <select
                    className="border rounded p-1 text-[11px] shrink-0"
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
                    className="border rounded p-1 text-[11px] flex-1 min-w-0"
                    value={field.source.value}
                    onChange={(e) =>
                      updateField(field.id, { source: { kind: field.source.kind, value: e.target.value } })
                    }
                    placeholder={PLACEHOLDERS[field.source.kind]}
                  />
                  <button
                    onClick={() => setExpandedId(expandedId === field.id ? null : field.id)}
                    className="text-[11px] text-slate-500 shrink-0 px-1"
                    title="Selectors and follow-up"
                  >
                    {expandedId === field.id ? '▾' : '▸'}
                  </button>
                </div>

                {field.source.kind !== 'literal' && preview[field.key] !== undefined && (
                  <p className="px-2 pb-1.5 text-[10px] text-gray-400 truncate">→ {preview[field.key]}</p>
                )}

                {expandedId === field.id && (
                  <div className="border-t border-gray-200 p-2 space-y-2 bg-slate-50">
                    <p className="text-[10px] font-semibold text-gray-500">
                      Selectors — tried in order, first unique match wins
                    </p>
                    {field.selectors.map((selector, index) => (
                      <div key={index} className="flex gap-1.5">
                        <select
                          className="border rounded p-1 text-[11px]"
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
                          className="border rounded p-1 font-mono text-[11px] flex-1 min-w-0"
                          value={selector.value}
                          onChange={(e) => updateSelector(field, index, { value: e.target.value })}
                          placeholder={selector.strategy === 'css' ? '#email' : 'value'}
                        />
                        <button
                          className="text-[11px] text-red-600 px-1"
                          onClick={() =>
                            updateField(field.id, {
                              selectors: field.selectors.filter((_, i) => i !== index),
                            })
                          }
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      className="text-[11px] text-slate-600 hover:underline"
                      onClick={() =>
                        updateField(field.id, {
                          selectors: [...field.selectors, { strategy: 'css', value: '' }],
                        })
                      }
                    >
                      + fallback selector
                    </button>

                    <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-200">
                      <label className="flex items-center gap-1 text-[11px] text-gray-600">
                        wait
                        <input
                          type="number"
                          className="border rounded p-1 w-16 text-[11px]"
                          value={field.after?.waitMs ?? ''}
                          onChange={(e) =>
                            updateField(field.id, {
                              after: { ...field.after, waitMs: Number(e.target.value) || undefined },
                            })
                          }
                        />
                        ms after
                      </label>
                      <label className="flex items-center gap-1 text-[11px] text-gray-600">
                        <input
                          type="checkbox"
                          checked={field.after?.blur ?? false}
                          onChange={(e) => updateField(field.id, { after: { ...field.after, blur: e.target.checked } })}
                        />
                        blur
                      </label>
                      <input
                        className="border rounded p-1 font-mono text-[11px] flex-1 min-w-[6rem]"
                        value={field.framePattern ?? ''}
                        onChange={(e) => updateField(field.id, { framePattern: e.target.value || undefined })}
                        placeholder="frame URL contains…"
                      />
                      <button
                        className="text-[11px] text-red-600 hover:underline"
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
              className="text-xs border border-dashed border-gray-300 rounded py-1.5 px-3 text-gray-500 hover:bg-gray-50"
              onClick={() => onChange({ ...active, fields: [...active.fields, newField()] })}
            >
              + Add field
            </button>
            <button
              onClick={onFill}
              className="flex-1 bg-blue-600 text-white rounded py-1.5 text-xs hover:bg-blue-500"
            >
              Fill form
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
