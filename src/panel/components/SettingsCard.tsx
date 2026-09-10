import { useRef } from 'react';
import { IconClose } from './icons';
import { clampBodyLimit } from '../../shared/capture';
import type { ImportMode } from '../../shared/portable';
import type { Settings } from '../../shared/types';

interface Props {
  settings: Settings;
  usageBytes: number;
  busy: string | null;
  onChange: (settings: Settings) => void;
  onExport: () => void;
  onImport: (file: File, mode: ImportMode) => void;
  onTrim: (maxKb: number) => void;
  onCollectGarbage: () => void;
  onClose: () => void;
}

/** What the panel offers; any stored value outside the range is clamped on read. */
const BODY_LIMITS = [64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 16 * 1024 * 1024, 32 * 1024 * 1024];

export default function SettingsCard({
  settings,
  usageBytes,
  busy,
  onChange,
  onExport,
  onImport,
  onTrim,
  onCollectGarbage,
  onClose,
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const modeRef = useRef<ImportMode>('merge');

  const pickFile = (mode: ImportMode) => {
    modeRef.current = mode;
    fileInput.current?.click();
  };

  const limit = clampBodyLimit(settings.captureBodyLimit);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-canvas">
      <div className="toolbar">
        <span className="flex-1 text-[12px] font-semibold">Settings</span>
        <span className="font-mono text-[10.5px] tabular-nums text-faint">
          {formatBytes(usageBytes)} stored
        </span>
        <button onClick={onClose} className="btn btn-sm btn-icon btn-ghost" title="Close settings">
          <IconClose />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
        <Section title="Capture">
          <label className="flex flex-wrap items-center gap-2 text-[12px]">
            <span className="shrink-0">Keep bodies up to</span>
            <select
              value={limit}
              onChange={(event) =>
                onChange({ ...settings, captureBodyLimit: clampBodyLimit(Number(event.target.value)) })
              }
              className="field field-sm !w-auto"
            >
              {BODY_LIMITS.map((option) => (
                <option key={option} value={option}>
                  {formatBytes(option)}
                </option>
              ))}
            </select>
          </label>
          <p className="note">
            Anything larger is stored truncated — and a truncated body is broken JSON, so it can be
            neither stubbed nor replayed. Raise it for an app with large payloads; the log then keeps
            fewer of them in memory.
          </p>
        </Section>

        <Section title="Backup">
          <div className="flex flex-wrap gap-1.5">
            <button onClick={onExport} className="btn btn-sm btn-primary">
              Export a file
            </button>
            <button onClick={() => pickFile('merge')} className="btn btn-sm btn-secondary">
              Import — merge
            </button>
            <button onClick={() => pickFile('replace')} className="btn btn-sm btn-secondary">
              Import — replace
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onImport(file, modeRef.current);
                event.target.value = '';
              }}
            />
          </div>
          <p className="note">
            One self-contained file: rules, profiles and every story with its recorded bodies.
          </p>
        </Section>

        <Section title="Sync">
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={settings.syncEnabled}
              onChange={(event) => onChange({ ...settings, syncEnabled: event.target.checked })}
            />
            Sync settings, rules and profiles through my browser account
          </label>
          <p className="note">
            Stories and recorded bodies stay on this machine — the sync quota is 100&nbsp;KB. Share
            those with the export file instead.
          </p>
          {settings.syncStatus && <p className="m-0 text-[11px] text-warn">{settings.syncStatus}</p>}
        </Section>

        <Section title="Storage">
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => onTrim(limit / 1024)}
              className="btn btn-sm btn-secondary"
              title="Drops stored bodies bigger than what this install captures today"
            >
              Trim over {formatBytes(limit)}
            </button>
            <button onClick={onCollectGarbage} className="btn btn-sm btn-secondary">
              Delete unused bodies
            </button>
          </div>
          {busy && <p className="m-0 text-[11px] text-accent">{busy}</p>}
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="eyebrow m-0 border-b border-line pb-1.5">{title}</h2>
      {children}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
