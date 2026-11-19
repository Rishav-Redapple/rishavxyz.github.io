import { basename, dirname, join } from 'node:path'

export const fjoin = join
export { basename, dirname }

// --- Pure Monadic & Functional Utilities ---

export type Maybe<T>
  = { ok: true; value: T }
  | { ok: false }

export const Just = <T>(value: T): Maybe<T> => ({ ok: true, value }) as const
export const Nothing: Maybe<never> = { ok: false } as const
export const fromMaybe = <T>(def: T, m: Maybe<T>): T => (m.ok ? m.value : def)

export type Result<T, E = Error>
  = { ok: true; value: T }
  | { ok: false; err: E }

export type IOMaybe<T> = Promise<Maybe<T>>
export type IOResult<T, E = Error> = Promise<Result<T, E>>

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value }) as const
export const Err = <E>(err: E): Result<never, E> => ({ ok: false, err }) as const

export function partition<T, E>(results: Result<T, E>[]): [T[], E[]] {
  const oks: T[] = []
  const errs: E[] = []
  for (const result of results) {
    result.ok ? oks.push(result.value) : errs.push(result.err)
  }
  return [oks, errs] as const
}

export async function unwrap<T>(f: () => T | Promise<T>): Promise<Result<T, Error>> {
  try {
    const value = await f()
    return Ok(value)
  } catch (e) {
    return Err(e as Error)
  }
}

export function die(msg: string | Error): never {
  console.error(msg instanceof Error ? msg.message : msg)
  process.exit(1)
}

export function TODO(msg: string): never {
  throw Error(msg)
}

type CnArg<T extends string = string> =
  T | 0 | false | null | undefined | Partial<Record<string, unknown>> | CnArg<T>[]

export function cn<T extends string = string>(...args: CnArg<string>[]): T[] {
  const out: T[] = []
  for (const a of args) {
    if (!a) continue
    if (typeof a === 'string') out.push(a as T)
    else if (Array.isArray(a)) out.push(...cn<T>(...a))
    else for (const [k, v] of Object.entries(a)) if (v) out.push(k as T)
  }
  return out
}

export function pick<A, K extends keyof A>(a: A[], key: K): A[K][]
export function pick<A, K extends keyof A>(a: A[], ...keys: K[]): Pick<A, K>[]
export function pick<A, K extends keyof A>(a: A[], ...keys: K[]) {
  if (keys.length < 2) return a.map((it) => it[keys[0]!])
  return a.map((it) => Object.fromEntries(keys.map((key) => [key, it[key]])))
}

export const esc = Bun.escapeHTML

export function hash(content: string | Uint8Array) {
  return Bun.hash.xxHash3(content).toString(36)
}

const SYMBOLS: Record<string, string> = {
  '&': 'and',
  '#': 'number',
  '@': 'at',
  '+': 'plus',
  '%': 'percent',
  $: 'dollar',
  '€': 'euro',
  '£': 'pound',
  '¥': 'yen',
  '©': 'copyright',
  '®': 'registered',
  '™': 'trademark',
}

export function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[&#@+%$€£¥©®™]/g, (c: string) => ` ${SYMBOLS[c]} `)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function tsnow() {
  const pad = (n: number) => String(n).padStart(2, '0')
  const d = new Date()
  const code = [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]
    .map(pad)
    .join('-')

  return { id: code, z: d.toISOString() }
}

export function fdate(at: string) {
  return new Date(at).toLocaleDateString('en-us', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function genCC(label = 'Rishav Mandal. All rights reserved.') {
  const year = new Date().getFullYear()
  return `&copy; ${year} — ${label}`
}

export function md2html(md: string, options?: Bun.markdown.Options): string {
  const html = Bun.markdown.html(md, {
    latexMath: options?.latexMath ?? true,
    ...options,
  })
  return html
}

/**
 * html post process using Bun's HTML Rewriter
 */
type HR = HTMLRewriter['on']
export type HTMLRewriterHandler = Record<Parameters<HR>[0], Parameters<HR>[1]>
export function htmlpp(html: string, ...on: HTMLRewriterHandler[]) {
  const rewriter = new HTMLRewriter()

    .on('a[href^="http"]', {
      element(el) {
        el.setAttribute('target', '_blank')
        el.setAttribute('rel', 'noopener noreferrer')
      },
    })

    .on('table', {
      element(el) {
        el.before('<div class="overflow-auto">', { html: true })
        el.after('</div>', { html: true })
      },
    })

    .on('section.blog img', {
      element(img) {
        img.setAttribute('loading', 'lazy')
        img.setAttribute('decoding', 'async')
        img.before('<figure>', { html: true })
        img.after('</figure>', { html: true })
      },
    })

  for (const handler of on) {
    for (const selector in handler) {
      rewriter.on(selector, handler[selector]!)
    }
  }

  return rewriter.transform(html)
}

export function ishome(a: { slug?: string; label?: string } | string) {
  if (typeof a === 'string') return a === '/' || a === 'home' || a === 'index'
  return a.slug === '/' || a.slug === 'home' || a.label === 'home' || a.label === 'index'
}

// --- File Cons & Pure Async I/O Utilities ---

export type FileCons = { name: string } & (
  | { type: 'text'; data: string }
  | { type: 'json'; data: unknown }
  | { type: 'bin'; data: Uint8Array }
)

export async function write(fc: FileCons): IOResult<number> {
  try {
    const data = fc.type === 'json'
      ? JSON.stringify(fc.data, null, 2)!
      : fc.data

    const bytes = await Bun.write(fc.name, data)
    return Ok(bytes)
  } catch (e) {
    return Err(e as Error)
  }
}

export async function copy(src: string, dest: string): IOResult<number> {
  try {
    const bytes = await Bun.write(dest, Bun.file(src))
    return Ok(bytes)
  } catch (e) {
    return Err(e as Error)
  }
}

export function read(path: string, type: 'text'): IOResult<string>
export function read(path: string, type: 'bin'): IOResult<Uint8Array>
export function read<T>(path: string, type: 'json'): IOResult<T>
export async function read(path: string, type: string) {
  try {
    const file = Bun.file(path)

    if (type === 'text' || type === 'json') {
      const data = await file.text()
      if (type === 'text') return Ok(data)
      return Ok(Bun.JSON5.parse(data))
    }
    return Ok(await file.bytes())
  } catch (e) {
    return Err(e as Error)
  }
}

export async function exists(path: string): Promise<boolean> {
  return await Bun.file(path).exists()
}

export type ScannedFile<T = unknown> = {
  name: string
  data: T
}

export async function readglob<T = string>(dir: string, pattern: string): Promise<ScannedFile<T>[]> {
  const glob = new Bun.Glob(fjoin('**', pattern))
  const data: ScannedFile<T>[] = []

  for await (const filepath of glob.scan(dir)) {
    const file = Bun.file(fjoin(dir, filepath))
    if (!(await file.exists())) continue
    const name = filepath
    const type = file.type

    const content = (
      type.startsWith('application/json')
        ? await file.json()
        : type.startsWith('text/')
          ? await file.text()
          : await file.bytes()
    ) as T
    data.push({ name, data: content })
  }

  return data
}

// --- Templating ---

export type MakePhldr<K extends string> = {
  [placeholder in `%%${K}%%`]: string
}
export type TemplPhldr = MakePhldr<string>
export type EmptyCardPhldr = MakePhldr<'title' | 'description'>
export type BlogCardPhldr = MakePhldr<
  'route' | 'title' | 'datetime' | 'date' | 'excerpt' | 'category'
>
export type PagePhldr = MakePhldr<'sitename' | 'css' | 'seo' | 'navlinks' | 'content' | 'copyright'>

export async function genTempl(
  templname: string,
  placeholder: TemplPhldr,
  templDir = 'template',
): IOResult<string> {
  const templPath = fjoin(templDir, templname)
  const res = await read(templPath, 'text')
  if (!res.ok) return res

  const rendered = Object.entries(placeholder).reduce(
    (s, [key, val]) => s.replaceAll(key, val),
    res.value,
  )
  return Ok(rendered)
}

export const genHtmlPage = (p: PagePhldr) => genTempl('page.html', p)
export const genBlogCard = (p: BlogCardPhldr) => genTempl('blog-card.html', p)
export const genEmptyCard = (p: EmptyCardPhldr) => genTempl('empty-card.html', p)
