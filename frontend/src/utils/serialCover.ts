import type { WebSerial } from '../types/api'

type SerialCoverFields = Pick<WebSerial, 'id' | 'cover_path' | 'cover_url'>

export interface SerialCoverSources {
  primarySrc?: string
  fallbackSrc?: string
}

function buildLocalCoverUrl(
  serialId: number,
  coverPath: string,
  cacheKey?: number
) {
  const params = new URLSearchParams({ cover: coverPath })
  if (cacheKey !== undefined) {
    params.set('v', String(cacheKey))
  }
  return `/api/serials/${serialId}/cover?${params.toString()}`
}

export function getSerialCoverSources(
  serial: SerialCoverFields,
  cacheKey?: number
): SerialCoverSources {
  if (serial.cover_path) {
    return {
      primarySrc: buildLocalCoverUrl(serial.id, serial.cover_path, cacheKey),
      fallbackSrc: serial.cover_url ?? undefined,
    }
  }

  if (serial.cover_url) {
    return { primarySrc: serial.cover_url }
  }

  return {}
}
