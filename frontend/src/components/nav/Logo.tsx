interface LogoProps {
  size?: number
}

/** Brand mark: a blue square with three book spines. */
export default function Logo({ size = 32 }: LogoProps) {
  return (
    <div
      className="grid shrink-0 place-items-center bg-primary"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.6}
        height={size * 0.6}
        fill="white"
      >
        <rect x="4" y="4" width="4" height="16" />
        <rect x="10" y="4" width="4" height="16" />
        <path d="m15.6 5.1 3.3-.9 3.1 15.3-3.3.9z" />
      </svg>
    </div>
  )
}
