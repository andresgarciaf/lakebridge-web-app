import type { View } from '../types'
import {
  AnalyzerNavIcon,
  ConverterNavIcon,
  HomeIcon,
  ProfilerNavIcon,
  ReconcileNavIcon,
} from './Icons'

type Item = { key: View; label: string; icon: () => JSX.Element }

const UTILITIES: Item[] = [
  { key: 'profiler', label: 'Profiler', icon: () => <ProfilerNavIcon /> },
  { key: 'analyzer', label: 'Analyzer', icon: () => <AnalyzerNavIcon /> },
  { key: 'converter', label: 'Converter', icon: () => <ConverterNavIcon /> },
  { key: 'reconcile', label: 'Reconcile', icon: () => <ReconcileNavIcon /> },
]

function NavButton({
  item,
  active,
  onSelect,
}: {
  item: Item
  active: boolean
  onSelect: (v: View) => void
}) {
  return (
    <button
      onClick={() => onSelect(item.key)}
      className={
        'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors border-l-2 ' +
        (active
          ? 'bg-[#e0ecff] text-[#1f6feb] font-medium border-[#1f6feb]'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-transparent')
      }
    >
      <span className={active ? 'text-[#1f6feb]' : 'text-slate-400'}>{item.icon()}</span>
      {item.label}
    </button>
  )
}

export function Sidebar({ active, onSelect }: { active: View; onSelect: (v: View) => void }) {
  return (
    <nav className="w-56 shrink-0 bg-[#fafafa] border-r border-slate-200 py-4 px-3 flex flex-col overflow-y-auto">
      <NavButton
        item={{ key: 'home', label: 'Home', icon: () => <HomeIcon /> }}
        active={active === 'home'}
        onSelect={onSelect}
      />
      <p className="px-3 pt-5 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        Utilities
      </p>
      <ul className="flex flex-col gap-1">
        {UTILITIES.map((item) => (
          <li key={item.key}>
            <NavButton item={item} active={item.key === active} onSelect={onSelect} />
          </li>
        ))}
      </ul>
    </nav>
  )
}
