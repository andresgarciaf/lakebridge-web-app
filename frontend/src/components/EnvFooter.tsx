import { InfoIcon } from './Icons'
import type { EnvInfo } from '../types'

export function EnvFooter({ env }: { env: EnvInfo | null }) {
  if (!env) return null
  const segments: string[] = []
  if (env.python) segments.push(`Python ${env.python}`)
  if (env.java) segments.push(`Java ${env.java}`)
  if (env.databricks) segments.push(`databricks@${env.databricks}`)
  if (env.lakebridge) segments.push(`lakebridge@${env.lakebridge}`)
  return (
    <div className="mx-6 my-4 px-4 py-3 bg-[#f4f6f8] border border-slate-200 rounded-md flex items-center gap-3 text-sm text-slate-700">
      <InfoIcon />
      <span>
        Your environment: <span className="font-medium">{segments.join(', ') || 'detecting…'}</span>
      </span>
    </div>
  )
}
