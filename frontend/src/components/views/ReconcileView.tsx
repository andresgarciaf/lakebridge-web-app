import { useCallback, useEffect, useState } from 'react'
import { OutputPanel } from '../OutputPanel'
import { useStreamPost } from '../useRun'

const SOURCES = ['databricks', 'snowflake', 'oracle', 'mssql', 'synapse', 'redshift']
const REPORTS = ['data', 'schema', 'row', 'all']

type ReconStatus = {
  configured: boolean
  config: {
    report_type?: string
    source?: { dialect?: string; catalog?: string; schema?: string }
    target?: { catalog?: string; schema?: string }
  } | null
  job_id: string | null
  table_config_path: string | null
  table_config_exists: boolean
}

const TABLE_CONFIG_TEMPLATE = `{
  "source_catalog": "my_source_catalog",
  "source_schema": "my_schema",
  "target_catalog": "my_target_catalog",
  "target_schema": "my_schema",
  "tables": [
    {
      "source_name": "orders",
      "target_name": "orders",
      "join_columns": ["order_id"]
    }
  ]
}`

export function ReconcileView() {
  const [status, setStatus] = useState<ReconStatus | null>(null)
  const [dataSource, setDataSource] = useState('databricks')
  const [reportType, setReportType] = useState('all')
  const [ucConnection, setUcConnection] = useState('')
  const [sourceCatalog, setSourceCatalog] = useState('')
  const [sourceSchema, setSourceSchema] = useState('')
  const [targetCatalog, setTargetCatalog] = useState('')
  const [targetSchema, setTargetSchema] = useState('')
  const [tableJson, setTableJson] = useState('')
  const [tableError, setTableError] = useState<string | null>(null)
  const [tableSaved, setTableSaved] = useState<string | null>(null)
  const setup = useStreamPost('/api/reconcile/setup')
  const run = useStreamPost('/api/reconcile/run')

  const refreshStatus = useCallback(() => {
    fetch('/api/reconcile/status')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setStatus(d))
      .catch(() => {})
  }, [])

  useEffect(refreshStatus, [refreshStatus])

  const prevSetupRunning = setup.running
  useEffect(() => {
    if (!setup.running && setup.exitCode === 0) refreshStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevSetupRunning])

  const setupReady =
    sourceCatalog.trim() &&
    sourceSchema.trim() &&
    targetCatalog.trim() &&
    targetSchema.trim() &&
    (dataSource === 'databricks' || ucConnection.trim())
  const busy = setup.running || run.running

  const handleSetup = () => {
    if (!setupReady || busy) return
    setup.start({
      data_source: dataSource,
      report_type: reportType,
      uc_connection_name: ucConnection.trim() || undefined,
      source_catalog: sourceCatalog.trim(),
      source_schema: sourceSchema.trim(),
      target_catalog: targetCatalog.trim(),
      target_schema: targetSchema.trim(),
    })
  }

  const handleSaveTables = async () => {
    setTableError(null)
    setTableSaved(null)
    let parsed: unknown
    try {
      parsed = JSON.parse(tableJson)
    } catch {
      setTableError('Invalid JSON')
      return
    }
    const resp = await fetch('/api/reconcile/table-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: parsed }),
    })
    const data = await resp.json().catch(() => null)
    if (!resp.ok) {
      setTableError(data?.error ?? `HTTP ${resp.status}`)
      return
    }
    setTableSaved(data.path)
    refreshStatus()
  }

  const lines = run.lines.length ? run.lines : setup.lines
  const running = run.running || setup.running
  const exitCode = run.running || run.lines.length ? run.exitCode : setup.exitCode

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Data Reconciliation</h1>

      <section className="border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">1. Configure & deploy</h2>
        <p className="text-sm text-slate-500 mb-4">
          Deploys the lakebridge Reconciliation job, metadata tables
          (<code className="text-xs bg-slate-100 px-1 py-0.5 rounded">lakebridge.reconciler</code>),
          and dashboards. Non-Databricks sources connect through an existing Unity Catalog
          (Lakehouse Federation) connection.
        </p>
        {status?.configured && (
          <p className="flex items-center gap-2 text-sm text-emerald-700 mb-4">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
            Deployed — job {status.job_id}, source {status.config?.source?.dialect}{' '}
            {status.config?.source?.catalog}.{status.config?.source?.schema} → target{' '}
            {status.config?.target?.catalog}.{status.config?.target?.schema} (
            {status.config?.report_type})
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SelectField label="Data source" value={dataSource} options={SOURCES} onChange={setDataSource} />
          <SelectField label="Report type" value={reportType} options={REPORTS} onChange={setReportType} />
          {dataSource !== 'databricks' && (
            <Field
              label="UC connection name"
              value={ucConnection}
              onChange={setUcConnection}
              placeholder="my_snowflake_connection"
            />
          )}
          <Field
            label={dataSource === 'databricks' ? 'Source catalog' : 'Source database / service'}
            value={sourceCatalog}
            onChange={setSourceCatalog}
          />
          <Field label="Source schema" value={sourceSchema} onChange={setSourceSchema} />
          <Field label="Target catalog" value={targetCatalog} onChange={setTargetCatalog} />
          <Field label="Target schema" value={targetSchema} onChange={setTargetSchema} />
        </div>
        <div className="mt-5">
          <button
            onClick={handleSetup}
            disabled={!setupReady || busy}
            className="px-5 py-2 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {setup.running ? 'Deploying…' : status?.configured ? 'Redeploy' : 'Deploy reconcile'}
          </button>
        </div>
      </section>

      <section className="border border-slate-200 rounded-lg p-5 mb-6">
        <h2 className="text-base font-semibold text-slate-900 mb-1">2. Table mappings</h2>
        <p className="text-sm text-slate-500 mb-3">
          Define which tables to compare and their join columns.
          {status?.table_config_path && (
            <>
              {' '}
              Stored at{' '}
              <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">
                {status.table_config_path}
              </code>
              {status.table_config_exists ? ' (exists)' : ' (not saved yet)'}
            </>
          )}
        </p>
        <textarea
          value={tableJson}
          onChange={(e) => setTableJson(e.target.value)}
          placeholder={TABLE_CONFIG_TEMPLATE}
          rows={10}
          spellCheck={false}
          className="w-full font-mono text-xs px-3 py-2.5 rounded-md border border-slate-300 text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
        />
        {tableError && <p className="mt-2 text-sm text-red-600">{tableError}</p>}
        {tableSaved && (
          <p className="mt-2 text-sm text-emerald-700">Saved to {tableSaved}</p>
        )}
        <div className="mt-3">
          <button
            onClick={handleSaveTables}
            disabled={!tableJson.trim() || !status?.configured}
            className="px-4 py-2 rounded-md border border-[#1f6feb] text-[#1f6feb] text-sm font-medium hover:bg-[#e0ecff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Save table config
          </button>
        </div>
      </section>

      <section className="border border-slate-200 rounded-lg p-5 mb-4">
        <h2 className="text-base font-semibold text-slate-900 mb-1">3. Run</h2>
        <p className="text-sm text-slate-500 mb-4">
          Triggers the Reconciliation job and waits for it to finish. Results land in the
          <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">lakebridge.reconciler</code>
          metadata tables and the deployed dashboards.
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => run.start({ operation: 'reconcile' })}
            disabled={busy || !status?.configured || !status?.table_config_exists}
            className="px-5 py-2 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
          >
            {run.running ? 'Running…' : 'Run reconcile'}
          </button>
          <button
            onClick={() => run.start({ operation: 'aggregates-reconcile' })}
            disabled={busy || !status?.configured || !status?.table_config_exists}
            className="px-4 py-2 rounded-md border border-[#1f6feb] text-[#1f6feb] text-sm font-medium hover:bg-[#e0ecff] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Run aggregates reconcile
          </button>
        </div>
      </section>

      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-md border border-slate-300 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
      />
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-md border border-slate-300 bg-white text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
      >
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
  )
}
