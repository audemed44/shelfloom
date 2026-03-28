import { useState } from 'react'
import { Star } from 'lucide-react'

interface StarRatingProps {
  value: number | null
  onChange?: (value: number) => void
  size?: number
  readOnly?: boolean
  className?: string
}

function fillPercent(value: number | null, starIndex: number) {
  if (value == null) return 0
  const offset = value - starIndex
  if (offset >= 1) return 100
  if (offset <= 0) return 0
  return offset * 100
}

export default function StarRating({
  value,
  onChange,
  size = 14,
  readOnly = false,
  className = '',
}: StarRatingProps) {
  const [hoverValue, setHoverValue] = useState<number | null>(null)
  const displayValue = hoverValue ?? value

  const renderStar = (starIndex: number) => {
    const percent = fillPercent(displayValue, starIndex)

    if (readOnly || !onChange) {
      return (
        <span
          key={starIndex}
          className="relative inline-flex"
          style={{ width: size, height: size }}
        >
          <span
            className="absolute inset-0 overflow-hidden"
            style={{ width: `${percent}%` }}
          >
            <Star
              size={size}
              className="fill-primary text-primary"
              strokeWidth={1.75}
            />
          </span>
          <Star size={size} className="text-white/20" strokeWidth={1.75} />
        </span>
      )
    }

    return (
      <button
        key={starIndex}
        type="button"
        className="relative inline-flex cursor-pointer"
        style={{ width: size, height: size }}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeftHalf = e.clientX - rect.left < rect.width / 2
          const nextValue = starIndex + (isLeftHalf ? 0.5 : 1)
          setHoverValue(nextValue)
        }}
        onMouseLeave={() => setHoverValue(null)}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect()
          const isLeftHalf = e.clientX - rect.left < rect.width / 2
          onChange(starIndex + (isLeftHalf ? 0.5 : 1))
        }}
        aria-label={`Rate ${starIndex + 1} stars`}
      >
        <span
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${percent}%` }}
        >
          <Star
            size={size}
            className="fill-primary text-primary"
            strokeWidth={1.75}
          />
        </span>
        <Star size={size} className="text-white/20" strokeWidth={1.75} />
      </button>
    )
  }

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className}`}
      onMouseLeave={() => setHoverValue(null)}
    >
      {Array.from({ length: 5 }).map((_, index) => renderStar(index))}
    </div>
  )
}
