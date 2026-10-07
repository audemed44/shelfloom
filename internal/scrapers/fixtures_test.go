package scrapers

// HTML fixtures from the Python backend's tests/test_scrapers.py.

const (
	rrStoryHtml = `
<html><body>
<div class="fic-header">
  <div class="col"><h1>My Story</h1></div>
  <h4><span><a>AuthorName</a></span></h4>
</div>
<div class="fiction-info"><div class="description">Great story</div></div>
<img class="thumbnail" src="https://cdn.royalroad.com/cover.jpg" />
<table id="chapters">
  <tr>
    <td><a href="/fiction/1/my-story/chapter/100/ch1">Chapter 1</a></td>
    <td><time datetime="2025-01-15T12:00:00Z">Jan 15</time></td>
  </tr>
  <tr>
    <td><a href="/fiction/1/my-story/chapter/101/ch2">Chapter 2</a></td>
    <td><time datetime="2025-01-22T12:00:00Z">Jan 22</time></td>
  </tr>
</table>
</body></html>
`
	rrChapterHtml = `
<html><body>
<h1>Chapter 1: The Beginning</h1>
<div class="portlet-body">
  <div class="chapter-inner">
    <p>Once upon a time</p>
    <p>there was a story.</p>
  </div>
</div>
</body></html>
`
	nfChaptersHtml = `
<html><body>
<div class="novel-info"><h1>Fire Novel</h1></div>
<span itemprop="author">NF Author</span>
<meta name="description" content="An epic tale" />
<meta property="og:image" content="https://novelfire.net/cover.jpg" />
<ul class="chapter-list">
  <li><a href="/novel/1/chapter-1"><span class="chapter-title">Chapter 1</span></a></li>
  <li><a href="/novel/1/chapter-2"><span class="chapter-title">Chapter 2</span></a></li>
</ul>
</body></html>
`
	nfChapterHtml = `
<html><body>
<span class="chapter-title">Chapter 1: Fire</span>
<div class="chapter-content">
  <p>The fire burned bright.</p>
</div>
</body></html>
`
	wiTocHtml = `
<html><body>
<meta name="description" content="A great inn" />
<meta property="og:image" content="https://wanderinginn.com/cover.jpg" />
<div id="table-of-contents">
  <a class="book-title-num">Volume 1</a>
  <a href="/2019/01/01/chapter-1-the-inn">Chapter 1 – The Inn</a>
  <a href="/2019/01/08/chapter-2-guests">Chapter 2 – Guests</a>
</div>
</body></html>
`
	wiChapterHtml = `
<html><body>
<h2 class="elementor-heading-title">Chapter 1 – The Inn</h2>
<div id="reader-content">
  <p>Erin opened the door.</p>
  <p class="mrsha-write" style="color: white">Mrsha wrote something.</p>
</div>
</body></html>
`
	wpTocHtml = `
<html><body>
<h1 class="entry-title">My WP Novel</h1>
<span rel="author">WP Author</span>
<meta name="description" content="A WordPress novel" />
<meta property="og:image" content="https://mynovel.wordpress.com/cover.jpg" />
<div class="entry-content">
  <a href="https://mynovel.wordpress.com/chapter-1-start">Chapter 1 Start</a>
  <a href="https://mynovel.wordpress.com/chapter-2-middle">Chapter 2 Middle</a>
  <a href="https://mynovel.wordpress.com/about">About (skip)</a>
</div>
</body></html>
`
	wpChapterHtml = `
<html><body>
<h1 class="entry-title">Chapter 1</h1>
<div class="entry-content">
  <p>The story began here.</p>
  <a rel="next" href="/chapter-2">Next</a>
</div>
</body></html>
`
	seqCh1Html = `
<html><head>
<title>Chapter 1 | My Blog Novel</title>
<meta property="og:site_name" content="My Blog Novel" />
</head><body>
<h1>Chapter 1</h1>
<div class="entry-content">
  <p>First chapter content.</p>
  <a rel="next" href="/chapter-2-the-journey">Next Chapter</a>
</div>
</body></html>
`
	seqCh2Html = `
<html><head>
<title>Chapter 2 | My Blog Novel</title>
<meta property="og:site_name" content="My Blog Novel" />
</head><body>
<h1>Chapter 2</h1>
<div class="entry-content">
  <p>Second chapter content.</p>
</div>
</body></html>
`
	wildbowTocHtml = `
<html><head>
<meta property="og:site_name" content="Pale" />
<meta name="description" content="A web serial by Wildbow" />
<meta property="og:image" content="https://example.com/cover.jpg" />
</head><body>
<div class="entry-content">
<p><strong>Arc 1 – Lost for Words</strong></p>
<p style="padding-left: 40px">
  <strong>
    <a href="https://palewebserial.wordpress.com/2020/05/05/blood-0-0/">
      0.0
    </a>
    – Prologue.
  </strong>
</p>
<p style="padding-left: 40px">
  <strong>
    <a href="https://palewebserial.wordpress.com/2020/05/09/lost-1-1/">
      1.1
    </a>
    – Verona
  </strong>
</p>
<p style="padding-left: 40px">
  <strong>
    <a href="https://palewebserial.wordpress.com/2020/05/12/lost-1-2/">
      1.2
    </a>
    – Lucy
  </strong>
</p>
<p style="padding-left: 40px">
  <strong>
    <a href="https://palewebserial.wordpress.com/2020/05/16/lost-1-z/">
      1.z
    </a>
    – Interlude
  </strong>
</p>
<p>
  <a href="https://other-site.com/not-a-chapter">External Link</a>
  <a href="https://palewebserial.wordpress.com/about/">About</a>
</p>
</div>
</body></html>
`
	wildbowExtrasHtml = `
<html><body>
<div class="entry-content">
<p><strong>[0.0]
  <a href="https://palewebserial.wordpress.com/2020/05/07/brochure/">
    The Brochure
  </a>
</strong></p>
<p><strong>[1.2]
  <a href="https://palewebserial.wordpress.com/2020/05/14/notes-1/">
    Notes on Others
  </a>
</strong></p>
<p><strong>[99.9]
  <a href="https://palewebserial.wordpress.com/2020/06/01/orphan/">
    Orphan Extra
  </a>
</strong></p>
</div>
</body></html>
`
	wildbowChapterHtml = `
<html><head><title>Blood Run Cold 0.0 | Pale</title></head><body>
<h1 class="entry-title">Blood Run Cold 0.0</h1>
<div class="entry-content">
  <p>The world was ending.</p>
  <p>Or it felt like it.</p>
  <div class="sharedaddy">Share this</div>
  <a rel="next" href="/next">Next</a>
</div>
</body></html>
`
)
