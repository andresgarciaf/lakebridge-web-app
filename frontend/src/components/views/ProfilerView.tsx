import { useState } from 'react'
import { ResultsPanel } from '../FileUpload'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'

type Source = 'mssql' | 'synapse'
type ConfigState = 'unsaved' | 'saving' | 'saved'

const AUTH_TYPES = ['sql_authentication', 'ad_passwd_authentication', 'spn_authentication']

export function ProfilerView() {
  const [source, setSource] = useState<Source>('mssql')
  const [server, setServer] = useState('')
  const [port, setPort] = useState('1433')
  const [database, setDatabase] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [devEndpoint, setDevEndpoint] = useState('')
  const [authType, setAuthType] = useState(AUTH_TYPES[0])
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [configState, setConfigState] = useState<ConfigState>('unsaved')
  const [configError, setConfigError] = useState<string | null>(null)
  const testRun = useRun('profiler-test')
  const profileRun = useRun('profiler-run')

  const touch = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v)
    setConfigState('unsaved')
  }

  const formReady =
    user.trim() &&
    password &&
    (source === 'mssql'
      ? server.trim() && port.trim() && database.trim()
      : workspaceName.trim() && devEndpoint.trim())
  const busy = configState === 'saving' || testRun.running || profileRun.running

  const saveConfig = async (): Promise<boolean> => {
    setConfigError(null)
    setConfigState('saving')
    try {
      const payload =
        source === 'mssql'
          ? {
              source,
              server: server.trim(),
              port: port.trim(),
              database: database.trim(),
              user: user.trim(),
              password,
            }
          : {
              source,
              workspace_name: workspaceName.trim(),
              development_endpoint: devEndpoint.trim(),
              auth_type: authType,
              user: user.trim(),
              password,
            }
      const resp = await fetch('/api/profiler/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
    if (await saveConfig()) testRun.start(['--source-tech', source])
  }

  const handleRun = async () => {
    if (!formReady || busy) return
    if (configState === 'saved' || (await saveConfig())) {
      profileRun.start(['--source-tech', source])
    }
  }

  const lines = profileRun.lines.length ? profileRun.lines : testRun.lines
  const running = profileRun.running || testRun.running
  const exitCode =
    profileRun.running || profileRun.lines.length ? profileRun.exitCode : testRun.exitCode

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Database Profiler</h1>

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">Source system</label>
        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
          <SourceTab
            active={source === 'mssql'}
            onClick={() => touch(setSource)('mssql')}
            label="SQL Server"
          />
          <SourceTab
            active={source === 'synapse'}
            onClick={() => touch(setSource)('synapse')}
            label="Azure Synapse"
          />
        </div>
      </div>

      <section className="border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Source connection</h2>
        <p className="text-sm text-slate-500 mb-4">
          Credentials are stored only inside the app container and used by the profiler to
          connect to your source system.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {source === 'mssql' ? (
            <>
              <Field
                label="Server (fully-qualified)"
                value={server}
                onChange={touch(setServer)}
                placeholder="myserver.database.windows.net"
              />
              <Field label="Port" value={port} onChange={touch(setPort)} placeholder="1433" />
              <Field
                label="Database"
                value={database}
                onChange={touch(setDatabase)}
                placeholder="my_database"
              />
            </>
          ) : (
            <>
              <Field
                label="Synapse workspace name"
                value={workspaceName}
                onChange={touch(setWorkspaceName)}
                placeholder="my-synapse-workspace"
              />
              <Field
                label="Development endpoint"
                value={devEndpoint}
                onChange={touch(setDevEndpoint)}
                placeholder="https://my-synapse-workspace.dev.azuresynapse.net"
              />
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  JDBC authentication
                </label>
                <select
                  value={authType}
                  onChange={(e) => touch(setAuthType)(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
                >
                  {AUTH_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
            </>
          )}
          <Field label="SQL username" value={user} onChange={touch(setUser)} placeholder="sqladmin" />
          <Field label="SQL password" value={password} onChange={touch(setPassword)} type="password" />
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
            /Shared/lakebridge-app/profiler/{source}
          </code>
          when the run finishes.
        </p>
      </section>

      <ResultsPanel results={profileRun.results} />
      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function SourceTab({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={
        'px-4 py-2 text-sm font-medium transition ' +
        (active ? 'bg-[#1f6feb] text-white' : 'bg-white text-slate-700 hover:bg-slate-50')
      }
    >
      {label}
    </button>
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
