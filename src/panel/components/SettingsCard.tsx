import { useRef } from 'react';
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

const TRIM_ABOVE_KB = 64;

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
          <button onClick={() => onTrim(TRIM_ABOVE_KB)} className="btn btn-ghost">
            Trim bodies over {TRIM_ABOVE_KB} KB
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
