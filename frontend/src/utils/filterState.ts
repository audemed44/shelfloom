import type { FilterState, LensFilterState } from '../types/api'

export const DEFAULT_FILTER_STATE: FilterState = {
  genres: [],
  tags: [],
  seriesIds: [],
  authors: [],
  formats: [],
  hasGenre: null,
  hasTag: null,
  hasAuthor: null,
  hasSeries: null,
  minRating: null,
  hasRating: null,
  hasReview: null,
  mode: 'and',
}

export const DEFAULT_LENS_FILTER_STATE: LensFilterState = {
  genres: [],
  tags: [],
  series_ids: [],
  authors: [],
  formats: [],
  has_genre: null,
  has_tag: null,
  has_author: null,
  has_series: null,
  min_rating: null,
  has_rating: null,
  has_review: null,
  mode: 'and',
  shelf_id: null,
  status: null,
}

export function normalizeFilterState(
  value: Partial<FilterState> | null | undefined
): FilterState {
  const next = {
    ...DEFAULT_FILTER_STATE,
    ...value,
  }
  return {
    ...next,
    genres: [...next.genres],
    tags: [...next.tags],
    seriesIds: [...next.seriesIds],
    authors: [...next.authors],
    formats: [...next.formats],
  }
}

export function normalizeLensFilterState(
  value: Partial<LensFilterState> | null | undefined
): LensFilterState {
  const next = {
    ...DEFAULT_LENS_FILTER_STATE,
    ...value,
  }
  return {
    ...next,
    genres: [...next.genres],
    tags: [...next.tags],
    series_ids: [...next.series_ids],
    authors: [...next.authors],
    formats: [...next.formats],
  }
}
