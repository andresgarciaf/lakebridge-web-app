import { useEffect, useRef, useState } from 'react'

export function Combobox({
  value,
  options,
  onChange,
  disabled,
  placeholder,
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()))

  const pick = (option: string) => {
    onChange(option)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        disabled={disabled}
        value={open ? query : value}
        placeholder={open ? value || placeholder : placeholder}
        onFocus={() => {
          setOpen(true)
          setQuery('')
        }}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!open) setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && filtered.length) {
            e.preventDefault()
            pick(filtered[0])
          }
        }}
        className="w-full px-3 py-2.5 pr-9 rounded-md border border-slate-300 bg-white text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#1f6feb] disabled:bg-slate-50 disabled:text-slate-400"
      />
      <svg
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
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
      {open && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto rounded-md border border-slate-200 bg-white shadow-lg py-1">
          {filtered.length ? (
            filtered.map((option) => (
              <li key={option}>
                <button
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    pick(option)
                  }}
                  className={
                    'w-full text-left px-3 py-2 text-sm transition-colors ' +
                    (option === value
                      ? 'bg-[#e0ecff] text-[#1f6feb] font-medium'
                      : 'text-slate-700 hover:bg-slate-100')
                  }
                >
                  {option}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-slate-400">No matches</li>
          )}
        </ul>
      )}
    </div>
  )
}
