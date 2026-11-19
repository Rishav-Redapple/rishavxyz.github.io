import { rm } from 'node:fs/promises'

import type { BlogMetadata, PageMetadata } from './cli'
import * as utils from './utils'

const SITE_URL = 'https://rishavxyz.github.io'
const SITE_NAME = 'Rishav Mandal'

export const DIRS = {
  BUILD: 'live',
  PAGES: 'content/pages',
  BLOGS: 'content/blogs',
  TEMPLATE: 'template',
  CSS: 'css',
  ASSETS: 'assets',
} as const

type NavLink = { slug: string; label: string; at?: string }
type BlogItem = BlogMetadata & { dir: string }
type SeoOpts = {
  title: string
  excerpt: string
  slug: string
  draft?: boolean
  at?: string
  category?: string | null
}

const toUrl = (path: string) => {
  const p = path.replace(/^\/+/, '').replace(/\/+$/, '')
  return p ? `${SITE_URL}/${p}/` : `${SITE_URL}/`
}

function genNavLinks(a: NavLink[]) {
  const cap = (s: string) => s.at(0)!.toUpperCase() + s.slice(1)
  return a
    .filter((it) => !utils.ishome(it))
    .map(
      (it) =>
        `<li><a href="${it.slug.endsWith('/') ? it.slug : it.slug + '/'}">${cap(it.label)}</a></li>`,
    )
    .join('\n\t')
}

function genSeo(c: SeoOpts) {
  const url = toUrl(c.slug)
  const desc = utils.esc(c.excerpt)
  const title = c.title === SITE_NAME ? c.title : `${utils.esc(c.title)} | ${SITE_NAME}`
  const robots = ['index', 'follow'].map((s) => (c.draft ? 'no' + s : s)).join(', ')

  const tags = utils.cn<string>(
    `<title>${title}</title>`,
    `<meta name="description" content="${desc}">`,
    `<meta name="robots" content="${robots}">`,
    !c.draft && c.at && `<meta property="article:published_time" content="${c.at}">`,
    !c.draft &&
      `<link rel="canonical" href="${url}">
     <meta property="og:type" content="${c.category ? 'article' : 'website'}">
     <meta property="og:site_name" content="${SITE_NAME}">
     <meta property="og:title" content="${title}">
     <meta property="og:description" content="${desc}">
     <meta property="og:url" content="${url}">
     <meta name="twitter:card" content="summary_large_image">
     <meta name="twitter:title" content="${title}">
     <meta name="twitter:description" content="${desc}">
    `,
  )
  return tags.join('\n')
}

async function buildFonts(): utils.IOResult<string> {
  const globs = await utils.readglob<Uint8Array>(utils.fjoin(DIRS.ASSETS, 'fonts'), '*.woff2')
  type Font = {
    name: string
    url: string
    weight: string
    style: 'italic' | 'normal'
  }
  const renderFont = (f: Font) =>
    `
    @font-face {
      font-family: "${f.name}";
      src: url("${f.url}") format("woff2");
      font-weight: ${f.weight};
      font-style: ${f.style};
      font-display: swap;
    }
  `.trim()

  const fontFaces: string[] = []
  const writes: utils.FileCons[] = []

  for (const fc of globs) {
    const name = utils.dirname(fc.name)
    const style = fc.name.includes('italic') ? 'italic' : 'normal'
    const isvar = fc.name.includes('var')

    const hashedName = `${name}-${utils.hash(fc.data)}-${utils.basename(fc.name)}`
    const url = utils.fjoin('/fonts', hashedName)

    writes.push({
      name: utils.fjoin(DIRS.BUILD, url),
      type: 'bin',
      data: fc.data,
    })
    fontFaces.push(renderFont({ name, style, url, weight: isvar ? '200 800' : '400' }))
  }

  const fontFace = fontFaces.join('\n')
  const cssFontFileName = utils.fjoin(DIRS.BUILD, 'css', `${utils.hash(fontFace)}-font.css`)
  writes.push({
    name: cssFontFileName,
    type: 'text',
    data: fontFace,
  })

  const results = await Promise.all(writes.map(utils.write))
  const [, errs] = utils.partition(results)
  if (errs.length > 0) return utils.Err(errs[0]!)

  return utils.Ok(cssFontFileName.replace(DIRS.BUILD, ''))
}

async function buildCSSAndAssets(): utils.IOResult<string> {
  const copyOps: utils.IOResult<number>[] = []

  const faviconPath = utils.fjoin(DIRS.ASSETS, 'favicon.ico')
  if (await utils.exists(faviconPath)) {
    copyOps.push(utils.copy(faviconPath, utils.fjoin(DIRS.BUILD, 'favicon.ico')))
  }

  const appleTouchPath = utils.fjoin(DIRS.ASSETS, 'apple-touch-icon.png')
  if (await utils.exists(appleTouchPath)) {
    copyOps.push(utils.copy(appleTouchPath, utils.fjoin(DIRS.BUILD, 'apple-touch-icon.png')))
  }

  const fontRes = await buildFonts()
  if (!fontRes.ok) return fontRes
  const fontFileName = fontRes.value
  const fontFileTag = `<link rel="stylesheet" href="${fontFileName}">`

  const globs = await utils.readglob<string>(DIRS.CSS, '*.css')
  const cssTags: string[] = []
  let siteCssTag = ''
  const cssWrites: utils.FileCons[] = []

  for (const fc of globs) {
    const hashName = `${utils.hash(fc.data)}-${utils.basename(fc.name)}`
    const url = utils.fjoin('/css', hashName)
    cssWrites.push({
      name: utils.fjoin(DIRS.BUILD, url),
      type: 'text',
      data: fc.data,
    })
    const tag = `<link rel="stylesheet" href="${url}">`

    if (fc.name.includes('site.css')) siteCssTag = tag
    else cssTags.push(tag)
  }

  const writeOps = cssWrites.map(utils.write)
  const allOps = await Promise.all([...copyOps, ...writeOps])
  const [, errs] = utils.partition(allOps)
  if (errs.length > 0) return utils.Err(errs[0]!)

  // site.css goes at the last for precedence
  return utils.Ok([fontFileTag, ...cssTags, siteCssTag].join('\n'))
}

async function getNavLinks(): utils.IOResult<NavLink[]> {
  const globs = await utils.readglob<PageMetadata>(DIRS.PAGES, 'metadata.json')
  const links: NavLink[] = globs
    .filter((it) => !it.data.draft)
    .map((it) => ({
      slug: utils.fjoin('/', it.data.slug),
      label: it.data.label,
      at: it.data.at,
    }))
  links.push({ slug: '/blogs', label: 'blogs' })
  return utils.Ok(links)
}

async function buildPages(css: string, navlinks: NavLink[]): utils.IOResult<number> {
  const globs = await utils.readglob<PageMetadata>(DIRS.PAGES, 'metadata.json')
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()

  const tasks = globs
    .filter((it) => !it.data.draft)
    .map(async (fc): utils.IOResult<number> => {
      let dir = utils.dirname(fc.name)
      const readmePath = utils.fjoin(DIRS.PAGES, dir, 'README.md')
      const readRes = await utils.read(readmePath, 'text')
      if (!readRes.ok) return readRes

      const html = utils.md2html(readRes.value, { headings: true })
      dir = utils.ishome(fc.data) ? '/' : dir

      const pageHtmlRes = await utils.genHtmlPage({
        '%%sitename%%': SITE_NAME,
        '%%css%%': css,
        '%%seo%%': genSeo(fc.data),
        '%%content%%': html,
        '%%navlinks%%': navlinkHtml,
        '%%copyright%%': copyright,
      })
      if (!pageHtmlRes.ok) return pageHtmlRes

      return utils.write({
        name: utils.fjoin(DIRS.BUILD, dir, 'index.html'),
        type: 'text',
        data: utils.htmlpp(pageHtmlRes.value),
      })
    })

  const results = await Promise.all(tasks)
  const [oks, errs] = utils.partition(results)
  if (errs.length > 0) return utils.Err(errs[0]!)
  return utils.Ok(oks.length)
}

async function getBlogs(): utils.IOResult<BlogItem[]> {
  const globs = await utils.readglob<BlogMetadata>(DIRS.BLOGS, 'metadata.json')
  const blogs = globs
    .filter((it) => !it.data.draft)
    .map((it) => ({ dir: utils.dirname(it.name), ...it.data }))
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  return utils.Ok(blogs)
}

async function buildBlogs(css: string, navlinks: NavLink[], blogs: BlogItem[]): utils.IOResult<number> {
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()

  const blogTasks = blogs.map(async (blog): utils.IOResult<{ bytes: number; card: string }> => {
    const readmePath = utils.fjoin(DIRS.BLOGS, blog.dir, 'README.md')
    const readRes = await utils.read(readmePath, 'text')
    if (!readRes.ok) return readRes

    const md = readRes.value
    const content = [
      `<section class="blog">`,
      utils.md2html(md, { headings: true }),
      `</section>`,
      `<p style="padding-top:var(--pico-spacing); margin-bottom: 0;">`,
      `<a role="button" href="/blogs/" class="secondary">`,
      `Read more blogs`,
      `</a>`,
      `</p>`,
    ].join('\n')

    const postHtmlRes = await utils.genHtmlPage({
      '%%sitename%%': SITE_NAME,
      '%%css%%': css,
      '%%seo%%': genSeo({ ...blog, slug: utils.fjoin('blogs', blog.slug) }),
      '%%content%%': content,
      '%%navlinks%%': navlinkHtml,
      '%%copyright%%': copyright,
    })
    if (!postHtmlRes.ok) return postHtmlRes

    const date = utils.fdate(blog.at)
    const meta = [
      `<p class="meta">`,
      `<time datetime="${blog.at}">`,
      date,
      `</time>`,
      `<span>&bull;</span>`,
      `<span>#${blog.category}</span>`,
      `</p>`,
    ].join('')

    const postHtml = utils.htmlpp(postHtmlRes.value, {
      'section.blog h1': {
        // there must be only one h1 per blog
        element(h1) {
          h1.after(meta, { html: true })
        },
      },
    })

    const writeRes = await utils.write({
      name: utils.fjoin(DIRS.BUILD, 'blogs', blog.slug, 'index.html'),
      type: 'text',
      data: postHtml,
    })
    if (!writeRes.ok) return writeRes

    const cardRes = await utils.genBlogCard({
      '%%route%%': `/blogs/${blog.slug}/`,
      '%%title%%': utils.esc(blog.title),
      '%%datetime%%': blog.at,
      '%%date%%': utils.fdate(blog.at),
      '%%excerpt%%': utils.esc(blog.excerpt),
      '%%category%%': blog.category ? `#${utils.esc(blog.category)}` : '',
    })
    if (!cardRes.ok) return cardRes

    return utils.Ok({ bytes: writeRes.value, card: cardRes.value })
  })

  const blogResults = await Promise.all(blogTasks)
  const [oks, errs] = utils.partition(blogResults)
  if (errs.length > 0) return utils.Err(errs[0]!)

  const cards = oks.map((o) => o.card)
  const listContent = `<section class="blog-list grid">\n${cards.join('\n')}\n</section>`
  const blogsIndexHtmlRes = await utils.genHtmlPage({
    '%%sitename%%': SITE_NAME,
    '%%css%%': css,
    '%%seo%%': genSeo({
      title: 'Blogs',
      excerpt: 'Articles no one is interested and mostly generated by AI.',
      slug: '/blogs',
    }),
    '%%content%%': listContent,
    '%%navlinks%%': navlinkHtml,
    '%%copyright%%': copyright,
  })
  if (!blogsIndexHtmlRes.ok) return blogsIndexHtmlRes

  const indexWriteRes = await utils.write({
    name: utils.fjoin(DIRS.BUILD, 'blogs', 'index.html'),
    type: 'text',
    data: blogsIndexHtmlRes.value,
  })
  if (!indexWriteRes.ok) return indexWriteRes

  return utils.Ok(oks.length + 1)
}

async function build404(css: string, navlinks: NavLink[]): utils.IOResult<number> {
  const navlinkHtml = genNavLinks(navlinks)
  const copyright = utils.genCC()
  const emptyCardRes = await utils.genEmptyCard({
    '%%title%%': `You're lost? How!?`,
    '%%description%%': `This site has only ${navlinks.length} pages, and you're lost in here? That's brilliant ese!`,
  })
  if (!emptyCardRes.ok) return emptyCardRes

  const html404Res = await utils.genHtmlPage({
    '%%sitename%%': SITE_NAME,
    '%%css%%': css,
    '%%seo%%': genSeo({
      title: `404 • You're lost`,
      slug: '/404',
      excerpt: 'Page not found',
      draft: true,
    }),
    '%%content%%': emptyCardRes.value,
    '%%navlinks%%': navlinkHtml,
    '%%copyright%%': copyright,
  })
  if (!html404Res.ok) return html404Res

  return utils.write({
    name: utils.fjoin(DIRS.BUILD, '404.html'),
    type: 'text',
    data: html404Res.value,
  })
}

async function buildRSS(blogs: BlogItem[]): utils.IOResult<number> {
  const items = blogs.map((blog) => {
    const link = toUrl(utils.fjoin('blogs', blog.slug))
    const desc = utils.esc(blog.excerpt)
    const title = utils.esc(blog.title)
    const category = blog.category
    const date = new Date(blog.at).toUTCString()

    const item = utils
      .cn(
        '<item>',
        `  <title>${title}</title>`,
        `  <link>${link}</link>`,
        `  <pubDate>${date}</pubDate>`,
        `  <description>${desc}</description>`,
        `  <guid isPermaLink="true">${link}</guid>`,
        category && `  <category>${category}</category>`,
        '</item>',
      )
      .join('\n')

    return item
  })

  const rssRes = await utils.genTempl('rss.xml', {
    '%%title%%': SITE_NAME,
    '%%canonical%%': SITE_URL,
    '%%description%%': 'Articles and thoughts by Rishav Mandal',
    '%%buildDate%%': new Date().toUTCString(),
    '%%rssLink%%': `${SITE_URL}/rss.xml`,
    '%%items%%': items.join('\n'),
  })
  if (!rssRes.ok) return rssRes

  return utils.write({
    name: utils.fjoin(DIRS.BUILD, 'rss.xml'),
    type: 'text',
    data: rssRes.value,
  })
}

async function buildSitemap(navlinks: NavLink[], blogs: BlogItem[]): utils.IOResult<number> {
  const pageUrls = navlinks.map((link) => {
    const url = toUrl(link.slug)
    const lastmod = link.at ?? new Date().toISOString()
    return utils
      .cn('  <url>', `    <loc>${url}</loc>`, `    <lastmod>${lastmod}</lastmod>`, '  </url>')
      .join('\n')
  })

  const blogUrls = blogs.map((blog) => {
    const url = toUrl(utils.fjoin('blogs', blog.slug))
    const lastmod = blog.at
    return utils
      .cn('  <url>', `    <loc>${url}</loc>`, `    <lastmod>${lastmod}</lastmod>`, '  </url>')
      .join('\n')
  })

  const urls = [...pageUrls, ...blogUrls].join('\n')
  const sitemapRes = await utils.genTempl('sitemap.xml', {
    '%%urls%%': urls,
  })
  if (!sitemapRes.ok) return sitemapRes

  return utils.write({
    name: utils.fjoin(DIRS.BUILD, 'sitemap.xml'),
    type: 'text',
    data: sitemapRes.value,
  })
}

async function buildMiscFiles(): utils.IOResult<number> {
  const robots = `
User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap.xml
  `.trim()

  const files: utils.FileCons[] = [
    { name: utils.fjoin(DIRS.BUILD, '.nojekyll'), type: 'text', data: '' },
    { name: utils.fjoin(DIRS.BUILD, 'robots.txt'), type: 'text', data: robots },
  ]

  const results = await Promise.all(files.map(utils.write))
  const [, errs] = utils.partition(results)
  if (errs.length > 0) return utils.Err(errs[0]!)
  return utils.Ok(files.length)
}

async function rmdist(): utils.IOResult<void> {
  try {
    await rm(utils.fjoin(DIRS.BUILD), { recursive: true, force: true })
    return utils.Ok(undefined)
  } catch (e) {
    return utils.Err(e as Error)
  }
}

async function updateReadme(blogs: BlogItem[]): utils.IOResult<void> {
  if (blogs.length < 1) return utils.Ok(undefined)

  const readme = 'README.md'
  const readRes = await utils.read(readme, 'text')
  if (!readRes.ok) return utils.Ok(undefined)

  const text = readRes.value
  const bloglist = blogs
    .filter((b) => !b.draft)
    .map((b) => {
      const repoUrl = [DIRS.BLOGS, b.dir, 'README.md'].join('/')
      const siteUrl = [SITE_URL, 'blogs', b.slug, ''].join('/')
      return `- **[${b.title}](${siteUrl})** — Read it [on GitHub](${repoUrl}).`
    })
    .join('\n')

  const regex = /(<!-- bloglist:start -->)[\s\S]*?(<!-- bloglist:end -->)/
  if (!regex.test(text)) return utils.Ok(undefined)

  const updated = text.replace(regex, (_, start, end) => [start, bloglist, end].join('\n'))
  const writeRes = await utils.write({
    name: readme,
    type: 'text',
    data: updated,
  })
  if (!writeRes.ok) return writeRes
  return utils.Ok(undefined)
}

type BuildContext = {
  css: string
  navlinks: NavLink[]
  blogs: BlogItem[]
}

type Pipeline = {
  [name: string]: (ctx: BuildContext) => Promise<utils.Result<unknown, Error>>
}

async function run(pipeline: Pipeline) {
  const ctx: BuildContext = {
    css: '',
    navlinks: [],
    blogs: [],
  }
  for (const step in pipeline) {
    console.log('BUILD:', step)
    const fn = pipeline[step]!
    const result = await fn(ctx)
    if (!result.ok) utils.die(`ERROR: ${step}: ${result.err.message}`)
  }
  console.log('BUILD: success!', DIRS.BUILD + '/ is ready to deploy')
}

const pipeline: Pipeline = {
  'cleaning build dir': rmdist,
  'building assets & css': async (ctx) => {
    const res = await buildCSSAndAssets()
    if (res.ok) ctx.css = res.value
    return res
  },
  'building navlinks': async (ctx) => {
    const res = await getNavLinks()
    if (res.ok) ctx.navlinks = res.value
    return res
  },
  'building pages': (ctx) => buildPages(ctx.css, ctx.navlinks),
  'building 404 page': (ctx) => build404(ctx.css, ctx.navlinks),
  'building blogs': async (ctx) => {
    const blogsRes = await getBlogs()
    if (!blogsRes.ok) return blogsRes
    ctx.blogs = blogsRes.value
    return await buildBlogs(ctx.css, ctx.navlinks, ctx.blogs)
  },
  'building rss feed': (ctx) => buildRSS(ctx.blogs),
  'building sitemap': (ctx) => buildSitemap(ctx.navlinks, ctx.blogs),
  'building misc files': buildMiscFiles,
  'updating repo readme': (ctx) => updateReadme(ctx.blogs),
}

if (import.meta.main) run(pipeline)
