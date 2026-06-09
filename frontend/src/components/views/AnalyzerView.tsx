import { useState } from 'react'
import { FolderIcon } from '../Icons'
import { OutputPanel } from '../OutputPanel'
import { useRun } from '../useRun'

const DIALECTS = [
  'Select',
  'informatica/cloud',
  'informatica/oracle-to-redshift',
  'informatica/pc',
  'oozie',
  'pyspark',
  'sql',
  'tsql',
]

export function AnalyzerView() {
  const [dialect, setDialect] = useState(DIALECTS[0])
  const [inputPath, setInputPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [openWhenDone, setOpenWhenDone] = useState(false)
  const [debug, setDebug] = useState(false)
  const { lines, running, exitCode, start, reset } = useRun('analyzer')

  const ready = dialect !== 'Select' && inputPath.trim() && outputPath.trim()

  const handleStart = () => {
    if (!ready) return
    const args: string[] = [
      '--source-tech',
      dialect,
      '--source-directory',
      inputPath.trim(),
      '--report-file',
      outputPath.trim(),
    ]
    if (debug) args.push('--debug')
    start(args)
  }

  const handleReset = () => {
    setDialect(DIALECTS[0])
    setInputPath('')
    setOutputPath('')
    setOpenWhenDone(false)
    setDebug(false)
    reset()
  }

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Select code to analyze</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-600">Previous runs</span>
          <Dropdown value="Select" options={['Select']} onChange={() => {}} />
        </div>
      </div>

      <div className="mb-6">
        <Label>Dialect</Label>
        <Dropdown value={dialect} options={DIALECTS} onChange={setDialect} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-4">
        <PathField label="Input location" value={inputPath} onChange={setInputPath} />
        <PathField label="Output location" value={outputPath} onChange={setOutputPath} />
      </div>

      <Checkbox
        checked={openWhenDone}
        onChange={setOpenWhenDone}
        label="Open directory when analyzer is finished"
      />
      <Checkbox checked={debug} onChange={setDebug} label="Show debug output" />

      <div className="flex justify-end items-center gap-4 mt-6">
        <button
          onClick={handleReset}
          className="text-sm text-[#1f6feb] hover:underline px-2 py-1"
        >
          Reset
        </button>
        <button
          onClick={handleStart}
          disabled={!ready || running}
          className="px-5 py-2.5 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300 disabled:cursor-not-allowed"
        >
          {running ? 'Analyzing…' : 'Start Analyzing'}
        </button>
      </div>

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

function PathField({
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
      <Label>{label}</Label>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Enter path or browse..."
          className="w-full pl-3 pr-10 py-2.5 rounded-md border border-slate-300 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb]"
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
          <FolderIcon />
        </span>
      </div>
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
