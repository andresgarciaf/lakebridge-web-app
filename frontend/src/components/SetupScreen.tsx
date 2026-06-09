import { useEffect, useRef } from 'react'
import { LakebridgeLogo } from './LakebridgeLogo'

type Props = {
  status: 'pending' | 'running' | 'error'
  logs: string[]
  error: string | null
}

export function SetupScreen({ status, logs, error }: Props) {
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  const headline =
    status === 'error'
      ? 'Setup failed'
      : status === 'pending'
      ? 'Preparing setup…'
      : 'Setting up Lakebridge'

  const subline =
    status === 'error'
      ? error ?? 'Unknown error'
      : 'Installing the Databricks CLI and the lakebridge labs project. This happens once.'

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white px-6">
      <LakebridgeLogo height={56} />
      <h2 className="mt-10 text-xl font-medium">{headline}</h2>
      <p className="mt-2 text-slate-600 max-w-xl text-center">{subline}</p>
      {status !== 'error' && (
        <div className="mt-6 flex items-center gap-2 text-slate-500">
          <span className="inline-block w-2 h-2 rounded-full bg-[#FF3621] animate-pulse" />
          <span className="inline-block w-2 h-2 rounded-full bg-[#FF3621] animate-pulse [animation-delay:150ms]" />
          <span className="inline-block w-2 h-2 rounded-full bg-[#FF3621] animate-pulse [animation-delay:300ms]" />
        </div>
      )}
      <pre
        ref={logRef}
        className="mt-8 w-full max-w-3xl h-64 overflow-auto bg-slate-900 text-slate-100 text-xs rounded-lg p-4 font-mono whitespace-pre-wrap"
      >
        {logs.length === 0 ? 'Waiting for output…' : logs.join('\n')}
      </pre>
    </div>
  )
}
