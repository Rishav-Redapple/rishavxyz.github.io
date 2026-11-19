import { appendFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseArgs } from 'node:util'

import { DIRS } from './index'
import { type FileCons, die, fjoin, partition, readglob, slugify, tsnow, write } from './utils'

export type CommonMetadata = {
  title: string
  excerpt: string
  slug: string
  draft: boolean
  at: string
  content?: string
}

export type BlogMetadata = { category: string | null } & CommonMetadata
export type PageMetadata = { label: string } & CommonMetadata

export type BlogInitOpts = Pick<BlogMetadata, 'title' | 'excerpt'> &
  Partial<Omit<BlogMetadata, 'title' | 'excerpt'>>

export type PageInitOpts = Pick<PageMetadata, 'title' | 'excerpt' | 'label'> &
  Partial<Omit<PageMetadata, 'title' | 'excerpt' | 'label'>>

type InitOpts = [initfor: 'blog', opts: BlogInitOpts] | [initfor: 'page', opts: PageInitOpts]

export type InitResult = { dir: string; slug: string; title: string }

async function initContentImpl(...[initfor, opts]: InitOpts): Promise<InitResult | null> {
  const { title, excerpt } = opts
  const draft = opts.draft ?? true
  const now = tsnow()

  let dir = '',
    label = '',
    slug = '',
    category: string | null = ''

  if (initfor === 'blog') {
    category = opts.category ?? null
    dir = fjoin(DIRS.BLOGS, now.id)
    slug = opts.slug ?? slugify(title)
  } else if (initfor === 'page') {
    label = opts.label
    dir = fjoin(DIRS.PAGES, slugify(label))
    slug = opts.slug ?? slugify(label)
  } else return null

  const metaContent =
    initfor === 'blog'
      ? { title, excerpt, draft, at: now.z, category, slug }
      : { title, excerpt, draft, at: now.z, label, slug }

  const metafile: FileCons = {
    name: fjoin(dir, 'metadata.json'),
    type: 'json',
    data: metaContent,
  }
  const mainfile: FileCons = {
    name: fjoin(dir, 'README.md'),
    type: 'text',
    data: ['# ', title, '\n\n', opts.content ?? excerpt].join('')
  }

  const results = await Promise.all([metafile, mainfile].map(write))
  const [, errs] = partition(results)
  if (errs.length > 0) die(errs[0]!.message)
  return { dir, slug, title }
}

export const initContent = {
  Blog: (publish: boolean, category: string | null, title: string, excerpt: string) =>
    initContentImpl('blog', { title, excerpt, draft: !publish, category }),
  Page: (publish: boolean, label: string, title: string, excerpt: string) =>
    initContentImpl('page', { title, excerpt, draft: !publish, label }),
}

/**
 * Issue description MUST follow this exact template!
 * # title
 * > #category
 * excerpt
 * ---
 * anything here is the content for README.
 * h1 is not needed here as the title will be used here.
 */
export async function parseIssue(body: string) {
  const metadata: BlogInitOpts = {
    excerpt: '',
    title: '',
    draft: false,
    category: null,
  }

  const lines = body.trim().split(/\r?\n/)

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    else if (line === '---') {
      metadata.content = lines.slice(i+1).join('\n')
      break
    }

    switch (line[0]) {
      case '#': metadata.title = line.slice(2); break
      case '>':
        const s = line.slice(2)
        metadata.category = s[0] === '#' ? s.slice(1) : s
      break
      default: metadata.excerpt = line; break
    }
  }
  if (!metadata.title || !metadata.excerpt || !metadata.category) {
    die('refusing: reason: title, excerpt and category are must')
  }

  return await initContentImpl('blog', metadata)
}

async function loadblogs() {
  const glob = await readglob<BlogMetadata>(DIRS.BLOGS, 'metadata.json')
  return glob
    .map((it) => {
      const title = it.data.title.slice(0, 27) + '...'
      const dir = fjoin(DIRS.BLOGS, dirname(it.name))
      return {
        dir,
        title,
        draft: it.data.draft,
        at: +new Date(it.data.at),
      }
    })
    .sort((a, b) => b.at - a.at)
}

async function serve(port = 2026) {
  const rootHtml = Bun.file(fjoin(DIRS.BUILD, 'index.html'))
  if (! await rootHtml.exists()) {
    die(`${DIRS.BUILD}/ dir does not exist. need to build first.`)
  }

  const server = Bun.serve({ port,
    async fetch(req) {
      let { pathname } = new URL(req.url)
      if (pathname.endsWith('/')) {
        pathname = fjoin(pathname, 'index.html')
      }
      const file = Bun.file(fjoin(DIRS.BUILD, pathname))

      if (! await file.exists()) {
        console.error('404: %s', pathname)
        return new Response('Not Found', { status: 404 })
      }
      console.log('GET: %s', pathname)
      return new Response(file)
    }
  })
  console.log('server running at %s', server.url.origin)
}

if (import.meta.main) {
  const { values: flag } = parseArgs({
    args: Bun.argv,
    options: {
      list:   { type: 'boolean', short: 'l' },
      create: { type: 'string', short: 'c' }, // will impl later
      github: { type: 'boolean' },
      parse:  { type: 'string' },
      serve:  { type: 'boolean' },
      port:   { type: 'string', short: 'p' },
    },
    allowPositionals: true,
  })

  if (flag.list) {
    const blogs = await loadblogs()
    for (const blog of blogs) {
      console.log('%s %s  =>  %s', blog.draft ? '(draft)' : ' '.repeat(7), blog.title, blog.dir)
    }
  } else if (flag.github && flag.parse) {
    const res = await parseIssue(flag.parse)
    if (res) {
      console.log(`new blog added: ${res.dir} (${res.slug})`)
      if (flag.github && process.env.GITHUB_OUTPUT) {
        appendFileSync(
          process.env.GITHUB_OUTPUT,
          `title=${res.title}\nslug=${res.slug}\ndir=${res.dir}\nbranch_name=blog/${res.slug}\npr_title=New blog - ${res.title}\nissue_number=${process.env.ISSUE_NUMBER || ''}\n`
        )
      }
    }
  } else if (flag.serve) {
    const port = parseInt(flag.port ?? '2026')
    serve(port)
  }
}
