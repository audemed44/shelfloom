import { Scroll } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { WebSerial } from '../../types/api'

const STATUS_STYLES: Record<string, string> = {
  ongoing: 'bg-green-500/20 text-green-400',
  completed: 'bg-primary/20 text-primary',
  paused: 'bg-amber-500/20 text-amber-400',
  error: 'bg-red-500/20 text-red-400',
}

interface SerialCardProps {
  serial: WebSerial
}

export default function SerialCard({ serial }: SerialCardProps) {
  const statusClass =
    STATUS_STYLES[serial.status] ?? 'bg-white/10 text-white/50'

  return (
    <Link
      to={`/serials/${serial.id}`}
      className="group block"
      data-testid={`serial-card-${serial.id}`}
    >
      {/* Cover */}
      <div className="aspect-[2/3] bg-white/5 border border-white/10 group-hover:border-primary transition-colors overflow-hidden relative">
        <img
          src={`/api/serials/${serial.id}/cover`}
          alt={serial.title ?? 'Serial cover'}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
          }}
        />

        {/* Fallback placeholder icon (visible when cover fails to load) */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Scroll size={32} className="text-white/10" />
        </div>

        {/* Status badge */}
        <div className="absolute top-2 right-2">
          <span
            className={`text-[9px] font-black tracking-widest px-1.5 py-0.5 ${statusClass}`}
          >
            {serial.status}
          </span>
        </div>

        {/* Chapter count */}
        <div className="absolute bottom-0 left-0 right-0 px-2 py-1.5 bg-gradient-to-t from-black/80 to-transparent">
          <span className="text-[9px] font-black tracking-widest text-white/60">
            {serial.total_chapters} ch
          </span>
        </div>
      </div>

      {/* Meta */}
      <div className="mt-2 px-0.5">
        <p className="text-sm font-black tracking-tighter leading-tight line-clamp-2">
          {serial.title ?? 'Untitled'}
        </p>
        {serial.author && (
          <p className="text-xs text-white/40 mt-0.5 normal-case truncate">
            {serial.author}
          </p>
        )}
      </div>
    </Link>
  )
}
