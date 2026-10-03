import { useApi } from '../../hooks/useApi'

/** Foyer, the homelab's start page (HOMEPAGE_URL), when it's set. */
export function useFoyerUrl(): string | null {
  const { data } = useApi<{ foyer_url: string | null }>('/api/app')
  return data?.foyer_url ?? null
}
