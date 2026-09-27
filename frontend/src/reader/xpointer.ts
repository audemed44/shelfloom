/**
 * Convert between positions in the web reader and KOReader's XPointers.
 *
 * KOReader (crengine) builds one DOM for an EPUB: every spine item becomes a
 * <DocFragment> under a root <body>, holding that item's <body>. A position is
 * a path through it, for example
 *
 *   /body/DocFragment[12]/body/div/p[5]/text().42
 *
 * which is spine item 12 (1-based), then the 5th <p> among its <p> siblings,
 * then character 42 of its text. See crengine's ldomXPointer::toStringV2 and
 * ldomDocument::createXPointerV2 (lvtinydom.cpp), and epubfmt.cpp, which gives
 * every spine item a DocFragment.
 *
 * The browser's DOM for an XHTML spine item matches crengine's except that
 * crengine drops a whitespace-only text node that opens a block element; the
 * text() counting below accounts for that. Checked against KOReader 2026.07
 * on real books: its XPointers resolve to the same characters here, and ours
 * are identical to the ones it writes.
 */

const ROOT =
  /^\/body(?:\[1\])?\/DocFragment\[(\d+)\](?:\/body(?:\[1\])?(?=\/|\.|$))?/

/** Block elements: crengine drops a whitespace-only text node that is their first child. */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'body',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

function localName(el: Element): string {
  return (el.localName || el.nodeName).toLowerCase()
}

/** 1-based position of ``el`` among its parent's children with the same name. */
function sameNameIndex(el: Element): number {
  const name = localName(el)
  let index = 1
  for (let s = el.previousElementSibling; s; s = s.previousElementSibling) {
    if (localName(s) === name) index++
  }
  return index
}

function hasSameNameSibling(el: Element): boolean {
  const name = localName(el)
  const parent = el.parentElement
  if (!parent) return false
  for (const child of Array.from(parent.children)) {
    if (child !== el && localName(child) === name) return true
  }
  return false
}

/** The element a position is in (text positions use their parent element). */
function elementOf(node: Node): Element | null {
  if (node.nodeType === Node.ELEMENT_NODE) return node as Element
  return node.parentElement
}

/**
 * XPointer for an element in spine item ``sectionIndex`` (0-based).
 *
 * The index is written only when there are same-named siblings, as crengine
 * does for books opened with its current DOM version (it parses both forms).
 */
export function xpointerForElement(el: Element, sectionIndex: number): string {
  const steps: string[] = []
  let node: Element | null = el
  while (node && localName(node) !== 'body') {
    const name = localName(node)
    steps.unshift(
      hasSameNameSibling(node) ? `${name}[${sameNameIndex(node)}]` : name
    )
    node = node.parentElement
  }
  const base = `/body/DocFragment[${sectionIndex + 1}]/body`
  // Outside <body> (should not happen for visible text): point at the body.
  if (!node) return base
  return steps.length ? `${base}/${steps.join('/')}` : base
}

/**
 * XPointer for a DOM position (a text node and offset, or an element).
 *
 * Text positions become ``.../text()[n].offset`` so KOReader lands on the
 * same word; an element, or whitespace crengine doesn't keep, points at the
 * element.
 */
export function xpointerForPosition(
  node: Node,
  offset: number,
  sectionIndex: number
): string {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    const parent = text.parentElement
    if (parent) {
      const texts = crengineTextNodes(parent)
      const index = texts.indexOf(text)
      if (index >= 0) {
        const step = texts.length > 1 ? `text()[${index + 1}]` : 'text()'
        const clamped = Math.max(0, Math.min(offset, text.data.length))
        const cre = toCrengineOffset(text, clamped)
        return `${xpointerForElement(parent, sectionIndex)}/${step}.${cre}`
      }
    }
  }
  const el = elementOf(node)
  if (!el) return `/body/DocFragment[${sectionIndex + 1}]/body`
  return xpointerForElement(el, sectionIndex)
}

/** XPointer for the start of a range, e.g. the first visible text on the page. */
export function xpointerFromRange(range: Range, sectionIndex: number): string {
  let node: Node = range.startContainer
  let offset = range.startOffset
  // A range starting at an element boundary points at one of its children.
  if (node.nodeType === Node.ELEMENT_NODE) {
    if (offset >= node.childNodes.length) {
      return xpointerForPosition(node, 0, sectionIndex)
    }
    node = node.childNodes[offset]
    offset = 0
  }
  // Whitespace between blocks: use the block that follows it.
  if (
    node.nodeType === Node.TEXT_NODE &&
    isWhitespace((node as Text).data) &&
    node.nextSibling?.nodeType === Node.ELEMENT_NODE
  ) {
    node = node.nextSibling
    offset = 0
  }
  // An element start (or an empty element such as <a id="…"/>): use the
  // first text from there on, as KOReader's page-top XPointers do.
  if (node.nodeType === Node.ELEMENT_NODE) {
    const next = textFrom(node)
    if (next) return xpointerForPosition(next, 0, sectionIndex)
  }
  return xpointerForPosition(node, offset, sectionIndex)
}

/** First non-whitespace text node at or after ``node`` in document order. */
function textFrom(node: Node): Text | null {
  const doc = node.ownerDocument
  const root = doc?.body ?? doc?.documentElement
  if (!doc || !root) return null
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  walker.currentNode = node
  // Text inside ``node`` comes first, then whatever follows it.
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!isWhitespace((n as Text).data)) return n as Text
  }
  return null
}

/** Spine index (0-based) an XPointer points into, or null if it isn't one. */
export function sectionIndexOf(xpointer: string): number | null {
  const m = ROOT.exec(xpointer)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 ? n - 1 : null
}

function isWhitespace(text: string): boolean {
  return /^[ \t\r\n]*$/.test(text)
}

const XML_SPACE = new Set([' ', '\t', '\r', '\n'])

function inPre(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    if (localName(el) === 'pre') return true
  }
  return false
}

/**
 * Character offsets as crengine counts them.
 *
 * Outside <pre>, crengine's XML parser turns tabs and line breaks into spaces
 * and collapses each run of spaces to one (PreProcessXmlString in lvxml.cpp),
 * and it counts Unicode code points where JavaScript counts UTF-16 units.
 * It also drops a newline that directly follows <pre>.
 * The browser keeps the source text as is, so offsets are mapped both ways.
 */
function* crengineChars(text: Text): Generator<[number, number]> {
  // Yields [browser offset, crengine offset] at the start of each kept char.
  const data = text.data
  const pre = inPre(text)
  let cre = 0
  let prevSpace = false
  let start = 0
  // "A leading newline immediately following the pre element start tag is
  // stripped" (HTML); crengine does this, the browser's XHTML parser doesn't.
  if (
    pre &&
    data.startsWith('\n') &&
    text.parentElement &&
    localName(text.parentElement) === 'pre' &&
    text.parentElement.firstChild === text
  ) {
    start = 1
  }
  for (let i = start; i < data.length; ) {
    const cp = data.codePointAt(i) ?? 0
    const width = cp > 0xffff ? 2 : 1
    const space = !pre && XML_SPACE.has(data[i])
    if (!(space && prevSpace)) {
      yield [i, cre]
      cre++
    }
    prevSpace = space
    i += width
  }
  yield [data.length, cre]
}

function toCrengineOffset(text: Text, offset: number): number {
  let result = 0
  for (const [browser, cre] of crengineChars(text)) {
    if (browser > offset) break
    result = cre
  }
  return result
}

function fromCrengineOffset(text: Text, offset: number): number | null {
  for (const [browser, cre] of crengineChars(text)) {
    if (cre === offset) return browser
  }
  return null // past the end
}

/** Text children as crengine sees them. */
function crengineTextNodes(el: Element): Text[] {
  const texts: Text[] = []
  const children = Array.from(el.childNodes)
  children.forEach((child, i) => {
    if (child.nodeType !== Node.TEXT_NODE) return
    const text = child as Text
    if (
      i === 0 &&
      BLOCK_TAGS.has(localName(el)) &&
      isWhitespace(text.data) &&
      localName(el) !== 'pre'
    )
      return
    texts.push(text)
  })
  return texts
}

type Step =
  | { kind: 'element'; name: string; index: number }
  | { kind: 'text'; index: number }
  | { kind: 'node'; index: number }

const STEP = /^(?:(text\(\))|([A-Za-z_][\w.-]*)|(\d+))(?:\[(\d+)\])?$/

function parseSteps(path: string): { steps: Step[]; offset: number | null } {
  let offset: number | null = null
  const dot = path.match(/\.(\d+)$/)
  if (dot) {
    offset = parseInt(dot[1], 10)
    path = path.slice(0, -dot[0].length)
  }
  const steps: Step[] = []
  for (const part of path.split('/').filter(Boolean)) {
    const m = STEP.exec(part)
    if (!m) throw new Error(`Bad XPointer step: ${part}`)
    const index = m[4] ? parseInt(m[4], 10) : 1
    if (m[1]) steps.push({ kind: 'text', index })
    else if (m[2])
      steps.push({ kind: 'element', name: m[2].toLowerCase(), index })
    else steps.push({ kind: 'node', index: parseInt(m[3], 10) })
  }
  return { steps, offset }
}

export interface ResolvedXPointer {
  /** Node the XPointer resolved to (as deep as the path could be followed). */
  node: Node
  /** Character offset into ``node`` when it is a text node. */
  offset: number
  /** False if part of the path couldn't be followed and we stopped early. */
  exact: boolean
}

/**
 * Find an XPointer's position in a spine item's document.
 *
 * Follows the path as far as it can: if the book's markup differs from what
 * KOReader saw, it lands on the deepest element it could reach rather than
 * failing, so the reader still opens at the right section.
 */
export function resolveXPointer(
  doc: Document,
  xpointer: string
): ResolvedXPointer | null {
  const m = ROOT.exec(xpointer)
  const body = doc.body ?? doc.querySelector('body')
  if (!m || !body) return null
  let parsed: ReturnType<typeof parseSteps>
  try {
    parsed = parseSteps(xpointer.slice(m[0].length))
  } catch {
    return { node: body, offset: 0, exact: false }
  }

  let current: Node = body
  for (const step of parsed.steps) {
    const el = current as Element
    let next: Node | undefined
    if (step.kind === 'element') {
      next = Array.from(el.children).filter((c) => localName(c) === step.name)[
        step.index - 1
      ]
    } else if (step.kind === 'text') {
      next = crengineTextNodes(el)[step.index - 1]
    } else {
      next = el.childNodes[step.index - 1]
    }
    if (!next) return { node: current, offset: 0, exact: false }
    current = next
    if (current.nodeType === Node.TEXT_NODE) break
  }

  if (current.nodeType === Node.TEXT_NODE) {
    const text = current as Text
    const offset = fromCrengineOffset(text, parsed.offset ?? 0)
    if (offset == null) {
      return { node: text, offset: text.data.length, exact: false }
    }
    return { node: text, offset, exact: true }
  }
  return { node: current, offset: 0, exact: true }
}

/** A collapsed range at an XPointer's position, for the reader to go to. */
export function rangeFromXPointer(
  doc: Document,
  xpointer: string
): Range | null {
  const resolved = resolveXPointer(doc, xpointer)
  if (!resolved) return null
  const range = doc.createRange()
  if (resolved.node.nodeType === Node.TEXT_NODE) {
    range.setStart(resolved.node, resolved.offset)
  } else {
    range.selectNodeContents(resolved.node)
  }
  range.collapse(true)
  return range
}
