interface LogoProps {
  size?: number
}

/** Brand mark: book spines on a shelf, as in the app icon (public/icon.svg). */
export default function Logo({ size = 32 }: LogoProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      className="shrink-0"
      aria-hidden="true"
    >
      <rect width="32" height="32" fill="#000" />
      <path
        d="M5 6h5v19H5zm6.5 3h5v16h-5zm6.6.3 4.9-1.2 4.4 17.6-4.9 1.2z"
        fill="#2563ff"
      />
      <path d="M3.5 25h25v2.5h-25z" fill="#fff" />
    </svg>
  )
}
