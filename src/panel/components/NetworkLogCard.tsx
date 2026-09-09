import { useMemo, useState } from 'react';
import ExchangeDetail from './ExchangeDetail';
import type { ExchangeMeta } from '../../shared/capture';
import type { StoryMeta } from '../../shared/story';
import type { NetworkLogState } from '../hooks/useNetworkLog';
import type { RuleDraft } from './RuleForm';

const NEW_STORY = '__new__';

interface Props {
  log: NetworkLogState;
  capturing: boolean;
  stories: StoryMeta[];
  onToggleCapture: () => void;
  onCreateRule: (draft: RuleDraft) => void;
  onSaveToStory: (exchangeIds: string[], target: { storyId?: string; name?: string }) => Promise<void>;
}

export default function NetworkLogCard({
  log,
  capturing,
  stories,
  onToggleCapture,
  onCreateRule,
  onSaveToStory,
}: Props) {
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [target, setTarget] = useState<string>(NEW_STORY);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleSelected = (id: string) =>
    setSelected((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const save = async () => {
    if (selected.length === 0 || saving) return;
    setSaving(true);
    try {
      await onSaveToStory(
        selected,
        target === NEW_STORY ? { name: newName.trim() || 'Story' } : { storyId: target },
      );
      setSelected([]);
      setNewName('');
    } finally {
      setSaving(false);
    }
  };

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = needle ? log.entries.filter((e) => e.url.toLowerCase().includes(needle)) : log.entries;
    // Newest first: the request you just triggered is the one you want.
    return [...rows].reverse();
  }, [log.entries, filter]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between p-3 border-b border-gray-200 gap-2">
        <p className="text-[11px] text-gray-500">
          {log.entries.length === 1 ? '1 request' : `${log.entries.length} requests`}
          {log.dropped > 0 && <span className="text-amber-600"> · {log.dropped} dropped</span>}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={onToggleCapture}
            className={`text-xs px-2.5 py-1.5 rounded-md transition-colors ${
              capturing ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            {capturing ? '● Recording' : 'Record'}
          </button>
          {capturing && log.entries.length > 0 && (
            <button
              onClick={() => {
                setSelecting((on) => !on);
                setSelected([]);
              }}
              className={`text-xs px-2.5 py-1.5 rounded-md border ${
                selecting
                  ? 'border-slate-800 bg-slate-100 text-slate-800'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              Select
            </button>
          )}
          <button
            onClick={log.clear}
            className="text-xs px-2.5 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
      </div>

      {capturing && (
        <div className="p-3 pb-0">
          <input
            className="w-full border rounded p-1.5 text-xs"
            placeholder="Filter by URL…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      <div className="p-3 flex-1 min-h-0 flex flex-col">
        {!capturing ? (
          <p className="text-xs text-gray-400 italic text-center py-4">
            Recording is off — turn it on, then reload the page to see its traffic.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-gray-400 italic text-center py-4">
            No requests yet on this tab.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded flex-1 min-h-0 overflow-y-auto">
            {visible.map((exchange) => (
              <li key={exchange.id}>
                <div className="flex items-center gap-2 px-2 hover:bg-slate-50">
                  {selecting && (
                    <input
                      type="checkbox"
                      className="shrink-0 disabled:opacity-30"
                      checked={selected.includes(exchange.id)}
                      onChange={() => toggleSelected(exchange.id)}
                      // Saving a replayed response would record the mock as if it were real.
                      disabled={exchange.servedBy !== 'network'}
                      title={
                        exchange.servedBy === 'network'
                          ? 'Select for a story'
                          : 'Already served by a mock — only real responses can be recorded'
                      }
                    />
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === exchange.id ? null : exchange.id)}
                    className="flex-1 min-w-0 py-1.5 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500 w-9 shrink-0">{exchange.method}</span>
                      <span className={`text-[10px] font-bold w-8 shrink-0 ${statusColor(exchange)}`}>
                        {exchange.status || '—'}
                      </span>
                      <span className="text-[11px] text-gray-700 truncate flex-1" title={exchange.url}>
                        {exchange.pathname}
                        {exchange.search && <span className="text-gray-400">{exchange.search}</span>}
                      </span>
                      {exchange.servedBy !== 'network' && <ServedByChip servedBy={exchange.servedBy} />}
                    </span>
                    <span className="flex items-center gap-2 pl-[4.6rem] text-[10px] text-gray-400">
                      <span>{exchange.durationMs} ms</span>
                      {exchange.resBytes > 0 && <span>· {formatBytes(exchange.resBytes)}</span>}
                      {exchange.transport === 'xhr' && <span>· XHR</span>}
                    </span>
                  </button>
                </div>
                {expandedId === exchange.id && (
                  <ExchangeDetail
                    exchange={exchange}
                    bodies={log.bodies[exchange.id]}
                    onLoadBody={log.loadBody}
                    onCreateRule={onCreateRule}
                  />
                )}
              </li>
            ))}
          </ul>
        )}

        {selecting && selected.length > 0 && (
          <div className="mt-3 border-t border-gray-200 pt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-gray-600">{selected.length} selected →</span>
            <select
              className="border rounded p-1 text-[11px]"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value={NEW_STORY}>＋ New story</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.name}
                </option>
              ))}
            </select>
            {target === NEW_STORY && (
              <input
                className="border rounded p-1 text-[11px] flex-1 min-w-[6rem]"
                placeholder="Story name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            )}
            <button
              onClick={save}
              disabled={saving}
              className="bg-slate-800 text-white rounded px-2.5 py-1 text-[11px] hover:bg-slate-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save to story'}
            </button>
            <button
              onClick={() => setSelected([])}
              className="text-[11px] text-gray-500 hover:underline"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Three different things happened to these responses, so they must not look
 * alike: replayed from a recording, faked outright, or real but altered.
 */
function ServedByChip({ servedBy }: { servedBy: ExchangeMeta['servedBy'] }) {
  const styles: Record<string, string> = {
    story: 'text-teal-700 bg-teal-50 border-teal-200',
    stub: 'text-slate-700 bg-slate-100 border-slate-300',
    mutated: 'text-violet-700 bg-violet-50 border-violet-200',
  };
  return (
    <span
      className={`text-[9px] uppercase font-bold rounded border px-1 py-0.5 shrink-0 ${styles[servedBy] ?? styles.stub}`}
    >
      {servedBy}
    </span>
  );
}

function statusColor(exchange: ExchangeMeta): string {
  if (exchange.outcome !== 'ok' || exchange.status === 0) return 'text-red-600';
  if (exchange.status >= 500) return 'text-red-600';
  if (exchange.status >= 400) return 'text-amber-600';
  if (exchange.status >= 300) return 'text-slate-500';
  return 'text-emerald-600';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
