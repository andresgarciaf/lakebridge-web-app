import { useState } from 'react'
import { DashboardIcon, GearIcon, LinkIcon } from '../Icons'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'

const SUBSCRIPTIONS = ['Select subscription']

export function ProfilerView() {
  const [connected, setConnected] = useState(false)
  const [subscription, setSubscription] = useState(SUBSCRIPTIONS[0])
  const { lines, running, exitCode, start, reset } = useRun('profiler')

  return (
    <div className="max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Synapse Workspace Profiler</h1>

      <StepCard title="Step 1. Configuration">
        <div className="flex items-center gap-2 text-slate-700 mb-4">
          <LinkIcon />
          <span>{connected ? 'Connection ready' : 'No connection configured yet'}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setConnected(false)}
            className="px-4 py-2 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1]"
          >
            Add
          </button>
          <button
            onClick={() => setConnected(true)}
            className="px-4 py-2 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1]"
          >
            Connected
          </button>
          <Select value={subscription} onChange={setSubscription} options={SUBSCRIPTIONS} />
        </div>
      </StepCard>

      <StepCard title="Step 2. Configure Profiler">
        <div className="flex items-center gap-2 text-slate-500 mb-4">
          <GearIcon />
          <span>Configure connection first to set profiler options</span>
        </div>
        <button
          disabled={!connected}
          className="px-4 py-2 rounded-md bg-slate-200 text-slate-500 text-sm font-medium disabled:cursor-not-allowed enabled:bg-[#1f6feb] enabled:text-white enabled:hover:bg-[#1a5ed1]"
        >
          Edit
        </button>
      </StepCard>

      <StepCard title="Step 3. Profiler runs">
        <div className="flex items-center gap-4">
          <button
            disabled={!connected || running}
            onClick={() => start([])}
            className="px-4 py-2 rounded-md bg-slate-200 text-slate-500 text-sm font-medium disabled:cursor-not-allowed enabled:bg-[#1f6feb] enabled:text-white enabled:hover:bg-[#1a5ed1]"
          >
            New run
          </button>
          <button
            onClick={reset}
            className="text-sm text-[#1f6feb] hover:underline"
          >
            Reset
          </button>
        </div>
      </StepCard>

      <StepCard title="Step 4. Configure Dashboard (optional)">
        <div className="flex items-center gap-2 text-slate-500 mb-4">
          <DashboardIcon />
          <span>Configure connection first to set dashboard options</span>
        </div>
        <button
          disabled={!connected}
          className="px-4 py-2 rounded-md bg-slate-200 text-slate-500 text-sm font-medium disabled:cursor-not-allowed enabled:bg-[#1f6feb] enabled:text-white enabled:hover:bg-[#1a5ed1]"
        >
          Edit
        </button>
      </StepCard>

      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function StepCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border border-slate-200 rounded-lg p-5 mb-4">
      <h2 className="text-base font-semibold text-slate-900 mb-3">{title}</h2>
      {children}
    </section>
  )
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: string[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none px-3 py-2 pr-9 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
      >
        {options.map((opt) => (
          <option key={opt}>{opt}</option>
        ))}
      </select>
      <svg
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#6c8497"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
}
