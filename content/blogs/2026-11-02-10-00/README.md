# Next.js Production Patterns: Streaming and Cache Architecture

Next.js App Router applications begin with a basic structure. A route folder contains a `page.tsx` file, which exports a React component. High-traffic production systems face strict latency and concurrency demands. Under load, simple application patterns can reveal hidden bottlenecks. Common issues include bloated client bundles from unexpected `"use client"` directives. Other issues include request waterfalls, cascading cache invalidations, and high memory usage.

This document describes production architectures and core Next.js techniques for scalable systems.

---

## 1. The Server-Client Component Boundary

A common misconception in Next.js App Router applications is treating `"use client"` as a tag for frontend components. In reality, `"use client"` marks an entry boundary for the client JavaScript bundle. All files and dependencies imported beneath that boundary ship to the browser.

### The Slot Pattern: Composition Over Bundling

Interactive dashboard layouts often require client-side state. Examples include an expandable sidebar or active navigation state. At the same time, the layout displays heavy data-driven widgets.

Importing server data widgets directly into a `"use client"` layout converts those widgets into client components. The browser bundle then inflates with all their dependencies:

```tsx
// ❌ ANTI-PATTERN: Forces all children and their imports into the client bundle
'use client'
import { HeavyAnalyticsChart } from '@/components/analytics'
import { UserProfileData } from '@/components/user-profile'

export function DashboardLayout() {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="layout">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      <main>
        <UserProfileData />
        <HeavyAnalyticsChart />
      </main>
    </div>
  )
}
```

Interactive components function more cleanly as shell containers. They accept `children` or explicit React slots (`ReactNode`). A Server Component then imports both pieces and handles composition:

```tsx
// ✅ PRODUCTION PATTERN: Client interactive shell
// components/dashboard-shell.tsx
'use client'

import { type ReactNode, useState } from 'react'

interface DashboardShellProps {
  children: ReactNode
  sidebarNav: ReactNode
}

export function DashboardShell({ children, sidebarNav }: DashboardShellProps) {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className={`dashboard-root ${isCollapsed ? 'collapsed' : ''}`}>
      <aside>
        <button onClick={() => setIsCollapsed((prev) => !prev)}>Toggle</button>
        {sidebarNav}
      </aside>
      <section className="main-content">{children}</section>
    </div>
  )
}
```

The server page coordinates this composition:

```tsx
import { HeavyAnalyticsChart } from '@/components/analytics'
// app/dashboard/page.tsx (Server Component)
import { DashboardShell } from '@/components/dashboard-shell'
import { NavigationLinks } from '@/components/nav-links'
import { UserProfileData } from '@/components/user-profile'

export default async function DashboardPage() {
  return (
    <DashboardShell sidebarNav={<NavigationLinks />}>
      <UserProfileData />
      <HeavyAnalyticsChart />
    </DashboardShell>
  )
}
```

System impact: `UserProfileData` and `HeavyAnalyticsChart` remain pure Server Components. Their code, database drivers, date libraries (`date-fns`), and parsing logic stay off the browser.

---

## 2. Granular Streaming and Request Waterfalls

Server-driven applications often encounter server-side request waterfalls:

```tsx
// ❌ SLOW: Blocks entire page response until both database calls finish
export default async function ProductPage({ params }: { params: { id: string } }) {
  const product = await getProduct(params.id) // 80ms
  const reviews = await getProductReviews(params.id) // 450ms (slow analytics query)

  return (
    <main>
      <ProductDetails product={product} />
      <ReviewsList reviews={reviews} />
    </main>
  )
}
```

In this pattern, the browser receives zero HTML bytes for over 530ms. The slowest query delays the entire HTTP response.

### Decoupling with Suspense and Micro-Boundaries

The page splits into independent stream units. The core layout and critical content render immediately. Slower auxiliary panels stream into placeholders as data resolves:

```tsx
// app/products/[id]/page.tsx
import { Suspense } from 'react'

import { ProductSkeleton, ReviewsSkeleton } from '@/components/skeletons'
import { getProduct, getProductReviews } from '@/lib/db'

export default async function ProductPage({ params }: { params: { id: string } }) {
  // Fast query starts immediately
  const productPromise = getProduct(params.id)

  return (
    <main className="product-container">
      <Suspense fallback={<ProductSkeleton />}>
        <ProductHero promise={productPromise} />
      </Suspense>

      <Suspense fallback={<ReviewsSkeleton />}>
        <ProductReviewsSection productId={params.id} />
      </Suspense>
    </main>
  )
}

async function ProductHero({ promise }: { promise: Promise<Product> }) {
  const product = await promise
  return (
    <section className="hero">
      <h1>{product.title}</h1>
      <p>{product.price}</p>
    </section>
  )
}

async function ProductReviewsSection({ productId }: { productId: string }) {
  const reviews = await getProductReviews(productId)
  return (
    <section className="reviews">
      <h3>Customer Reviews ({reviews.length})</h3>
      {reviews.map((r) => (
        <p key={r.id}>{r.comment}</p>
      ))}
    </section>
  )
}
```

### The Streaming Lifecycle

1. The server flushes document `<head>`, styles, and initial skeleton placeholders within 30ms.
2. At 80ms, `ProductHero` resolves and replaces its skeleton. The user sees interactive content.
3. The reviews stream arrives, populating the remaining slot through inline `<script>` tags injected by React.
4. Time to First Byte (TTFB) and First Contentful Paint (FCP) decrease significantly.

---

## 3. The Next.js Caching Architecture

Next.js uses multiple distinct cache layers. Confusing these layers causes stale data bugs and memory growth:

- **Request Memoization:** Deduplicates identical data requests within a single render cycle. It uses `React.cache()` or automatic `fetch` deduplication.
- **Data Cache:** Persists fetch results across requests and deployments. It uses `unstable_cache()` or `fetch(url, { next: { tags } })` until a TTL expires or tags are revalidated.
- **Full Route Cache:** Stores static HTML and RSC payloads on the server. Pre-rendered routes skip server execution entirely.
- **Router Cache:** Retains RSC payloads in browser session memory (30 seconds for dynamic routes, 5 minutes for static routes). This provides fast client navigations.

### Request Memoization with `React.cache`

When multiple components in a tree require the same session or configuration, prop drilling and shared context add overhead. `React.cache` memoizes the data accessor:

```tsx
import { headers } from 'next/headers'
import { cache } from 'react'

import { verifyAuthToken } from '@/lib/auth'

export const getCurrentUser = cache(async () => {
  const authHeader = (await headers()).get('authorization')
  if (!authHeader) return null
  return verifyAuthToken(authHeader)
})
```

If `Header`, `Sidebar`, and `PermissionGuard` all invoke `getCurrentUser()` during one render cycle, `verifyAuthToken` executes only once. When the request terminates, the memoized reference is garbage-collected.

### Multi-Tenant Tag Invalidation with `unstable_cache`

Raw ORM queries (Prisma, Drizzle, Kysely, or raw SQL) lack built-in `fetch` tags. The `unstable_cache` function applies cache keys and tags to database queries:

```tsx
import { unstable_cache } from 'next/cache'

import { db } from '@/lib/db'

export function getTenantSettings(tenantId: string) {
  return unstable_cache(
    async () => {
      return db.query.settings.findFirst({
        where: (s, { eq }) => eq(s.tenantId, tenantId),
      })
    },
    ['tenant-settings', tenantId], // Unique cache key
    {
      revalidate: 3600, // 1 hour fallback TTL
      tags: [`tenant:${tenantId}`, 'settings'],
    },
  )()
}
```

When an administrator updates settings, a Server Action or Route Handler initiates targeted cache revalidation:

```tsx
import { revalidateTag } from 'next/cache'

export async function updateSettingsAction(tenantId: string, payload: UpdateSettingsDto) {
  await db.update(settingsTable).set(payload).where(eq(settingsTable.tenantId, tenantId))

  // Surgical purge: Purges only this tenant's cache across edge instances
  revalidateTag(`tenant:${tenantId}`)
}
```

---

## 4. Route Interception and Parallel Routes

Parallel routes (`@slot`) and intercepting routes (`(..)photo`) support modal interfaces. They provide single-page application behaviors while preserving standard URL paths.

### Modal Navigation Behaviors

- **Page navigation:** The URL changes to `/photos/123`. An overlay modal opens over the active feed.
- **Hard refresh or direct link:** The full standalone `/photos/123` page loads with standard header, navigation, and footer.
- **Browser back button:** The modal closes. The feed restores its previous scroll position without a reload.

### Route Directory Structure

- `app/feed/page.tsx` — Photo feed list
- `app/feed/layout.tsx` — Feed layout containing the modal slot
- `app/feed/@modal/(..)photos/[id]/page.tsx` — Intercepted route for modal view
- `app/feed/@modal/default.tsx` — Fallback when no modal is active
- `app/photos/[id]/page.tsx` — Standalone full-page fallback for direct visits

Layout definition in `app/feed/layout.tsx`:

```tsx
export default function FeedLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  return (
    <div className="feed-container">
      {children}
      {modal}
    </div>
  )
}
```

Fallback definition in `app/feed/@modal/default.tsx`:

```tsx
export default function DefaultModal() {
  return null // Render nothing when route is not intercepted
}
```

Modal component in `app/feed/@modal/(..)photos/[id]/page.tsx`:

```tsx
import { PhotoView } from '@/components/photo-view'
import { Modal } from '@/components/ui/modal'

export default async function PhotoModal({ params }: { params: { id: string } }) {
  return (
    <Modal>
      <PhotoView photoId={params.id} />
    </Modal>
  )
}
```

When a user selects `<Link href={`/photos/${id}`}>`, Next.js intercepts the navigation. The router renders the modal slot inside `FeedLayout` and updates the browser address bar to `/photos/123`.

---

## 5. Streaming Route Handlers for Real-Time and AI Responses

Next.js Route Handlers (`app/api/.../route.ts`) stream chunked data over HTTP:

```typescript
// app/api/ai/stream/route.ts
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const { prompt } = await req.json()
  const encoder = new TextEncoder()

  const customStream = new ReadableStream({
    async start(controller) {
      try {
        const words =
          `Analysis for "${prompt}": Performance metrics optimal. System healthy.`.split(' ')
        for (const word of words) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text: word + ' ' })}\n\n`))
          await new Promise((r) => setTimeout(r, 60))
        }
        controller.close()
      } catch (err) {
        controller.error(err)
      }
    },
  })

  return new Response(customStream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
}
```

The browser reads the stream using standard `fetch` and `getReader()`:

```typescript
const response = await fetch('/api/ai/stream', {
  method: 'POST',
  body: JSON.stringify({ prompt: 'Auditing cluster' }),
})

const reader = response.body?.getReader()
const decoder = new TextDecoder()

while (reader) {
  const { done, value } = await reader.read()
  if (done) break
  console.log(decoder.decode(value))
}
```

---

## 6. Production Readiness Points

Production deployments rely on several system verification checks:

1. **Build Output Tracing:** Auditing `.next/standalone` verifies that container images contain only referenced dependencies.
2. **Dynamic Bailouts:** Unintended calls to `cookies()`, `headers()`, or `searchParams` break static route caching.
3. **Bundle Contamination:** Tools like `@next/bundle-analyzer` verify that server-only libraries (crypto, database clients, PDF generators) remain out of client bundles.
4. **Serverless Execution Limits:** Setting `export const maxDuration = 30` prevents unexpected proxy timeouts during long background operations.

The combination of the slot pattern, granular Suspense boundaries, targeted tag invalidation, and streaming Route Handlers supports high-throughput, low-latency applications.
