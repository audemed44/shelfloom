import { describe, expect, it } from 'vitest'
import {
  rangeFromXPointer,
  resolveXPointer,
  sectionIndexOf,
  xpointerForElement,
  xpointerFromRange,
} from '../reader/xpointer'

// A spine item as the reader loads it (parsed as XHTML, like EPUB content).
const XHTML = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Chapter 3</title></head>
<body>
  <h2 class="chapter">Chapter Three</h2>
  <div class="text">
    <p>First paragraph.</p>
    <p>Second <em>paragraph</em> with more text.</p>
    <p>Third paragraph.</p>
  </div>
  <p class="note">A note.</p>
</body>
</html>`

function rangeAt(d: Document, node: Node, offset: number): Range {
  const range = d.createRange()
  range.setStart(node, offset)
  return range
}

function doc(): Document {
  return new DOMParser().parseFromString(XHTML, 'application/xhtml+xml')
}

describe('KOReader XPointers', () => {
  it('writes crengine-style paths: 1-based DocFragment, index only among same-named siblings', () => {
    const d = doc()
    const second = d.querySelectorAll('div.text > p')[1]
    expect(xpointerForElement(second, 11)).toBe(
      '/body/DocFragment[12]/body/div/p[2]'
    )
    // Only one <h2> under body: no index. Two <p> at body level? No — one.
    expect(xpointerForElement(d.querySelector('h2')!, 0)).toBe(
      '/body/DocFragment[1]/body/h2'
    )
    expect(xpointerForElement(d.querySelector('p.note')!, 0)).toBe(
      '/body/DocFragment[1]/body/p'
    )
    expect(xpointerForElement(d.querySelector('em')!, 0)).toBe(
      '/body/DocFragment[1]/body/div/p[2]/em'
    )
  })

  it('points ranges at the exact character, as KOReader writes it', () => {
    const d = doc()
    const third = d.querySelectorAll('div.text > p')[2]
    const inText = d.createRange()
    inText.setStart(third.firstChild!, 6)
    expect(xpointerFromRange(inText, 2)).toBe(
      '/body/DocFragment[3]/body/div/p[3]/text().6'
    )

    // Text after an inline element is the paragraph's second text node.
    const second = d.querySelectorAll('div.text > p')[1]
    const after = d.createRange()
    after.setStart(second.lastChild!, 6)
    expect(xpointerFromRange(after, 2)).toBe(
      '/body/DocFragment[3]/body/div/p[2]/text()[2].6'
    )

    const div = d.querySelector('div.text')!
    const atBoundary = d.createRange()
    atBoundary.setStart(div, 0) // the whitespace before the first <p>
    expect(xpointerFromRange(atBoundary, 2)).toBe(
      '/body/DocFragment[3]/body/div/p[1]/text().0'
    )
  })

  it('counts characters the way crengine does', () => {
    const d = new DOMParser().parseFromString(
      `<html xmlns="http://www.w3.org/1999/xhtml"><body>
<p>
    Wrapped   across
    lines 🐔 then&#160;on.</p>
<pre>
kept   spaces</pre>
</body></html>`,
      'application/xhtml+xml'
    )
    const p = d.querySelector('p')!.firstChild as Text
    // crengine: line breaks and runs of spaces become one space, and an
    // emoji is one character, not two UTF-16 units.
    const at = (s: string) => p.data.indexOf(s)
    expect(xpointerFromRange(rangeAt(d, p, at('Wrapped')), 0)).toBe(
      '/body/DocFragment[1]/body/p/text().1'
    )
    expect(xpointerFromRange(rangeAt(d, p, at('lines')), 0)).toBe(
      '/body/DocFragment[1]/body/p/text().16'
    )
    expect(xpointerFromRange(rangeAt(d, p, at('then')), 0)).toBe(
      '/body/DocFragment[1]/body/p/text().24'
    )
    // And back again.
    const r = resolveXPointer(d, '/body/DocFragment[1]/body/p/text().24')!
    expect(p.data.slice(r.offset)).toBe('then\u00a0on.')

    // <pre> keeps its spaces, but crengine drops the newline after <pre>.
    const pre = d.querySelector('pre')!.firstChild as Text
    expect(
      xpointerFromRange(rangeAt(d, pre, pre.data.indexOf('spaces')), 0)
    ).toBe('/body/DocFragment[1]/body/pre/text().7')
  })

  it('reads the spine index', () => {
    expect(sectionIndexOf('/body/DocFragment[12]/body/p[5]/text().42')).toBe(11)
    expect(sectionIndexOf('/body/DocFragment[1]')).toBe(0)
    expect(sectionIndexOf('12')).toBeNull() // a PDF page number
    expect(sectionIndexOf('/body/DocFragment[0]/body')).toBeNull()
  })

  it('resolves KOReader text positions, ignoring the whitespace crengine drops', () => {
    const d = doc()
    // "Second " is text()[1] of p[2]; " with more text." is text()[2].
    const r = resolveXPointer(
      d,
      '/body/DocFragment[3]/body/div/p[2]/text()[2].6'
    )!
    expect(r.exact).toBe(true)
    expect(r.node.nodeType).toBe(Node.TEXT_NODE)
    expect((r.node as Text).data.slice(r.offset)).toBe('more text.')

    const first = resolveXPointer(
      d,
      '/body/DocFragment[3]/body/div/p/text().6'
    )!
    expect((first.node as Text).data.slice(first.offset)).toBe('paragraph.')
  })

  it('accepts explicit [1] indexes and element-only paths', () => {
    const d = doc()
    const r = resolveXPointer(d, '/body/DocFragment[1]/body[1]/div[1]/p[3]')!
    expect((r.node as Element).textContent).toBe('Third paragraph.')
    expect(r.exact).toBe(true)
  })

  it('lands on the deepest element it can reach when the markup differs', () => {
    const d = doc()
    const r = resolveXPointer(d, '/body/DocFragment[1]/body/div/p[9]/text().4')!
    expect(r.exact).toBe(false)
    expect((r.node as Element).className).toBe('text')

    const clamped = resolveXPointer(
      d,
      '/body/DocFragment[1]/body/p/text().9999'
    )!
    expect(clamped.exact).toBe(false)
    expect(clamped.offset).toBe('A note.'.length)

    expect(resolveXPointer(d, '42')).toBeNull()
  })

  it('round-trips an element position', () => {
    const d = doc()
    const em = d.querySelector('em')!
    const xp = xpointerForElement(em, 4)
    const range = rangeFromXPointer(d, xp)!
    expect(range.startContainer).toBe(em)
    expect(range.collapsed).toBe(true)
  })
})

describe('page starts at an empty element', () => {
  it('uses the text that follows, like KOReader', () => {
    const d = new DOMParser().parseFromString(
      '<html xmlns="http://www.w3.org/1999/xhtml"><body><div><h2><a id="c11"></a>CHAPTER XI.</h2><p>Text</p></div></body></html>',
      'application/xhtml+xml'
    )
    const range = d.createRange()
    range.setStart(d.querySelector('h2')!, 0) // at the empty <a>
    expect(xpointerFromRange(range, 12)).toBe(
      '/body/DocFragment[13]/body/div/h2/text().0'
    )
  })
})
