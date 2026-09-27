/**
 * Checks Shelfloom's XPointer conversion (src/reader/xpointer.ts) against
 * KOReader's own engine, on real EPUB files.
 *
 *   KOREADER_DIR=/path/to/koreader/lib/koreader node check.mjs book.epub [...]
 *
 * For each book:
 *  1. KOReader's XPointers at page tops are resolved here and converted back:
 *     the result must be the identical string.
 *  2. Random positions in the browser DOM are converted to XPointers and read
 *     back by KOReader: it must find the same characters there.
 *
 * Needs the KOReader Linux build (koreader-linux-x86_64-*.tar.xz from
 * https://build.koreader.rocks/download/stable/), unzip, and the frontend's
 * dev dependencies (jsdom, esbuild).
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '../..')
const koDir = process.env.KOREADER_DIR
if (!koDir) throw new Error('Set KOREADER_DIR to KOReader\'s lib/koreader directory')
const books = process.argv.slice(2)
if (!books.length) throw new Error('Pass one or more .epub files')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xpcheck-'))
const bundle = path.join(tmp, 'xpointer.mjs')
execFileSync('npx', ['esbuild', 'src/reader/xpointer.ts', '--format=esm', `--outfile=${bundle}`, '--log-level=warning'], { cwd: frontend })
fs.copyFileSync(path.join(here, 'crecheck.lua'), path.join(koDir, 'crecheck.lua'))

const { window } = new JSDOM('')
Object.assign(globalThis, { Node: window.Node, DOMParser: window.DOMParser, NodeFilter: window.NodeFilter })
const X = await import(pathToFileURL(bundle).href)

function cre(book, ...args) {
  const out = execFileSync('./luajit', ['crecheck.lua', path.resolve(book), ...args.map(String)], {
    cwd: koDir, env: { ...process.env, SDL_VIDEODRIVER: 'dummy' }, maxBuffer: 64 << 20,
  }).toString('utf8')
  return out.split('\n').filter((l) => l.startsWith('RESULT\t')).map((l) => l.split('\t').slice(1))
}

function loadSpine(book) {
  const dir = path.join(tmp, path.basename(book))
  fs.mkdirSync(dir)
  execFileSync('unzip', ['-q', path.resolve(book), '-d', dir])
  const container = fs.readFileSync(path.join(dir, 'META-INF/container.xml'), 'utf8')
  const opfPath = container.match(/full-path="([^"]+)"/)[1]
  const opf = new DOMParser().parseFromString(fs.readFileSync(path.join(dir, opfPath), 'utf8'), 'application/xml')
  const hrefs = new Map([...opf.getElementsByTagName('item')].map((i) => [i.getAttribute('id'), decodeURIComponent(i.getAttribute('href'))]))
  const files = [...opf.getElementsByTagName('itemref')].map((r) => path.join(dir, path.dirname(opfPath), hrefs.get(r.getAttribute('idref'))))
  const docs = new Map()
  return (i) => {
    if (!docs.has(i)) docs.set(i, new DOMParser().parseFromString(fs.readFileSync(files[i], 'utf8'), 'application/xhtml+xml'))
    return docs.get(i)
  }
}

const squash = (s) => s.replace(/\s+/g, ' ').trim()
let failures = 0
for (const book of books) {
  const docFor = loadSpine(book)
  const pages = Number(cre(book, 'pages')[0][0])
  const sample = [...new Set(Array.from({ length: 24 }, (_, i) => Math.max(1, Math.round((pages * (i + 1)) / 25))))]
  const theirs = cre(book, 'xps', ...sample).map(([, xp]) => xp)
  let same = 0
  for (const xp of theirs) {
    const idx = X.sectionIndexOf(xp)
    const r = X.resolveXPointer(docFor(idx), xp)
    const ours = X.xpointerForPosition(r.node, r.offset, idx)
    if (ours === xp && r.exact) same++
    else console.log(`  KOReader ${xp} -> ours ${ours}`)
  }

  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const probes = []
  for (let tries = 0; probes.length < 60 && tries < 2000; tries++) {
    const idx = X.sectionIndexOf(theirs[Math.floor(rnd() * theirs.length)])
    const doc = docFor(idx)
    const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT)
    const texts = []
    for (let t = walker.nextNode(); t; t = walker.nextNode()) if (t.data.trim().length > 20) texts.push(t)
    if (!texts.length) continue
    const t = texts[Math.floor(rnd() * texts.length)]
    const chars = [...t.data]
    const at = Math.floor(rnd() * (chars.length - 10))
    const from = chars.slice(0, at).join('').length
    const to = from + chars.slice(at, at + 10).join('').length
    probes.push([X.xpointerForPosition(t, from, idx), X.xpointerForPosition(t, to, idx), t.data.slice(from, to)])
  }
  const spans = cre(book, 'span', ...probes.flatMap(([a, b]) => [a, b]))
  let landed = 0
  probes.forEach(([a, , text], i) => {
    if (squash(spans[i]?.[1] ?? '') === squash(text)) landed++
    else console.log(`  ${a}: ours ${JSON.stringify(text)}, KOReader ${JSON.stringify(spans[i]?.[1])}`)
  })
  failures += theirs.length - same + probes.length - landed
  console.log(`${path.basename(book)}: KOReader positions round-trip ${same}/${theirs.length}, web positions land ${landed}/${probes.length}`)
}
fs.rmSync(tmp, { recursive: true, force: true })
process.exit(failures ? 1 : 0)
