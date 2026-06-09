import { useEffect, useRef } from 'react'

type Props = {
  lines: string[]
  running: boolean
  exitCode: number | null
  onClear?: () => void
}

export function OutputPanel({ lines, running, exitCode }: Props) {
  const preRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight
  }, [lines])

  if (lines.length === 0 && !running) return null

  return (
    <div className="mt-6 border border-slate-200 rounded-lg overflow-hidden">
      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">Output</span>
        <span className="flex items-center gap-2 text-slate-600">
          {running ? (
            <>
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Running…
            </>
          ) : exitCode === 0 ? (
            <>
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Completed
            </>
          ) : (
            <>
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              Exit {exitCode ?? '?'}
            </>
          )}
        </span>
      </div>
      <pre
        ref={preRef}
        className="h-72 overflow-auto bg-slate-900 text-slate-100 text-xs p-4 font-mono whitespace-pre-wrap"
      >
        {lines.join('\n')}
      </pre>
    </div>
  )
}
