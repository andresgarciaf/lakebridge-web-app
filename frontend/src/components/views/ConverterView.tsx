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

const RESULTS_BASE = '/Shared/lakebridge-app'

type Engine = 'standard' | 'llm'

const ENGINE_DIRS: Record<Engine, string> = {
  standard: `${RESULTS_BASE}/morpheus-bb`,
  llm: `${RESULTS_BASE}/switch`,
}

export function ConverterView() {
  const [engine, setEngine] = useState<Engine>('standard')
  const [sourceDialect, setSourceDialect] = useState(SOURCE_DIALECTS[0])
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [debug, setDebug] = useState(false)
  const [catalog, setCatalog] = useState('lakebridge')
  const [schema, setSchema] = useState('switch')
  const [volume, setVolume] = useState('switch_volume')
  const [model, setModel] = useState('databricks-claude-sonnet-4-5')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const { lines, running, exitCode, results, start, reset } = useRun(
    engine === 'llm' ? 'llm-converter' : 'converter',
  )

  const llmReady =
    engine !== 'llm' ||
    (termsAccepted && catalog.trim() && schema.trim() && volume.trim() && model.trim())
  const ready = sourceDialect !== 'Select' && files.length > 0 && llmReady
  const busy = running || uploading

  const handleStart = async () => {
    if (!ready || busy) return
    setUploadError(null)
    setUploading(true)
    try {
      const job = await uploadFiles(files)
      const args =
        engine === 'llm'
          ? [
              '--accept-terms',
              'true',
              '--source-dialect',
              sourceDialect,
              '--input-source',
              job.input_dir,
              '--output-ws-folder',
              `/Workspace${ENGINE_DIRS.llm}/${job.job_id}`,
              '--catalog-name',
              catalog.trim(),
              '--schema-name',
              schema.trim(),
              '--volume',
              volume.trim(),
              '--foundation-model',
              model.trim(),
            ]
          : [
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
    setTermsAccepted(false)
    reset()
  }

  return (
    <div className="max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900 mb-6">Select code to convert</h1>

      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-700 mb-2">Conversion engine</label>
        <div className="inline-flex rounded-md border border-slate-300 overflow-hidden">
          <EngineTab
            active={engine === 'standard'}
            onClick={() => setEngine('standard')}
            label="Standard (Morpheus / BladeBridge)"
          />
          <EngineTab
            active={engine === 'llm'}
            onClick={() => setEngine('llm')}
            label="LLM (Switch)"
          />
        </div>
      </div>

      <div className="mb-6">
        <Field label="Source Dialect">
          <Dropdown value={sourceDialect} options={SOURCE_DIALECTS} onChange={setSourceDialect} />
        </Field>
      </div>

      {engine === 'llm' && (
        <section className="border border-slate-200 rounded-lg p-5 mb-6">
          <h2 className="text-base font-semibold text-slate-900 mb-1">Switch (LLM) settings</h2>
          <p className="text-sm text-slate-500 mb-4">
            Switch runs as a Databricks job: sources are staged in the Unity Catalog volume
            below and converted output is written directly to the workspace. Catalog, schema,
            and volume must already exist.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="Catalog" value={catalog} onChange={setCatalog} />
            <TextField label="Schema" value={schema} onChange={setSchema} />
            <TextField label="Volume" value={volume} onChange={setVolume} />
            <TextField label="Foundation model endpoint" value={model} onChange={setModel} />
          </div>
          <label className="flex items-start gap-3 mt-4 text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-300 text-[#1f6feb] focus:ring-[#1f6feb]"
            />
            <span>
              I accept the LLM transpilation terms: content is processed by a foundation model
              and outputs are generated without human review — validate before production use.
            </span>
          </label>
        </section>
      )}

      <div className="mb-4">
        <FileUpload files={files} onChange={setFiles} disabled={busy} />
        <p className="mt-2 text-sm text-slate-500">
          Converted Databricks code is written to the workspace under
          <code className="mx-1 text-xs bg-slate-100 px-1 py-0.5 rounded">
            {ENGINE_DIRS[engine]}
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

function EngineTab({
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      {children}
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-md border border-slate-300 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
      />
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
