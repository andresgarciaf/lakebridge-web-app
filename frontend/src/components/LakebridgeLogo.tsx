type Variant = 'lockup' | 'container'

const SRC: Record<Variant, string> = {
  lockup: '/lakebridge-lockup.png',
  container: '/lakebridge-container.png',
}

export function LakebridgeLogo({
  height = 36,
  variant = 'lockup',
}: {
  height?: number
  variant?: Variant
}) {
  return (
    <img
      src={SRC[variant]}
      alt="Lakebridge"
      style={{ height }}
      className="w-auto select-none"
      draggable={false}
    />
  )
}
