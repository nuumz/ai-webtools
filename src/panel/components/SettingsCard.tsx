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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-3 border-b pb-2">
        <h2 className="font-semibold text-gray-700">Backup &amp; sync</h2>
        <span className="text-[11px] text-gray-400">{formatBytes(usageBytes)} stored</span>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button
            onClick={onExport}
            className="bg-slate-800 text-white rounded px-3 py-1.5 text-xs hover:bg-slate-700"
          >
            Export file
          </button>
          <button
            onClick={() => pickFile('merge')}
            className="border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Import (merge)
          </button>
          <button
            onClick={() => pickFile('replace')}
            className="border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
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
        <p className="text-[11px] text-gray-400">
          One self-contained file: rules, profiles and every story with its recorded bodies.
        </p>

        <label className="flex items-center gap-2 text-xs text-gray-700 border-t pt-3">
          <input
            type="checkbox"
            checked={settings.syncEnabled}
            onChange={(event) => onChange({ ...settings, syncEnabled: event.target.checked })}
          />
          Sync settings, rules and profiles through my browser account
        </label>
        <p className="text-[11px] text-gray-400">
          Stories and recorded bodies stay on this machine — the sync quota is 100 KB. Share those
          with the export file.
        </p>
        {settings.syncStatus && <p className="text-[11px] text-amber-600">{settings.syncStatus}</p>}

        <div className="flex flex-wrap gap-2 border-t pt-3">
          <button
            onClick={() => onTrim(TRIM_ABOVE_KB)}
            className="border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Trim bodies over {TRIM_ABOVE_KB} KB
          </button>
          <button
            onClick={onCollectGarbage}
            className="border border-slate-300 rounded px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          >
            Delete unused bodies
          </button>
        </div>
        {busy && <p className="text-[11px] text-slate-500">{busy}</p>}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
