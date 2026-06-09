import { LakebridgeLogo } from './LakebridgeLogo'
import type { EnvInfo } from '../types'

export function Header({ env }: { env: EnvInfo | null }) {
  const host = env?.host || 'workspace.cloud.databricks.com'
  const initials = env?.user_initials || 'AG'
  return (
    <header className="h-16 px-6 flex items-center justify-between bg-[#fafafa] border-b border-slate-200">
      <div className="flex items-center w-64">
        <LakebridgeLogo height={32} />
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-600">{host}</span>
        <div className="w-9 h-9 rounded-full bg-emerald-600 text-white text-sm font-semibold flex items-center justify-center">
          {initials}
        </div>
      </div>
    </header>
  )
}
