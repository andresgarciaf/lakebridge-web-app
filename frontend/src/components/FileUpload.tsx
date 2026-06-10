import { useRef } from 'react'
import type { RunResults } from '../runCommand'

export function FileUpload({
  files,
  onChange,
  accept,
  disabled,
}: {
  files: File[]
  onChange: (files: File[]) => void
  accept?: string
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-2">Source code</label>
      <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={accept}
          className="hidden"
          onChange={(e) => onChange([...(e.target.files ?? [])])}
        />
        <div className="flex items-center gap-4">
          <button
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            className="px-4 py-2 rounded-md border border-slate-300 bg-white text-sm text-slate-700 hover:border-slate-400 disabled:opacity-50"
          >
            Choose files…
          </button>
          <span className="text-sm text-slate-500">
            {files.length
              ? `${files.length} file(s) selected`
              : 'Select files, or a .zip to upload whole folders (structure is preserved).'}
          </span>
        </div>
        {files.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-2">
            {files.map((f) => (
              <li
                key={f.name}
                className="px-2.5 py-1 rounded bg-white border border-slate-200 text-xs text-slate-600"
              >
                {f.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function ResultsPanel({ results }: { results: RunResults | null }) {
  if (!results) return null
  if (results.pending) {
    return (
      <div className="mt-4 rounded-md border border-sky-200 bg-sky-50 p-4">
        <p className="text-sm font-medium text-sky-900">
          Results will be saved to the workspace:{' '}
          <a
            href={results.url}
            target="_blank"
            rel="noreferrer"
            className="underline text-[#1f6feb]"
          >
            {results.workspace_dir}
          </a>{' '}
          when the Switch job completes.
        </p>
      </div>
    )
  }
  return (
    <div className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 p-4">
      <p className="text-sm font-medium text-emerald-900">
        Results saved to the workspace:{' '}
        <a
          href={results.url}
          target="_blank"
          rel="noreferrer"
          className="underline text-[#1f6feb]"
        >
          {results.workspace_dir}
        </a>
      </p>
      <ul className="mt-2 text-xs text-emerald-800 space-y-0.5">
        {results.files.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
    </div>
  )
}
