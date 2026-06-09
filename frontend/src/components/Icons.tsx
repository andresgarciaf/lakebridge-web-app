type IconProps = { size?: number; className?: string }

const stroke = (color = 'currentColor') => color

export function HomeIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke()} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m3 11 9-8 9 8" />
      <path d="M5 10v10h14V10" />
    </svg>
  )
}

export function ProfilerNavIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke()} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="11" cy="5" rx="7" ry="3" />
      <path d="M4 5v6c0 1.4 2.4 2.6 5.6 2.93" />
      <path d="M4 11v6c0 1.4 2.4 2.6 5.6 2.93" />
      <path d="M18 5v3.5" />
      <circle cx="16.5" cy="15.5" r="3.5" />
      <path d="m19 18 3 3" />
    </svg>
  )
}

export function AnalyzerNavIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke()} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M8 17v-5" />
      <path d="M13 17V8" />
      <path d="M18 17v-3" />
      <path d="m8 8 4-4 3 3 5-5" />
    </svg>
  )
}

export function ConverterNavIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke()} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H7a3 3 0 0 0-3 3v1" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h13a3 3 0 0 0 3-3v-1" />
    </svg>
  )
}

export function FolderIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke()} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}

export function LinkIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke('#6c8497')} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
    </svg>
  )
}

export function GearIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke('#6c8497')} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.1.6.6 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function DashboardIcon({ size = 16 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke('#6c8497')} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <rect x="13" y="3" width="8" height="5" rx="1" />
      <rect x="13" y="10" width="8" height="11" rx="1" />
      <rect x="3" y="13" width="8" height="8" rx="1" />
    </svg>
  )
}

export function InfoIcon({ size = 18 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={stroke('#5c6f80')} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8h.01" />
      <path d="M11 12h1v5h1" />
    </svg>
  )
}

export function ProfilerCardIcon({ size = 36 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FF3621" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <ellipse cx="11" cy="5" rx="7.5" ry="3" />
      <path d="M3.5 5v6.5c0 1.5 2.6 2.75 6 3.1" />
      <path d="M3.5 11.5V18c0 1.5 2.6 2.75 6 3.1" />
      <path d="M18.5 5v4" />
      <circle cx="16.25" cy="15.25" r="3.75" />
      <path d="m19 18 3.5 3.5" />
      <path d="M14.75 15.25h3" />
      <path d="M16.25 13.75v3" />
    </svg>
  )
}

export function AnalyzerCardIcon({ size = 36 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FF3621" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v16a2 2 0 0 0 2 2h16" />
      <path d="M8 17v-5.5" />
      <path d="M13 17V7.5" />
      <path d="M18 17v-3.5" />
      <path d="m7.5 8.5 4.5-4 3 2.5L20.5 2.5" />
      <path d="M20.5 6.5v-4h-4" />
    </svg>
  )
}

export function ConverterCardIcon({ size = 36 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#FF3621" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2.5" y="2.5" width="9" height="9" rx="2" />
      <rect x="12.5" y="12.5" width="9" height="9" rx="2" />
      <path d="m5.5 6 1.5 1.5L5.5 9" />
      <path d="M8.5 9H10" />
      <path d="M13.5 7h3.75a3.25 3.25 0 0 1 3.25 3.25" />
      <path d="m18.5 8.25 2 -1.25-2-1.25" />
      <path d="M10.5 17H6.75a3.25 3.25 0 0 1-3.25-3.25" />
      <path d="m5.5 15.75-2 1.25 2 1.25" />
      <path d="m15.5 16.5 2 2 3-3.5" />
    </svg>
  )
}
