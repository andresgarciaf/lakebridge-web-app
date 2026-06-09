import type { UcStatus } from '../types'

export function UcStatusPanel({
  status,
  checking,
  onRecheck,
}: {
  status: UcStatus | null
  checking: boolean
  onRecheck: () => void
}) {
  if (status === null) {
    return (
      <p className="text-sm text-slate-500 mb-4">Checking Unity Catalog access…</p>
    )
  }

  if (status.ok) {
    return (
      <p className="flex items-center gap-2 text-sm text-emerald-700 mb-4">
        <Dot ok />
        Unity Catalog access verified for the app service principal.
      </p>
    )
  }

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 mb-4">
      <p className="flex items-center gap-2 text-sm font-medium text-amber-900 mb-2">
        <Dot ok={false} />
        Missing Unity Catalog access — Switch runs will fail until an admin grants it.
      </p>
      <ul className="mb-3 space-y-1">
        {status.items.map((item) => (
          <li key={item.name} className="flex items-center gap-2 text-xs text-amber-900">
            <Dot ok={item.ok} />
            {item.type}{' '}
            <code className="bg-white/70 px-1 py-0.5 rounded">{item.name}</code>
            <span className="text-amber-700">
              {!item.exists
                ? 'missing'
                : item.missing_privileges.length
                  ? `needs: ${item.missing_privileges.join(', ')}`
                  : 'ok'}
            </span>
          </li>
        ))}
      </ul>
      {status.fix_sql.length > 0 && (
        <pre className="bg-slate-900 text-slate-100 text-xs rounded-md p-3 overflow-x-auto mb-3">
          {status.fix_sql.join('\n')}
        </pre>
      )}
      <button
        onClick={onRecheck}
        disabled={checking}
        className="px-4 py-1.5 rounded-md bg-[#1f6feb] text-white text-xs font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300"
      >
        {checking ? 'Checking…' : 'Check again'}
      </button>
    </div>
  )
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={
        'inline-block w-2 h-2 rounded-full shrink-0 ' + (ok ? 'bg-emerald-500' : 'bg-amber-500')
      }
    />
  )
}
