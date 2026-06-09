import { useState } from 'react'
import { ResultsPanel } from '../FileUpload'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'

type ConfigState = 'unsaved' | 'saving' | 'saved'

export function ProfilerView() {
  const [server, setServer] = useState('')
  const [port, setPort] = useState('1433')
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [configState, setConfigState] = useState<ConfigState>('unsaved')
  const [configError, setConfigError] = useState<string | null>(null)
  const testRun = useRun('profiler-test')
  const profileRun = useRun('profiler-run')

  const formReady = server.trim() && port.trim() && user.trim() && password
  const busy = configState === 'saving' || testRun.running || profileRun.running

  const saveConfig = async (): Promise<boolean> => {
    setConfigError(null)
    setConfigState('saving')
    try {
      const resp = await fetch('/api/profiler/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'mssql',
          server: server.trim(),
          port: port.trim(),
          user: user.trim(),
          password,
        }),
      })
      if (!resp.ok) {
        const data = await resp.json().catch(() => null)
        throw new Error(data?.error ?? `HTTP ${resp.status}`)
      }
      setConfigState('saved')
      return true
    } catch (err) {
      setConfigError((err as Error).message)
      setConfigState('unsaved')
      return false
    }
  }

  const handleTest = async () => {
    if (!formReady || busy) return
    if (await saveConfig()) testRun.start(['--source-tech', 'mssql'])
  }

  const handleRun = async () => {
    if (!formReady || busy) return
    if (configState === 'saved' || (await saveConfig())) {
      profileRun.start(['--source-tech', 'mssql'])
    }
  }

  const lines = profileRun.lines.length ? profileRun.lines : testRun.lines
  const running = profileRun.running || testRun.running
  const exitCode = profileRun.running || profileRun.lines.length ? profileRun.exitCode : testRun.exitCode

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">SQL Server Profiler</h1>

      <section className="border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Source connection</h2>
        <p className="text-sm text-slate-500 mb-4">
          Credentials are stored only inside the app container and used by the profiler to
          connect to your SQL Server.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Server (fully-qualified)" value={server} onChange={setServer} placeholder="myserver.database.windows.net" />
          <Field label="Port" value={port} onChange={setPort} placeholder="1433" />
          <Field label="Username" value={user} onChange={setUser} placeholder="sqladmin" />
          <Field label="Password" value={password} onChange={setPassword} type="password" />
        </div>
        {configError && <p className="mt-3 text-sm text-red-600">{configError}</p>}
        <div className="flex items-center gap-4 mt-5">
          <button
            onClick={handleTest}
            disabled={!formReady || busy}
            className="px-4 py-2 rounded-md border border-[#1f6feb] text-[#1f6feb] text-sm font-medium hover:bg-[#e0ecff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testRun.running ? 'Testing…' : 'Save & Test Connection'}
          </button>
          <button
            onClick={handleRun}
            disabled={!formReady || busy}
            className="px-5 py-2 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {profileRun.running ? 'Profiling…' : 'Run Profiler'}
          </button>
          <button
            onClick={() => {
              testRun.reset()
              profileRun.reset()
            }}
            className="text-sm text-[#1f6feb] hover:underline"
          >
            Reset output
          </button>
        </div>
        <p className="mt-3 text-sm text-slate-500">
          The profiler extract (DuckDB) is saved to the workspace under
          <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">
            /Shared/lakebridge-app/results
          </code>
          when the run finishes.
        </p>
      </section>

      <ResultsPanel results={profileRun.results} />
      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-md border border-slate-300 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
      />
    </div>
  )
}
