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
    return [...rows].reverse();
  }, [log.entries, filter]);

  return (
    <div className="panel-card flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <p className="m-0 text-[11px] text-faint">
          {log.entries.length === 1 ? '1 request' : `${log.entries.length} requests`}
          {log.dropped > 0 && <span className="text-warn"> · {log.dropped} dropped</span>}
        </p>
        <div className="flex gap-1.5">
          <button
            onClick={onToggleCapture}
            className={`btn ${capturing ? 'btn-live' : 'btn-secondary'}`}
          >
            {capturing ? 'Recording' : 'Record'}
          </button>
          {capturing && log.entries.length > 0 && (
            <button
              onClick={() => {
                setSelecting((on) => !on);
                setSelected([]);
              }}
              className={`btn btn-ghost ${selecting ? 'is-on' : ''}`}
            >
              Select
            </button>
          )}
          <button onClick={log.clear} className="btn btn-ghost">
            Clear
          </button>
        </div>
      </div>

      {capturing && (
        <div className="px-3 pt-2">
          <input
            className="field field-mono field-sm"
            placeholder="Filter by URL…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col p-3">
        {!capturing ? (
          <p className="panel-empty">
            Recording is off — turn it on, then reload the page to see its traffic.
          </p>
        ) : visible.length === 0 ? (
          <p className="panel-empty">No requests yet on this tab.</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-md)] border border-line">
            {visible.map((exchange) => (
              <li key={exchange.id} className="border-b border-line last:border-b-0">
                <div className="flex items-center gap-2 px-2 hover:bg-raised/60">
                  {selecting && (
                    <input
                      type="checkbox"
                      className="shrink-0 disabled:opacity-30"
                      checked={selected.includes(exchange.id)}
                      onChange={() => toggleSelected(exchange.id)}
                      disabled={exchange.servedBy !== 'network' || exchange.outcome === 'pending'}
                      title={
                        exchange.outcome === 'pending'
                          ? 'Still in flight'
                          : exchange.servedBy === 'network'
                            ? 'Select for a story'
                            : 'Already served by a mock — only real responses can be recorded'
                      }
                    />
                  )}
                  <button
                    onClick={() => setExpandedId(expandedId === exchange.id ? null : exchange.id)}
                    className="min-w-0 flex-1 py-1.5 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <span className="w-9 shrink-0 font-mono text-[10px] font-semibold tabular-nums text-mute">
                        {exchange.method}
                      </span>
                      <span
                        className={`w-8 shrink-0 font-mono text-[10px] font-semibold tabular-nums ${statusColor(exchange)}`}
                      >
                        {exchange.outcome === 'pending' && !exchange.status ? '…' : exchange.status || '—'}
                      </span>
                      <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink" title={exchange.url}>
                        {exchange.pathname}
                        {exchange.search && <span className="text-faint">{exchange.search}</span>}
                      </span>
                      {exchange.outcome === 'pending' && (
                        <span className="chip chip-pending shrink-0">in progress</span>
                      )}
                      {exchange.servedBy !== 'network' && <ServedByChip servedBy={exchange.servedBy} />}
                    </span>
                    <span className="flex items-center gap-2 pl-[4.6rem] font-mono text-[10px] tabular-nums text-faint">
                      <span>{exchange.outcome === 'pending' ? 'pending' : `${exchange.durationMs} ms`}</span>
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
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-[11px] text-mute">{selected.length} selected →</span>
            <select
              className="field field-sm !w-auto"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
            >
              <option value={NEW_STORY}>New story</option>
              {stories.map((story) => (
                <option key={story.id} value={story.id}>
                  {story.name}
                </option>
              ))}
            </select>
            {target === NEW_STORY && (
              <input
                className="field field-sm min-w-[6rem] flex-1"
                placeholder="Story name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            )}
            <button onClick={save} disabled={saving} className="btn btn-primary">
              {saving ? 'Saving…' : 'Save to story'}
            </button>
            <button onClick={() => setSelected([])} className="btn-link">
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ServedByChip({ servedBy }: { servedBy: ExchangeMeta['servedBy'] }) {
  const styles: Record<string, string> = {
    story: 'chip-ok',
    stub: '',
    mutated: 'chip-accent',
  };
  return <span className={`chip shrink-0 ${styles[servedBy] ?? ''}`}>{servedBy}</span>;
}

function statusColor(exchange: ExchangeMeta): string {
  if (exchange.outcome === 'pending') return 'text-faint';
  if (exchange.outcome !== 'ok' || exchange.status === 0) return 'text-bad';
  if (exchange.status >= 500) return 'text-bad';
  if (exchange.status >= 400) return 'text-warn';
  if (exchange.status >= 300) return 'text-faint';
  return 'text-ok';
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.round(bytes / 1024)} KB`;
}
