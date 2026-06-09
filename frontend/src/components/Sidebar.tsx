import type { View } from '../types'
import {
  AnalyzerNavIcon,
  ConverterNavIcon,
  HomeIcon,
  ProfilerNavIcon,
} from './Icons'

type Item = { key: View; label: string; icon: () => JSX.Element }

const ITEMS: Item[] = [
  { key: 'home', label: 'Home', icon: () => <HomeIcon /> },
  { key: 'profiler', label: 'Profiler', icon: () => <ProfilerNavIcon /> },
  { key: 'analyzer', label: 'Analyzer', icon: () => <AnalyzerNavIcon /> },
  { key: 'converter', label: 'Converter', icon: () => <ConverterNavIcon /> },
]

export function Sidebar({ active, onSelect }: { active: View; onSelect: (v: View) => void }) {
  return (
    <nav className="w-56 shrink-0 bg-[#fafafa] border-r border-slate-200 py-4 px-3">
      <ul className="flex flex-col gap-1">
        {ITEMS.map((item) => {
          const isActive = item.key === active
          return (
            <li key={item.key}>
              <button
                onClick={() => onSelect(item.key)}
                className={
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition ' +
                  (isActive
                    ? 'bg-[#e0ecff] text-[#1f6feb] font-medium'
                    : 'text-slate-700 hover:bg-slate-100')
                }
              >
                <span className={isActive ? 'text-[#1f6feb]' : 'text-slate-500'}>{item.icon()}</span>
                {item.label}
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
