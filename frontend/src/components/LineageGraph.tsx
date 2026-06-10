import { useMemo } from 'react'

type Edge = { src: string; dst: string }

const NODE_W = 170
const NODE_H = 30
const COL_GAP = 230
const ROW_GAP = 40
const MAX_NODES = 80

export function LineageGraph({
  nodeNames,
  edges,
  focal,
  onFocus,
}: {
  nodeNames: string[]
  edges: Edge[]
  focal: string
  onFocus: (name: string) => void
}) {
  const { layers, positions, visibleEdges, truncated } = useMemo(() => {
    let names = nodeNames
    let edgeList = edges
    let wasTruncated = false
    if (names.length > MAX_NODES) {
      if (focal) {
        // Show the focal's 2-hop neighborhood only.
        const keep = new Set<string>([focal])
        for (const e of edges) {
          if (e.src === focal) keep.add(e.dst)
          if (e.dst === focal) keep.add(e.src)
        }
        for (const e of edges) {
          if (keep.has(e.src) || keep.has(e.dst)) {
            keep.add(e.src)
            keep.add(e.dst)
          }
        }
        names = names.filter((n) => keep.has(n))
        edgeList = edges.filter((e) => keep.has(e.src) && keep.has(e.dst))
      }
      if (names.length > MAX_NODES) {
        names = names.slice(0, MAX_NODES)
        const allowed = new Set(names)
        edgeList = edgeList.filter((e) => allowed.has(e.src) && allowed.has(e.dst))
        wasTruncated = true
      }
    }

    // Longest-path layering (cycle-tolerant).
    const layer = new Map<string, number>(names.map((n) => [n, 0]))
    const inGraph = new Set(names)
    for (let pass = 0; pass < 12; pass++) {
      let changed = false
      for (const e of edgeList) {
        if (!inGraph.has(e.src) || !inGraph.has(e.dst)) continue
        const next = (layer.get(e.src) ?? 0) + 1
        if (next > (layer.get(e.dst) ?? 0) && next < 24) {
          layer.set(e.dst, next)
          changed = true
        }
      }
      if (!changed) break
    }
    const byLayer = new Map<number, string[]>()
    for (const n of names) {
      const l = layer.get(n) ?? 0
      byLayer.set(l, [...(byLayer.get(l) ?? []), n])
    }
    const sortedLayers = [...byLayer.entries()].sort((a, b) => a[0] - b[0])
    const pos = new Map<string, { x: number; y: number }>()
    sortedLayers.forEach(([, members], col) => {
      members.sort()
      members.forEach((n, row) => {
        pos.set(n, { x: 20 + col * COL_GAP, y: 20 + row * ROW_GAP })
      })
    })
    return {
      layers: sortedLayers,
      positions: pos,
      visibleEdges: edgeList,
      truncated: wasTruncated,
    }
  }, [nodeNames, edges, focal])

  if (!layers.length) return null
  const width = 40 + layers.length * COL_GAP
  const height = 40 + Math.max(...layers.map(([, m]) => m.length)) * ROW_GAP
  const neighbors = new Set<string>()
  for (const e of visibleEdges) {
    if (e.src === focal) neighbors.add(e.dst)
    if (e.dst === focal) neighbors.add(e.src)
  }

  return (
    <section className="border border-slate-200 rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-slate-700">Graph</h2>
        {truncated && (
          <span className="text-xs text-amber-600">
            Large estate — showing the {MAX_NODES} most referenced objects; use search below.
          </span>
        )}
      </div>
      <div className="overflow-auto max-h-[420px]">
        <svg width={width} height={height} className="block">
          {visibleEdges.map((e) => {
            const a = positions.get(e.src)
            const b = positions.get(e.dst)
            if (!a || !b) return null
            const x1 = a.x + NODE_W
            const y1 = a.y + NODE_H / 2
            const x2 = b.x
            const y2 = b.y + NODE_H / 2
            const onPath = focal && (e.src === focal || e.dst === focal)
            return (
              <path
                key={`${e.src}->${e.dst}`}
                d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={onPath ? '#1f6feb' : '#cbd5e1'}
                strokeWidth={onPath ? 2 : 1.2}
              />
            )
          })}
          {[...positions.entries()].map(([name, p]) => {
            const isFocal = name === focal
            const isNeighbor = neighbors.has(name)
            const dim = focal && !isFocal && !isNeighbor
            return (
              <g
                key={name}
                transform={`translate(${p.x}, ${p.y})`}
                onClick={() => onFocus(name)}
                className="cursor-pointer"
                opacity={dim ? 0.35 : 1}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={6}
                  fill={isFocal ? '#1f6feb' : isNeighbor ? '#e0ecff' : 'white'}
                  stroke={isFocal || isNeighbor ? '#1f6feb' : '#cbd5e1'}
                  strokeWidth={1.2}
                />
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isFocal ? 'white' : '#334155'}
                >
                  {name.length > 24 ? `${name.slice(0, 23)}…` : name}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </section>
  )
}
