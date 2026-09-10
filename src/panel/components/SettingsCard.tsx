import { useRef } from 'react';
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
}: Props) {
  const fileInput = useRef<HTMLInputElement>(null);
  const modeRef = useRef<ImportMode>('merge');

  const pickFile = (mode: ImportMode) => {
    modeRef.current = mode;
    fileInput.current?.click();
  };

  return (
    <div className="panel-card p-3.5">
      <div className="mb-3 flex items-center justify-between border-b border-line pb-2">
        <h2 className="m-0 text-[13px] font-semibold">Backup &amp; sync</h2>
        <span className="font-mono text-[11px] tabular-nums text-faint">{formatBytes(usageBytes)} stored</span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={onExport} className="btn btn-primary">
            Export file
          </button>
          <button onClick={() => pickFile('merge')} className="btn btn-ghost">
            Import (merge)
          </button>
          <button onClick={() => pickFile('replace')} className="btn btn-ghost">
            Import (replace)
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
        <p className="m-0 text-[11px] leading-relaxed text-faint">
          One self-contained file: rules, profiles and every story with its recorded bodies.
        </p>

        <label className="flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink">
          <span className="shrink-0">Capture bodies up to</span>
          <select
            value={clampBodyLimit(settings.captureBodyLimit)}
            onChange={(event) =>
              onChange({ ...settings, captureBodyLimit: clampBodyLimit(Number(event.target.value)) })
            }
            className="field field-sm !w-auto"
          >
            {BODY_LIMITS.map((limit) => (
              <option key={limit} value={limit}>
                {formatBytes(limit)}
              </option>
            ))}
          </select>
        </label>
        <p className="m-0 text-[11px] leading-relaxed text-faint">
          A response over this size is stored truncated — and a truncated body is broken JSON, so it
          cannot be turned into a stub or replayed in a story. Raise it for an app with large
          payloads; the log keeps fewer of them in memory.
        </p>

        <label className="flex items-center gap-2 border-t border-line pt-3 text-[12px] text-ink">
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(event) => onChange({ ...settings, syncEnabled: event.target.checked })}
          />
          Sync settings, rules and profiles through my browser account
        </label>
        <p className="m-0 text-[11px] leading-relaxed text-faint">
          Stories and recorded bodies stay on this machine — the sync quota is 100 KB. Share those
          with the export file.
        </p>
        {settings.syncStatus && <p className="m-0 text-[11px] text-warn">{settings.syncStatus}</p>}

        <div className="flex flex-wrap gap-1.5 border-t border-line pt-3">
          <button
            onClick={() => onTrim(clampBodyLimit(settings.captureBodyLimit) / 1024)}
            className="btn btn-ghost"
            title="Drops stored bodies bigger than what this install captures today"
          >
            Trim bodies over {formatBytes(clampBodyLimit(settings.captureBodyLimit))}
          </button>
          <button onClick={onCollectGarbage} className="btn btn-ghost">
            Delete unused bodies
          </button>
        </div>
        {busy && <p className="m-0 text-[11px] text-mute">{busy}</p>}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
