import type { UcStatus } from '../types'

export function UcSetupScreen({
  status,
  checking,
  onRecheck,
  onContinue,
}: {
  status: UcStatus
  checking: boolean
  onRecheck: () => void
  onContinue: () => void
}) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-6">
      <div className="max-w-3xl w-full">
        <h1 className="text-2xl font-semibold text-slate-900 mb-2">
          Unity Catalog prerequisites
        </h1>
        <p className="text-sm text-slate-600 mb-6">
          The app could not create or access some Unity Catalog objects it needs. Ask a
          workspace admin to run the SQL below (it creates missing objects and grants access to
          the app service principal <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{status.principal}</code>),
          then check again.
        </p>

        <ul className="mb-6 space-y-2">
          {status.items.map((item) => (
            <li key={item.name} className="flex items-center gap-3 text-sm">
              <span
                className={
                  'inline-flex w-5 h-5 items-center justify-center rounded-full text-white text-xs ' +
                  (item.ok ? 'bg-emerald-500' : 'bg-red-500')
                }
              >
                {item.ok ? '✓' : '✗'}
              </span>
              <span className="text-slate-800">
                {item.type} <code className="text-xs bg-slate-100 px-1 py-0.5 rounded">{item.name}</code>
              </span>
              <span className="text-slate-500">
                {!item.exists
                  ? 'missing'
                  : item.missing_privileges.length
                    ? `missing: ${item.missing_privileges.join(', ')}`
                    : item.created
                      ? 'created'
                      : 'ok'}
              </span>
            </li>
          ))}
        </ul>

        {status.fix_sql.length > 0 && (
          <pre className="bg-slate-900 text-slate-100 text-xs rounded-lg p-4 overflow-x-auto mb-6">
            {status.fix_sql.join('\n')}
          </pre>
        )}

        <div className="flex items-center gap-4">
          <button
            onClick={onRecheck}
            disabled={checking}
            className="px-5 py-2.5 rounded-md bg-[#1f6feb] text-white text-sm font-medium hover:bg-[#1a5ed1] disabled:bg-slate-300"
          >
            {checking ? 'Checking…' : 'Check again'}
          </button>
          <button onClick={onContinue} className="text-sm text-[#1f6feb] hover:underline">
            Continue anyway (Analyzer and standard conversion still work)
          </button>
        </div>
      </div>
    </div>
  )
}
