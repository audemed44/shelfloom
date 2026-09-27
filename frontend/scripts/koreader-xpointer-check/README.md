# KOReader XPointer check

Verifies the web reader's position conversion (`src/reader/xpointer.ts`)
against KOReader's own rendering engine (crengine), on real EPUB files. Run it
after changing the converter or updating foliate-js; it is not part of CI
because it needs a KOReader download.

```sh
# KOReader for Linux x86_64 (any recent stable)
curl -LO https://build.koreader.rocks/download/stable/<version>/koreader-linux-x86_64-<version>.tar.xz
mkdir koreader && tar -xJf koreader-linux-x86_64-*.tar.xz -C koreader

cd frontend
KOREADER_DIR=$PWD/../koreader/lib/koreader node scripts/koreader-xpointer-check/check.mjs book1.epub book2.epub
```

For each book it checks that

1. KOReader's XPointers (taken at page tops) resolve in the browser DOM and
   convert back to the identical string, and
2. random browser positions, converted to XPointers, point KOReader at the
   same characters.

It exits non-zero if anything differs.
