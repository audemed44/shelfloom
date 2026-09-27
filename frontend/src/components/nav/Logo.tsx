interface LogoProps {
  size?: number
}

/** Stacked-books brand mark with the app's gradient. */
export default function Logo({ size = 36 }: LogoProps) {
  return (
    <div
      className="relative grid shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary-400 via-primary-600 to-accent-rose shadow-glow"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 24 24"
        width={size * 0.56}
        height={size * 0.56}
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 4h3v16H5z" />
        <path d="M10 4h3v16h-3z" />
        <path d="m15.5 5.2 2.9-.8 3.1 15-2.9.8z" />
      </svg>
    </div>
  )
}
