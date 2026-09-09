export type TabId = 'network' | 'mocks' | 'fill' | 'settings';

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
    <nav className="flex gap-1 px-3" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={`flex items-center gap-1.5 px-2.5 py-2 text-[12px] border-b-2 transition-colors ${
              selected
                ? 'border-accent text-ink font-medium'
                : 'border-transparent text-faint hover:text-mute'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span
                className={`tabular-nums text-[10px] ${selected ? 'text-accent' : 'text-faint'}`}
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
