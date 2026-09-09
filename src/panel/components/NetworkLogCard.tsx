import { useMemo, useState } from 'react';
import ExchangeDetail from './ExchangeDetail';
import type { ExchangeMeta } from '../../shared/capture';
import type { NetworkLogState } from '../hooks/useNetworkLog';
import type { RuleDraft } from './RuleForm';

interface Props {
  log: NetworkLogState;
  capturing: boolean;
  onToggleCapture: () => void;
  onCreateRule: (draft: RuleDraft) => void;
}

export default function NetworkLogCard({ log, capturing, onToggleCapture, onCreateRule }: Props) {
  const [filter, setFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = needle ? log.entries.filter((e) => e.url.toLowerCase().includes(needle)) : log.entries;
    // Newest first: the request you just triggered is the one you want.
    return [...rows].reverse();
  }, [log.entries, filter]);

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
      <div className="flex items-center justify-between p-3 border-b border-gray-200">
        <div>
          <h2 className="font-semibold text-gray-700">Network</h2>
          <p className="text-[11px] text-gray-400">
            {log.entries.length} request(s)
            {log.dropped > 0 && <span className="text-amber-600"> · {log.dropped} dropped</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggleCapture}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              capturing ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-white'
            }`}
          >
            {capturing ? '● Recording' : 'Record'}
          </button>
          <button
            onClick={log.clear}
            className="text-xs px-3 py-1.5 rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
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

      <div className="p-3">
        {!capturing ? (
          <p className="text-xs text-gray-400 italic text-center py-4">
            Recording is off — turn it on, then reload the page to see its traffic.
          </p>
        ) : visible.length === 0 ? (
          <p className="text-xs text-gray-400 italic text-center py-4">
            No requests yet on this tab.
          </p>
        ) : (
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded">
            {visible.map((exchange) => (
              <li key={exchange.id}>
                <button
                  onClick={() => setExpandedId(expandedId === exchange.id ? null : exchange.id)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-slate-50"
                >
                  <span className="text-[10px] font-bold text-slate-500 w-10 shrink-0">{exchange.method}</span>
                  <span className={`text-[10px] font-bold w-8 shrink-0 ${statusColor(exchange)}`}>
                    {exchange.status || '—'}
                  </span>
                  <span className="text-[11px] text-gray-700 truncate flex-1" title={exchange.url}>
                    {exchange.pathname}
                    {exchange.search && <span className="text-gray-400">{exchange.search}</span>}
                  </span>
                  {exchange.servedBy !== 'network' && (
                    <span className="text-[9px] uppercase font-bold text-indigo-600 bg-indigo-50 rounded px-1 py-0.5 shrink-0">
                      {exchange.servedBy}
                    </span>
                  )}
                  <span className="text-[10px] text-gray-400 shrink-0">{formatBytes(exchange.resBytes)}</span>
                </button>
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
      </div>
    </div>
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
