import { useEffect, useState } from 'react'

interface CoverFallbackProps {
  title: string
  author?: string | null
  large?: boolean
}

/** Typographic stand-in for a missing cover: fills its positioned parent. */
export default function CoverFallback({
  title,
  author,
  large,
}: CoverFallbackProps) {
  return (
    <div
      aria-hidden
      className={`absolute inset-0 flex flex-col justify-center gap-2 border-t-4 border-primary bg-white/[0.04] ${large ? 'p-5 sm:p-6' : 'p-2.5 sm:p-3'}`}
      data-testid="cover-fallback"
    >
      <p
        className={`font-extrabold leading-[1.05] tracking-tight text-white/80 break-words ${large ? 'text-2xl line-clamp-6 sm:text-3xl' : 'text-xs line-clamp-5 sm:text-sm'}`}
      >
        {title}
      </p>
      {author && (
        <p
          className={`truncate font-semibold tracking-widest text-white/40 ${large ? 'text-xs' : 'text-[9px]'}`}
        >
          {author}
        </p>
      )}
    </div>
  )
}

type ImgProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onError'>

interface CoverImageProps extends ImgProps {
  src: string
  title: string
  author?: string | null
  large?: boolean
}

/** A book cover image that falls back to the title and author when it can't load. */
export function CoverImage({
  src,
  title,
  author,
  large,
  ...img
}: CoverImageProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  if (failed)
    return <CoverFallback title={title} author={author} large={large} />
  return <img src={src} {...img} onError={() => setFailed(true)} />
}
