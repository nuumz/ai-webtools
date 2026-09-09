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
    <nav className="flex px-2" role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(tab.id)}
            className={`flex-1 px-2 py-2 text-xs border-b-2 transition-colors ${
              selected
                ? 'border-blue-400 text-white font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`ml-1 ${selected ? 'text-blue-300' : 'text-slate-500'}`}>{tab.count}</span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
