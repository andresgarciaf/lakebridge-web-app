export type AnalyzerRun = {
  run_id: string
  run_ts: string
  source_tech: string
  workspace_dir: string
  url: string
  file_count: number
  total_lines: number
  total_statements: number
  complexity: Record<string, number>
}

export type RunInsights = {
  functions: { name: string; count: number }[]
  categories: { name: string; count: number }[]
  objects: { action: string; objects: number; references: number }[]
  largest_files: { file: string; complexity: string; lines: number; statements: number }[]
}

const COMPLEXITY_ORDER = ['LOW', 'MEDIUM', 'COMPLEX', 'VERY_COMPLEX', 'UNKNOWN']
const COMPLEXITY_COLOR: Record<string, string> = {
  LOW: 'bg-emerald-400',
  MEDIUM: 'bg-amber-400',
  COMPLEX: 'bg-orange-500',
  VERY_COMPLEX: 'bg-red-500',
  UNKNOWN: 'bg-slate-300',
}

export function InsightsPanel({
  run,
  insights,
  loading,
}: {
  run: AnalyzerRun
  insights: RunInsights | null
  loading: boolean
}) {
  return (
    <section className="border border-slate-200 rounded-lg p-5 mt-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-900">
            Run {run.run_id} — {run.source_tech}
          </h2>
          <p className="text-sm text-slate-500">
            {run.run_ts} ·{' '}
            <a href={run.url} className="text-[#1f6feb] underline" target="_blank" rel="noreferrer">
              {run.workspace_dir}
            </a>
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Stat label="Files" value={run.file_count} />
        <Stat label="Lines" value={run.total_lines} />
        <Stat label="Statements" value={run.total_statements} />
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">Complexity</p>
          <div className="flex h-6 rounded overflow-hidden border border-slate-200">
            {COMPLEXITY_ORDER.filter((l) => run.complexity[l]).map((level) => (
              <div
                key={level}
                title={`${level}: ${run.complexity[level]}`}
                className={`${COMPLEXITY_COLOR[level]} h-full`}
                style={{ width: `${(100 * run.complexity[level]) / Math.max(1, run.file_count)}%` }}
              />
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {COMPLEXITY_ORDER.filter((l) => run.complexity[l])
              .map((l) => `${l.toLowerCase()} ${run.complexity[l]}`)
              .join(' · ')}
          </p>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading insights…</p>}
      {insights && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <BarList
            title="Top function calls"
            items={insights.functions.map((f) => ({ name: f.name, value: f.count }))}
          />
          <BarList
            title="Script categories"
            items={insights.categories.map((c) => ({ name: c.name, value: c.count }))}
          />
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-2">Object interactions</h3>
            <ul className="space-y-1 text-sm text-slate-700">
              {insights.objects.map((o) => (
                <li key={o.action} className="flex justify-between">
                  <span className="capitalize">{o.action}</span>
                  <span className="text-slate-500">
                    {o.objects} object(s) · {o.references} ref(s)
                  </span>
                </li>
              ))}
              {!insights.objects.length && <li className="text-slate-400">none recorded</li>}
            </ul>
            <h3 className="text-sm font-semibold text-slate-700 mt-4 mb-2">Largest files</h3>
            <ul className="space-y-1 text-xs text-slate-600">
              {insights.largest_files.slice(0, 6).map((f) => (
                <li key={f.file} className="flex justify-between gap-2">
                  <span className="truncate">{f.file}</span>
                  <span className="shrink-0 text-slate-400">
                    {f.lines} ln · {f.complexity}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-slate-900">{value.toLocaleString()}</p>
    </div>
  )
}

function BarList({ title, items }: { title: string; items: { name: string; value: number }[] }) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.name} className="text-xs text-slate-600">
            <div className="flex justify-between mb-0.5">
              <span className="truncate">{item.name}</span>
              <span className="text-slate-400 shrink-0">{item.value}</span>
            </div>
            <div className="h-1.5 rounded bg-slate-100">
              <div
                className="h-1.5 rounded bg-[#1f6feb]"
                style={{ width: `${(100 * item.value) / max}%` }}
              />
            </div>
          </li>
        ))}
        {!items.length && <li className="text-slate-400 text-xs">none recorded</li>}
      </ul>
    </div>
  )
}
