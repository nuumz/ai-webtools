import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import ExchangeDetail from './ExchangeDetail';
import { IconChecklist, IconClear, IconRecord, IconSearch, IconStop } from './icons';
import { durationColor, formatClock, formatDuration } from '../format';
import type { ExchangeMeta } from '../../shared/capture';
import type { StoryMeta } from '../../shared/story';
import type { FormCase, FormProfile } from '../../shared/form';
import type { NetworkLogState } from '../hooks/useNetworkLog';
import type { RuleDraft } from './RuleForm';

const NEW_STORY = '__new__';
const PANE_MIN = 120;

interface Props {
  log: NetworkLogState;
  stories: StoryMeta[];
  /** Passed through: a case saved from a response has to belong to one. */
  profiles: FormProfile[];
  cases: FormCase[];
  onCreateRule: (draft: RuleDraft) => void;
  onSaveCase: (formCase: FormCase) => void;
  onReloadTab: () => void;
  onSaveToStory: (
    exchangeIds: string[],
    target: { storyId?: string; name?: string },
  ) => Promise<void>;
}

export default function NetworkLogCard({
  log,
  stories,
  profiles,
  cases,
  onCreateRule,
  onSaveCase,
  onReloadTab,
  onSaveToStory,
}: Props) {
  const capturing = log.recording;
  const toggleCapture = () => log.setRecording(!log.recording);
  // Recording, but nothing in the tab is talking to the worker: whatever is
  // already listed stays, and nothing new can arrive until a script runs.
  const darkTab = capturing && !log.pageConnected && !log.tabClosed;
  const [filter, setFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [marked, setMarked] = useState<string[]>([]);
  const [target, setTarget] = useState<string>(NEW_STORY);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);
  const [paneHeight, setPaneHeight] = useState(260);
  const listRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = needle
      ? log.entries.filter((e) => e.url.toLowerCase().includes(needle))
      : log.entries;
    return [...rows].reverse();
  }, [log.entries, filter]);

  const selected = visible.find((exchange) => exchange.id === selectedId);
  const inFlight = log.entries.some((exchange) => exchange.outcome === 'pending');

  // A request that has not answered yet shows its elapsed time counting up, so a
  // hung endpoint is visible as such instead of sitting at a frozen dash. The
  // interval only exists while something is actually in flight.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!inFlight) return;
    const timer = window.setInterval(() => setNow(Date.now()), 150);
    return () => window.clearInterval(timer);
  }, [inFlight]);

  // A row that scrolls out of the log — or gets filtered away — must not leave a
  // detail pane describing something the user can no longer see in the list.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const toggleMarked = (id: string) =>
    setMarked((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );

  const save = async () => {
    if (marked.length === 0 || saving) return;
    setSaving(true);
    try {
      await onSaveToStory(
        marked,
        target === NEW_STORY ? { name: newName.trim() || 'Story' } : { storyId: target },
      );
      setMarked([]);
      setNewName('');
    } finally {
      setSaving(false);
    }
  };

  /** ↑/↓ walks the log the way a devtools list should; Esc drops the pane. */
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      setSelectedId(null);
      return;
    }
    const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || visible.length === 0) return;
    event.preventDefault();
    const at = visible.findIndex((exchange) => exchange.id === selectedId);
    const next = at === -1 ? (step > 0 ? 0 : visible.length - 1) : at + step;
    const row = visible[Math.max(0, Math.min(visible.length - 1, next))];
    setSelectedId(row.id);
    listRef.current?.querySelector(`[data-row="${row.id}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const startResize = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = paneHeight;
      const ceiling = () => Math.max(PANE_MIN, (bodyRef.current?.clientHeight ?? 600) - 140);

      const move = (moveEvent: globalThis.PointerEvent) => {
        const next = startHeight + (startY - moveEvent.clientY);
        setPaneHeight(Math.max(PANE_MIN, Math.min(ceiling(), next)));
      };
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', stop);
    },
    [paneHeight],
  );

  return (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <div className="toolbar">
        <button
          onClick={toggleCapture}
          disabled={log.tabClosed}
          className={`btn btn-sm ${capturing ? 'btn-live' : 'btn-secondary'}`}
          title={capturing ? 'Stop capturing this tab' : 'Capture this tab’s traffic'}
        >
          {capturing ? <IconStop /> : <IconRecord className="text-bad" />}
          {capturing ? 'Stop' : 'Record'}
        </button>

        <div className="relative min-w-0 flex-1">
          <IconSearch className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            className="field field-mono field-sm !pl-7"
            placeholder="Filter by URL"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">
          {filter.trim() ? `${visible.length}/${log.entries.length}` : log.entries.length}
        </span>
        {log.dropped > 0 && (
          <span className="chip chip-warn" title="Requests the log could not keep">
            {log.dropped} dropped
          </span>
        )}

        <button
          onClick={() => {
            setSelecting((on) => !on);
            setMarked([]);
          }}
          disabled={log.entries.length === 0}
          aria-pressed={selecting}
          className={`btn btn-sm btn-icon ${selecting ? 'btn-on' : 'btn-ghost'}`}
          title="Pick responses to save as a story"
        >
          <IconChecklist />
        </button>
        <button
          onClick={log.clear}
          disabled={log.entries.length === 0}
          className="btn btn-sm btn-icon btn-ghost"
          title="Clear the log"
        >
          <IconClear />
        </button>
      </div>

      {darkTab && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--warn-line)] bg-warn-soft px-2 py-1.5">
          <span className="min-w-0 flex-1 text-[11px] text-warn">
            This page isn’t connected — new requests won’t be captured.
          </span>
          <button onClick={onReloadTab} className="btn btn-sm btn-secondary">
            Reload the tab
          </button>
        </div>
      )}

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="Captured requests"
        onKeyDown={onKeyDown}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
      >
        {!capturing ? (
          <p className="empty">
            Not capturing this tab.
            <br />
            <button
              onClick={toggleCapture}
              disabled={log.tabClosed}
              className="btn btn-sm btn-secondary mt-3"
            >
              <IconRecord className="text-bad" />
              Start recording
            </button>
          </p>
        ) : visible.length === 0 ? (
          <p className="empty">
            {log.entries.length > 0
              ? `No request matches “${filter.trim()}”.`
              : darkTab
                ? 'Nothing can be captured until a content script runs in this tab — one opened before the extension was loaded, or one the browser refuses to script.'
                : 'Nothing captured yet on this tab.'}
          </p>
        ) : (
          <ul className="m-0 list-none p-0">
            {visible.map((exchange) => {
              const replayable = exchange.servedBy === 'network' && exchange.outcome !== 'pending';
              const pending = exchange.outcome === 'pending';
              const elapsed = pending ? Math.max(0, now - exchange.startedAt) : exchange.durationMs;
              return (
                <li
                  key={exchange.id}
                  data-row={exchange.id}
                  role="option"
                  aria-selected={exchange.id === selectedId}
                  onClick={() => setSelectedId(exchange.id === selectedId ? null : exchange.id)}
                  className="log-row border-b border-line/60"
                >
                  {selecting && (
                    <input
                      type="checkbox"
                      className="shrink-0 disabled:opacity-30"
                      checked={marked.includes(exchange.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggleMarked(exchange.id)}
                      disabled={!replayable}
                      title={
                        exchange.outcome === 'pending'
                          ? 'Still in flight'
                          : replayable
                            ? 'Save this response to a story'
                            : 'Served by a mock — only real responses can be recorded'
                      }
                    />
                  )}
                  <span className="log-cell w-9 font-semibold text-mute">{exchange.method}</span>
                  <span className={`log-cell w-7 font-semibold ${statusColor(exchange)}`}>
                    {exchange.outcome === 'pending' && !exchange.status
                      ? '···'
                      : exchange.status || '—'}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink"
                    title={exchange.url}
                  >
                    {exchange.pathname}
                    {exchange.search && <span className="text-faint">{exchange.search}</span>}
                  </span>
                  {exchange.transport === 'xhr' && <span className="log-cell text-faint">xhr</span>}
                  {exchange.servedBy !== 'network' && <ServedByChip servedBy={exchange.servedBy} />}
                  {pending && <span className="chip chip-pending">live</span>}
                  <span className="log-cell text-faint" title="Started at">
                    {formatClock(exchange.startedAt)}
                  </span>
                  <span
                    className={`log-cell w-14 text-right ${pending ? 'text-accent' : durationColor(elapsed)}`}
                  >
                    {formatDuration(elapsed)}
                  </span>
                  <span className="log-cell w-12 text-right text-faint">
                    {formatBytes(exchange.resBytes)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {selecting && marked.length > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-2 py-2">
          <span className="text-[11px] text-mute">{marked.length} to save</span>
          <select
            className="field field-sm !w-auto"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          >
            <option value={NEW_STORY}>New story…</option>
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
          <button onClick={save} disabled={saving} className="btn btn-sm btn-primary">
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={() => setMarked([])} className="btn-link">
            Clear pick
          </button>
        </div>
      )}

      {selected && (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            tabIndex={0}
            onPointerDown={startResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowUp') setPaneHeight((h) => h + 24);
              if (event.key === 'ArrowDown') setPaneHeight((h) => Math.max(PANE_MIN, h - 24));
            }}
            title="Drag to resize"
            className="pane-grip"
          />
          <div
            style={{ height: paneHeight }}
            className="shrink-0 overflow-y-auto bg-surface shadow-[var(--shadow-pane)]"
          >
            <ExchangeDetail
              exchange={selected}
              bodies={log.bodies[selected.id]}
              profiles={profiles}
              cases={cases}
              onLoadBody={log.loadBody}
              onCreateRule={onCreateRule}
              onSaveCase={onSaveCase}
              onClose={() => setSelectedId(null)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ServedByChip({ servedBy }: { servedBy: ExchangeMeta['servedBy'] }) {
  const styles: Record<string, string> = {
    story: 'chip-ok',
    stub: '',
    mutated: 'chip-accent',
  };
  return <span className={`chip ${styles[servedBy] ?? ''}`}>{servedBy}</span>;
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
