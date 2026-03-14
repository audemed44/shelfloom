export function SkeletonCard() {
  return (
    <div data-testid="skeleton-card">
      <div className="aspect-[2/3] bg-white/5 border border-white/10 animate-pulse" />
      <div className="mt-2 space-y-1.5 px-0.5">
        <div className="h-3 bg-white/10 animate-pulse w-4/5" />
        <div className="h-2.5 bg-white/5 animate-pulse w-1/2" />
      </div>
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div
      className="flex items-center gap-4 p-4 bg-white/5 border border-white/10 animate-pulse"
      data-testid="skeleton-row"
    >
      <div className="w-10 h-14 bg-white/10 shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3 bg-white/10 w-3/5" />
        <div className="h-2.5 bg-white/5 w-2/5" />
      </div>
    </div>
  )
}
