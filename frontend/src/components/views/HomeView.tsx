import { LakebridgeLogo } from '../LakebridgeLogo'
import {
  AnalyzerCardIcon,
  ConverterCardIcon,
  ProfilerCardIcon,
} from '../Icons'
import type { View } from '../../types'

type Card = {
  key: View
  title: string
  description: string
  icon: () => JSX.Element
}

const CARDS: Card[] = [
  {
    key: 'profiler',
    title: 'Open profiler',
    description: 'Extract and analyze metadata from database systems.',
    icon: () => <ProfilerCardIcon />,
  },
  {
    key: 'analyzer',
    title: 'Open analyzer',
    description: 'Scan and interpret metadata from ETL pipelines and SQL assets.',
    icon: () => <AnalyzerCardIcon />,
  },
  {
    key: 'converter',
    title: 'Open converter',
    description:
      'Transpile SQL files written in any supported source dialect into their equivalent in Databricks SQL.',
    icon: () => <ConverterCardIcon />,
  },
]

export function HomeView({ onNavigate }: { onNavigate: (v: View) => void }) {
  return (
    <div className="flex flex-col">
      <section className="pt-20 pb-16 flex flex-col items-center text-center px-6">
        <LakebridgeLogo height={84} variant="lockup" />
        <p className="mt-10 text-lg text-slate-700 max-w-3xl">
          Migrate legacy data warehouses without complexity, cost surprises, or data quality concerns.
        </p>
      </section>

      <section className="bg-[#f4f3f1] -mx-6 px-6 py-16">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {CARDS.map((card) => (
            <button
              key={card.key}
              onClick={() => onNavigate(card.key)}
              className="text-left bg-[#ecebe8] hover:bg-[#e2e1de] active:bg-[#d8d7d4] transition rounded-xl p-7 flex flex-col gap-5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3621]"
            >
              <div>{card.icon()}</div>
              <div>
                <h2 className="text-lg font-semibold text-slate-900">{card.title}</h2>
                <p className="mt-3 text-slate-700 leading-relaxed text-sm">{card.description}</p>
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
