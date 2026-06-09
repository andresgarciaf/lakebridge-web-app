import { useState } from 'react'
import { FileUpload, ResultsPanel } from '../FileUpload'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'
import { uploadFiles } from '../../runCommand'

const SOURCE_DIALECTS = [
  'Select',
  'snowflake',
  'oracle',
  'teradata',
  'redshift',
  'tsql',
  'synapse',
  'netezza',
  'vertica',
  'bigquery',
  'mysql',
  'postgresql',
]

export function ConverterView() {
  const [sourceDialect, setSourceDialect] = useState(SOURCE_DIALECTS[0])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [debug, setDebug] = useState(false)
  const { lines, running, exitCode, results, start, reset } = useRun('converter')

  const ready = sourceDialect !== 'Select' && files.length > 0
  const busy = running || uploading

  const handleStart = async () => {
    if (!ready || busy) return
    setUploadError(null)
    setUploading(true)
    try {
      const job = await uploadFiles(files)
      const args = [
        '--source-dialect',
        sourceDialect,
        '--input-source',
        job.input_dir,
        '--output-folder',
        job.output_dir,
        '--skip-validation',
        'true',
      ]
      if (debug) args.push('--debug')
      start(args, job.job_id)
    } catch (err) {
      setUploadError((err as Error).message)
    } finally {
      setUploading(false)
    }
  }

  const handleReset = () => {
    setSourceDialect(SOURCE_DIALECTS[0])
    setFiles([])
    setUploadError(null)
    setDebug(false)
    reset()
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Select code to convert</h1>

      <div className="mb-6">
        <Field label="Source Dialect">
          <Dropdown value={sourceDialect} options={SOURCE_DIALECTS} onChange={setSourceDialect} />
        </Field>
      </div>

      <div className="mb-4">
        <FileUpload files={files} onChange={setFiles} disabled={busy} />
        <p className="mt-2 text-sm text-slate-500">
          Converted Databricks code is written to the workspace under
          <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">
            /Shared/lakebridge-app/results
          </code>
          when the run finishes.
        </p>
      </div>

      <Checkbox checked={debug} onChange={setDebug} label="Show debug output" />

      {uploadError && <p className="mt-3 text-sm text-red-600">{uploadError}</p>}

      <div className="flex justify-end items-center gap-4 mt-6">
        <button onClick={handleReset} className="text-sm text-[#1f6feb] hover:underline px-2 py-1">
          Reset
        </button>
        <button
          onClick={handleStart}
          disabled={!ready || busy}
          className="px-5 py-2.5 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {uploading ? 'Uploading…' : running ? 'Converting…' : 'Start Converting'}
        </button>
      </div>

      <ResultsPanel results={results} />
      <OutputPanel lines={lines} running={running} exitCode={exitCode} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      {children}
    </div>
  )
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
    <div className="relative inline-block min-w-[220px]">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full appearance-none px-3 py-2.5 pr-9 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
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
