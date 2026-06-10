import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AnalyzerRun } from '../InsightsPanel'
import { LineageGraph } from '../LineageGraph'

type LineageNode = {
  name: string
  actions: Record<string, number>
  files: number
  references: number
}

type LineageEdge = {
  src: string
  dst: string
  files: { file: string; action: string }[]
  file_count: number
}

type Lineage = { nodes: LineageNode[]; edges: LineageEdge[] }

export function LineageView({ embedded = false }: { embedded?: boolean }) {
  const [runs, setRuns] = useState<AnalyzerRun[]>([])
  const [selectedRun, setSelectedRun] = useState('')
  const [lineage, setLineage] = useState<Lineage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focal, setFocal] = useState('')
  const [filter, setFilter] = useState('')

  const refreshRuns = useCallback(() => {
    fetch('/api/analyzer/runs')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list: AnalyzerRun[] = d?.runs ?? []
        setRuns(list)
        if (list.length && !selectedRun) setSelectedRun(list[0].run_id)
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(refreshRuns, [refreshRuns])

  useEffect(() => {
    if (!selectedRun) return
    setLoading(true)
    setError(null)
    setFocal('')
    fetch(`/api/analyzer/runs/${selectedRun}/lineage`)
      .then(async (r) => {
        const d = await r.json()
        if (!r.ok) throw new Error(d?.error ?? `HTTP ${r.status}`)
        setLineage(d)
      })
      .catch((e) => {
        setLineage(null)
        setError((e as Error).message)
      })
      .finally(() => setLoading(false))
  }, [selectedRun])

  const upstream = useMemo(
    () => (lineage && focal ? lineage.edges.filter((e) => e.dst === focal) : []),
    [lineage, focal],
  )
  const downstream = useMemo(
    () => (lineage && focal ? lineage.edges.filter((e) => e.src === focal) : []),
    [lineage, focal],
  )
  const focalNode = lineage?.nodes.find((n) => n.name === focal) ?? null
  const visibleNodes = useMemo(
    () =>
      (lineage?.nodes ?? []).filter((n) =>
        n.name.toLowerCase().includes(filter.toLowerCase()),
      ),
    [lineage, filter],
  )

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-2">
        {embedded ? (
          <h2 className="text-lg font-semibold text-slate-900">Object lineage</h2>
        ) : (
          <h1 className="text-2xl font-semibold text-slate-900">Lineage</h1>
        )}
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">Analyzer run</span>
          <select
            value={selectedRun}
            onChange={(e) => setSelectedRun(e.target.value)}
            className="px-3 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f6feb] max-w-[280px]"
          >
            <option value="">{runs.length ? 'Select a run…' : 'No analyzer runs yet'}</option>
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {r.run_ts?.slice(0, 16)} · {r.source_tech} · {r.file_count} file(s)
              </option>
            ))}
          </select>
        </div>
      </div>
      <p className="text-sm text-slate-600 mb-6">
        Data flow derived from the analyzer&apos;s object relations: a script that reads one
        object and creates or writes another implies an edge between them, with the script kept
        on the edge. Granularity is per script, so multi-statement files may over-connect, and
        edge coverage follows what the analyzer extracts per statement type.
      </p>

      {loading && <p className="text-sm text-slate-500">Loading lineage…</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!loading && lineage && !lineage.nodes.length && (
        <p className="text-sm text-slate-500">
          No object relations recorded for this run. Run the Analyzer on SQL/ETL sources first.
        </p>
      )}

      {lineage && lineage.edges.length > 0 && (
        <LineageGraph
          nodeNames={lineage.nodes.map((n) => n.name)}
          edges={lineage.edges}
          focal={focal}
          onFocus={setFocal}
        />
      )}

      {lineage && lineage.nodes.length > 0 && !focal && (
        <section className="border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-900">
              Objects ({lineage.nodes.length}) — pick one to explore
            </h2>
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter objects…"
              className="px-3 py-1.5 rounded-md border border-slate-300 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
            />
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
            {visibleNodes.map((n) => (
              <li key={n.name}>
                <button
                  onClick={() => setFocal(n.name)}
                  className="w-full text-left px-3 py-2 rounded-md border border-slate-200 hover:border-[#1f6feb] hover:bg-[#f0f6ff] transition"
                >
                  <p className="text-sm font-medium text-slate-800 truncate">{n.name}</p>
                  <p className="text-xs text-slate-500">
                    {Object.entries(n.actions)
                      .map(([a, c]) => `${a} ×${c}`)
                      .join(' · ')}
                  </p>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lineage && focal && focalNode && (
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
          <NeighborColumn
            title={`Upstream (${upstream.length})`}
            empty="No upstream objects — this is a source."
            edges={upstream}
            neighborOf={(e) => e.src}
            onFocus={setFocal}
          />
          <div className="border-2 border-[#1f6feb] rounded-lg p-4 bg-[#f0f6ff]">
            <p className="text-xs uppercase tracking-wide text-[#1f6feb] mb-1">Focal object</p>
            <h2 className="text-lg font-semibold text-slate-900 break-all">{focal}</h2>
            <p className="text-sm text-slate-600 mt-2">
              {Object.entries(focalNode.actions)
                .map(([a, c]) => `${a} in ${c} file(s)`)
                .join(' · ')}
            </p>
            <button
              onClick={() => setFocal('')}
              className="mt-4 text-sm text-[#1f6feb] hover:underline"
            >
              ← Back to all objects
            </button>
          </div>
          <NeighborColumn
            title={`Downstream (${downstream.length})`}
            empty="No downstream objects — nothing is built from this."
            edges={downstream}
            neighborOf={(e) => e.dst}
            onFocus={setFocal}
          />
        </section>
      )}
    </div>
  )
}

function NeighborColumn({
  title,
  empty,
  edges,
  neighborOf,
  onFocus,
}: {
  title: string
  empty: string
  edges: LineageEdge[]
  neighborOf: (e: LineageEdge) => string
  onFocus: (name: string) => void
}) {
  return (
    <div className="border border-slate-200 rounded-lg p-4">
      <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>
      {!edges.length && <p className="text-sm text-slate-400">{empty}</p>}
      <ul className="space-y-2">
        {edges.map((e) => {
          const neighbor = neighborOf(e)
          return (
            <li key={`${e.src}->${e.dst}`}>
              <button
                onClick={() => onFocus(neighbor)}
                className="w-full text-left px-3 py-2 rounded-md border border-slate-200 hover:border-[#1f6feb] hover:bg-[#f0f6ff] transition"
              >
                <p className="text-sm font-medium text-slate-800 break-all">{neighbor}</p>
                <ul className="mt-1 space-y-0.5">
                  {e.files.slice(0, 4).map((f) => (
                    <li key={f.file + f.action} className="text-xs text-slate-500 truncate">
                      {f.file} <span className="text-slate-400">({f.action})</span>
                    </li>
                  ))}
                  {e.file_count > 4 && (
                    <li className="text-xs text-slate-400">+{e.file_count - 4} more script(s)</li>
                  )}
                </ul>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
