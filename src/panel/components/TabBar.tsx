export type TabId = 'network' | 'mocks' | 'fill';

interface Tab {
  id: TabId;
  label: string;
  count?: number;
}

interface Props {
  active: TabId;
  tabs: Tab[];
  onSelect: (id: TabId) => void;
}

export default function TabBar({ active, tabs, onSelect }: Props) {
  return (
    <nav className="flex shrink-0 items-stretch gap-4 border-b border-line bg-surface px-3" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={`-mb-px flex items-center gap-1.5 border-b-2 pt-1.5 pb-2 text-[12px] transition-colors ${
              selected
                ? 'border-accent font-medium text-ink'
                : 'border-transparent text-faint hover:text-mute'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`min-w-4 rounded-[3px] px-1 text-center text-[10px] font-semibold tabular-nums ${
                  selected ? 'bg-accent-soft text-accent' : 'bg-raised text-faint'
                }`}
              >
                {tab.count}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
