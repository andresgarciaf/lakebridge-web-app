export type View = 'home' | 'profiler' | 'analyzer' | 'converter' | 'reconcile'

export type UcItem = {
  type: string
  name: string
  exists: boolean
  created: boolean
  missing_privileges: string[]
  ok: boolean
}

export type UcStatus = {
  ok: boolean
  principal: string
  items: UcItem[]
  fix_sql: string[]
}

export type EnvInfo = {
  python: string
  java: string
  databricks: string
  lakebridge: string
  host: string
  user_initials: string
}
