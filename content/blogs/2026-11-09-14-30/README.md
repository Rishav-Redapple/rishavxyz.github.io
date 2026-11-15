# V8 Execution Pipeline: How JavaScript Warms Up

JavaScript is frequently described as an interpreted language. In the V8 engine (used by Chrome and Node.js), execution begins with interpretation. The engine then monitors runtime behavior, collects execution profiles, and compiles predictable hot code into optimized machine code.

Code executed once and code executed repeatedly receive different treatment. V8 observes execution patterns and targets optimization at frequently executed paths.

This document describes the compilation pipeline, inline caching, tier progression, and deoptimization in V8.

---

## 1. Bytecode Generation and Ignition

When V8 parses JavaScript source code, it generates an Abstract Syntax Tree (AST). The **Ignition** interpreter executes this program representation as compact **bytecode**:

```js
function addTax(price) {
  return price * 1.2
}
```

Bytecode begins executing with minimal startup latency. Rapid startup aids initial page loads and CLI tools. Compiling every function into optimized machine code immediately would spend CPU cycles on rarely executed code.

During bytecode execution, Ignition collects runtime feedback. The engine records types passed to parameters, property access patterns, and invocation counts.

---

## 2. Shapes (Hidden Classes) and Inline Caches

JavaScript objects support dynamic property insertion. A standard dictionary lookup on every property access (`user.name`) creates execution overhead. V8 avoids dictionary lookups using internal structures called **hidden classes** or **maps**.

Objects with properties created in the same sequence share an identical shape:

```js
function makeUser(name, age) {
  return { name, age }
}

const a = makeUser('Asha', 28)
const b = makeUser('Noah', 31)
```

When a property access site repeatedly receives objects with identical shapes, V8 records the memory offset. This recorded access path is an **inline cache**. It bypasses dynamic property lookups.

Adding properties in inconsistent sequences generates distinct shapes:

```js
// These may end up with different shapes.
const first = { name: 'Asha' }
first.age = 28

const second = { age: 31, name: 'Noah' }
```

Call sites that encounter multiple unrelated shapes become **megamorphic**. In these scenarios, V8 falls back to generic property lookups.

---

## 3. Tiered Execution

V8 uses multiple compilation tiers:

1. **Ignition:** Executes bytecode quickly and gathers profiling feedback.
2. **Sparkplug:** Converts bytecode directly into machine code with minimal compilation time.
3. **TurboFan:** Produces deeply optimized machine instructions for code identified as hot and stable.

Optimized tiers rely on runtime assumptions. Examples include consistent numeric types or predictable object shapes. The compiler generates specialized fast paths alongside guard checks that verify those assumptions during execution.

---

## 4. Deoptimization

When runtime assumptions fail, V8 invalidates optimized code.

```js
function discount(value) {
  return value * 0.9
}

for (let i = 0; i < 100_000; i++) discount(i)
discount('sale')
```

The final invocation with a string argument violates previous type feedback. V8 triggers a **deoptimization**. Execution drops back to an unoptimized tier to handle the argument safely.

Deoptimization is a standard recovery mechanism. Performance problems occur when a hot execution path continuously alternates between optimization and deoptimization.

---

## 5. Performance Characteristics

Runtime analysis identifies several factors affecting V8 performance:

- Functions with stable parameter types optimize more predictably than functions handling varied types.
- Objects initialized with consistent property orders reuse hidden classes.
- Allocating temporary objects inside tight loops increases garbage collection overhead.
- Profiling tools determine whether latency stems from JavaScript execution, garbage collection, JSON parsing, layout rendering, or network I/O.

V8 starts execution conservatively, records runtime observations, and applies machine-code optimizations to stable hot paths.
