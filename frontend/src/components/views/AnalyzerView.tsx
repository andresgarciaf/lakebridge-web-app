import { useState } from 'react'
import { FileUpload, ResultsPanel } from '../FileUpload'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'
import { uploadFiles } from '../../runCommand'

// Must match lakebridge's Analyzer.supported_source_technologies(); an
// unknown value makes the CLI fall back to an interactive prompt and fail.
const DIALECTS = [
  'Select',
  'ABInitio',
  'ADF',
  'Alteryx',
  'Athena',
  'BigQuery',
  'BODS',
  'Cloudera (Impala)',
  'Datastage',
  'Greenplum',
  'Hive',
  'IBM DB2',
  'Informatica - Big Data Edition',
  'Informatica - PC',
  'Informatica Cloud',
  'Jupyter Notebook',
  'MS SQL Server',
  'Netezza',
  'Oozie',
  'Oracle',
  'Oracle Data Integrator',
  'PentahoDI',
  'PIG',
  'Presto',
  'PySpark',
  'Redshift',
  'SAPHANA - CalcViews',
  'SAS',
  'Snowflake',
  'SPSS',
  'SQOOP',
  'SSIS',
  'SSRS',
  'Synapse',
  'Talend',
  'Teradata',
  'Vertica',
]

export function AnalyzerView() {
  const [dialect, setDialect] = useState(DIALECTS[0])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [generateJson, setGenerateJson] = useState(false)
  const [debug, setDebug] = useState(false)
  const { lines, running, exitCode, results, start, reset } = useRun('analyzer')

  const ready = dialect !== 'Select' && files.length > 0
  const busy = running || uploading

  const handleStart = async () => {
    if (!ready || busy) return
    setUploadError(null)
    setUploading(true)
    try {
      const job = await uploadFiles(files)
      const args = [
        '--source-tech',
        dialect,
        '--source-directory',
        job.input_dir,
        '--report-file',
        `${job.output_dir}/analysis-report.xlsx`,
      ]
      if (generateJson) args.push('--generate-json', 'true')
      if (debug) args.push('--debug')
      start(args, job.job_id)
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleReset = () => {
    setDialect(DIALECTS[0])
    setFiles([])
    setUploadError(null)
    setGenerateJson(false)
    setDebug(false)
    reset()
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Select code to analyze</h1>

      <div className="mb-6">
        <Label>Dialect</Label>
        <Dropdown value={dialect} options={DIALECTS} onChange={setDialect} />
      </div>

      <div className="mb-4">
        <FileUpload files={files} onChange={setFiles} disabled={busy} />
        <p className="mt-2 text-sm text-slate-500">
          The analysis report is written to the workspace under
          <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">
            /Shared/lakebridge-app/analyzer/
            {dialect !== 'Select'
              ? dialect.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
              : '<technology>'}
          </code>
          when the run finishes.
        </p>
      </div>

      <Checkbox
        checked={generateJson}
        onChange={setGenerateJson}
        label="Also generate a JSON report alongside the Excel report"
      />
      <Checkbox checked={debug} onChange={setDebug} label="Show debug output" />

      {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}

      <div className="flex justify-end items-center gap-4 mt-6">
        <button
          onClick={handleReset}
          className="text-sm text-[#1f6feb] hover:underline px-2 py-1"
        >
          Reset
        </button>
        <button
          onClick={handleStart}
          disabled={!ready || busy}
          className="px-5 py-2.5 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : running ? 'Analyzing…' : 'Start Analyzing'}
        </button>
      </div>

      <ResultsPanel results={results} />
      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-sm font-medium text-slate-700 mb-2">{children}</label>
}

function Dropdown({
  value,
  options,
  onChange,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
}) {
  return (
    <div className="relative inline-block min-w-[180px]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none px-3 py-2 pr-9 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
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

function Checkbox({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex items-center gap-3 py-1.5 text-sm text-slate-700 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="w-4 h-4 rounded border-slate-300 text-[#1f6feb] focus:ring-[#1f6feb]"
      />
      {label}
    </label>
  )
}
