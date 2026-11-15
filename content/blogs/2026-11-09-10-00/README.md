# Hono RPC: Type Sharing for TypeScript APIs

TypeScript applications frequently duplicate API type definitions. Developers describe endpoints on the server. They write matching types again on the client. Over time, these independent definitions often diverge.

Hono RPC provides a mechanism for sharing types. A frontend client infers request and response structures directly from backend Hono route definitions. The underlying protocol remains standard HTTP with standard URLs, status codes, and headers.

This document describes route type exports, client generation, boundary validation, and architectural limits.

---

## 1. Exporting Route Types

Application routes are defined on an application instance, and its TypeScript type is exported:

```ts
// server/app.ts
import { Hono } from 'hono'

type Todo = {
  id: string
  title: string
  done: boolean
}

const todos: Todo[] = []

const app = new Hono()
  .get('/todos', (c) => c.json({ todos }))
  .post('/todos', async (c) => {
    const body = await c.req.json<{ title?: string }>()
    const title = body.title?.trim()

    if (!title) {
      return c.json({ error: 'A title is required' }, 400 as const)
    }

    const todo = { id: crypto.randomUUID(), title, done: false }
    todos.push(todo)
    return c.json({ todo }, 201 as const)
  })

export type AppType = typeof app
export default app
```

The exported `AppType` captures chained route definitions. It includes paths, HTTP verbs, payload shapes, and expected responses.

The `400 as const` cast preserves the exact status code number in the inferred type. This enables TypeScript to distinguish success payloads from error responses during type narrowing.

---

## 2. Generating the Client

On the frontend, Hono’s `hc` function converts the exported type into an API client:

```ts
// web/api.ts
import { hc } from 'hono/client'

import type { AppType } from '../server/app'

export const api = hc<AppType>('/api')
```

Client calls use nested object properties corresponding to route paths:

```ts
const response = await api.todos.$post({
  json: { title: 'Buy coriander' },
})

if (!response.ok) {
  const { error } = await response.json()
  throw new Error(error)
}

const { todo } = await response.json()
console.log(todo.id)
```

The request issues a standard `POST /api/todos` call.

---

## 3. Boundary Validation

Static TypeScript types exist only at compile time. Static inference does not reject invalid payloads sent by external HTTP clients or scripts.

Runtime validation executes at the HTTP boundary. Hono’s validator middleware checks incoming payloads and drives TypeScript type inference:

```ts
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'

const createTodo = z.object({
  title: z.string().trim().min(1).max(160),
})

const app = new Hono().post('/todos', zValidator('json', createTodo), (c) => {
  const { title } = c.req.valid('json')
  const todo = { id: crypto.randomUUID(), title, done: false }
  return c.json({ todo }, 201 as const)
})
```

Invalid payloads receive standard HTTP error responses. Inside the route handler, `title` is guaranteed to be a validated string.

---

## 4. Architectural Boundaries

Hono RPC works best in environments where client and server share TypeScript types, such as monorepos.

Operating characteristics of this setup:

- Types are exported from the fully mounted application instance rather than sub-routers.
- Base URLs (`/api` or `https://api.example.com`) remain runtime configuration options rather than type constraints.
- Response handling checks `response.ok` or status codes before reading success payloads.
- HTTP routing, databases, and authentication require separate integration testing beyond compiler checks.

---

## 5. System Suitability

Hono RPC is suitable for systems with unified TypeScript backends and frontends. It reduces manual type synchronization when APIs change.

Public APIs and multi-language architectures often use OpenAPI or schema-first specifications instead.

Hono RPC establishes server route definitions as the single source of truth for client type inference.
