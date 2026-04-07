export function getBookCoverUrl(
  bookId: string | number,
  coverPath?: string | null,
  cacheKey?: number
) {
  const params = new URLSearchParams()
  if (coverPath) {
    params.set('cover', coverPath)
  }
  if (cacheKey !== undefined) {
    params.set('v', String(cacheKey))
  }

  const query = params.toString()
  return query
    ? `/api/books/${bookId}/cover?${query}`
    : `/api/books/${bookId}/cover`
}
