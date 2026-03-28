import type { MemoryRouterProps } from 'react-router-dom'
import { MemoryRouter } from 'react-router-dom'

export const routerFuture = {
  v7_startTransition: true,
  v7_relativeSplatPath: true,
} as const

type TestMemoryRouterProps = Omit<MemoryRouterProps, 'future'>

export function TestMemoryRouter(props: TestMemoryRouterProps) {
  return <MemoryRouter {...props} future={routerFuture} />
}
