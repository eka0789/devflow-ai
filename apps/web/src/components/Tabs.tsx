import type { JSX } from 'react';

export interface TabDef {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  tabs,
  active,
  onChange,
  pills,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  pills?: boolean;
}): JSX.Element {
  return (
    <div className={`tabs ${pills ? 'tabs-pills' : ''}`} role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={tab.id === active}
          className={`tab ${tab.id === active ? 'active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="tab-count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
