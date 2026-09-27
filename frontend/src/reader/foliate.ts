/**
 * Loads foliate-js (vendored in public/foliate) and types the parts we use.
 *
 * foliate-js is plain ES modules that register custom elements, so it is
 * loaded at runtime from its public URL rather than bundled.
 */

export interface TocItem {
  label: string
  href: string
  subitems?: TocItem[]
}

export interface FoliateSection {
  id: string
  linear?: string
}

export interface FoliateBook {
  metadata?: { title?: string | Record<string, string>; language?: string }
  toc?: TocItem[]
  sections: FoliateSection[]
  dir?: string
}

export interface RelocateDetail {
  fraction: number
  section: { current: number; total: number }
  location?: { current: number; next: number; total: number }
  tocItem?: { label?: string; href?: string } | null
  cfi: string
  range: Range
}

export type Anchor = (doc: Document) => Range | Element | null

export interface FoliateRenderer extends HTMLElement {
  goTo(target: { index: number; anchor?: Anchor }): Promise<void>
  setStyles?(css: string): void
  getContents(): { index: number; doc: Document }[]
  next(): Promise<void>
  prev(): Promise<void>
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  lastLocation: RelocateDetail | null
  open(file: File | Blob | string): Promise<void>
  close(): void
  init(opts: {
    lastLocation?: string | { fraction: number }
    showTextStart?: boolean
  }): Promise<void>
  goTo(target: string | number): Promise<unknown>
  goToFraction(fraction: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
}

let loading: Promise<unknown> | null = null

/**
 * Load foliate-js once; it defines the <foliate-view> element.
 *
 * Added as a module <script> rather than import(): Vite serves public/ files
 * as-is and only lets HTML reference them.
 */
export function loadFoliate(): Promise<unknown> {
  if (customElements.get('foliate-view')) return Promise.resolve()
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.type = 'module'
      script.src = `${import.meta.env.BASE_URL}foliate/view.js`
      script.onerror = () => {
        script.remove()
        loading = null
        reject(new Error('Could not load the reader.'))
      }
      document.head.append(script)
      customElements.whenDefined('foliate-view').then(resolve)
    })
  }
  return loading
}

export function createFoliateView(): FoliateView {
  return document.createElement('foliate-view') as FoliateView
}
