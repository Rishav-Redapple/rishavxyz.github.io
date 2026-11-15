# Lambda Calculus: Functional Principles and the Y Combinator

In the 1930s, mathematicians studied the formal definition of computable functions.

Alan Turing designed the **Turing Machine**. It is a theoretical device that manipulates symbols on an infinite strip of tape using states and transition rules. Alonzo Church designed **Lambda Calculus** (λ-calculus). It is a formal system based entirely on anonymous, single-argument functions.

Turing proved that both formal systems are mathematically equivalent. This result is known as the Church-Turing thesis. Any computation solvable by a Turing machine can also be computed in lambda calculus.

Turing machines provided the foundation for imperative hardware architectures (CPUs, registers, and memory loops). Lambda calculus provided the foundation for functional programming, type theory, and compiler intermediate representations.

This document describes lambda calculus syntax, reduction rules, Church encodings, and the **Y Combinator**. For a gentler, introductory overview of functions, composition, and recursion, see [Functional programming basics](/blogs/functional-programming-basics/).

---

## 1. Syntax Grammar

The syntax of untyped lambda calculus consists of three constructs:

- **Variable (`x`):** A reference to a parameter or value (JavaScript: `x`).
- **Abstraction (`λx. M`):** A function definition binding parameter `x` to body `M` (JavaScript: `(x) => M`).
- **Application (`M N`):** Applying function `M` to argument `N` (JavaScript: `M(N)`).

The language provides no built-in primitives. There are no integers, strings, booleans, loops, or arrays. All expressions evaluate as functions.

### Conventions and Currying

Parsing relies on two structural rules:

1. **Application is left-associative:** `f a b` means `(f a) b`. Function `f` evaluates with argument `a`, and the resulting function evaluates with argument `b`.
2. **Abstraction extends rightward:** `λx. x y` means `λx. (x y)`.

#### Multi-Argument Functions via Currying

In lambda calculus, every function accepts exactly one parameter. Functions accept multiple arguments by returning nested single-argument functions:

```text
λx. λy. x
```

JavaScript equivalent:

```javascript
const f = (x) => (y) => x
```

---

## 2. Reduction Rules

Evaluation in lambda calculus occurs through syntactic substitution rules:

### 1. α-conversion (Alpha Renaming)

Renaming bound parameters preserves function identity:

```text
λx. x ≡ λy. y ≡ λz. z
```

### 2. β-reduction (Function Evaluation)

Evaluating an abstraction replaces occurrences of the bound variable in the function body with the supplied argument:

```text
(λx. x) y   →   y
(λx. x x) a →   a a
```

### 3. η-reduction (Extensional Equality)

Two functions are considered identical if they return equal values on all arguments:

```text
λx. (f x) ≡ f
```

---

## 3. Church Encodings: Data from Functions

Alonzo Church demonstrated that data types and control flow can be constructed entirely from functions.

### Church Booleans

A boolean represents a selection between two branches. `TRUE` returns its first parameter. `FALSE` returns its second parameter:

```text
TRUE  = λt. λf. t
FALSE = λt. λf. f
```

JavaScript implementation:

```javascript
const TRUE = (t) => (f) => t
const FALSE = (t) => (f) => f
```

#### Conditional: `IF`

Under this definition, the boolean function acts as the branch selector:

```text
IF = λb. λthen. λelse. b then else
```

JavaScript implementation:

```javascript
const IF = (b) => (thenBranch) => (elseBranch) => b(thenBranch)(elseBranch)

// Test in JS:
const message = IF(TRUE)('Yes!')('No!')
console.log(message) // Outputs: "Yes!"
```

#### Boolean Operations: `NOT`, `AND`, `OR`

```javascript
// NOT flips TRUE to FALSE, and FALSE to TRUE
const NOT = (b) => b(FALSE)(TRUE)

// AND: If p is true, return q; if p is false, return p (which is FALSE)
const AND = (p) => (q) => p(q)(p)

// OR: If p is true, return p (which is TRUE); if p is false, return q
const OR = (p) => (q) => p(p)(q)
```

---

## 4. Church Numerals: Numbers as Repetition

Church numerals represent integers through repeated function application. A number `n` applies function `f` to argument `x` exactly `n` times:

```text
0 = λf. λx. x          (apply f zero times to x)
1 = λf. λx. f x        (apply f once)
2 = λf. λx. f (f x)    (apply f twice)
3 = λf. λx. f (f (f x))(apply f three times)
```

The definition of `0` matches the definition of `FALSE`.

```javascript
const ZERO = (f) => (x) => x
const ONE = (f) => (x) => f(x)
const TWO = (f) => (x) => f(f(x))
const THREE = (f) => (x) => f(f(f(x)))

// Helper to convert a Church numeral to a regular JS number
const toNumber = (churchNum) => churchNum((n) => n + 1)(0)

console.log(toNumber(THREE)) // 3
```

### Arithmetic Operations

#### Successor (`SUCC`): Add 1

The successor function adds 1 by applying `f` one additional time:

```text
SUCC = λn. λf. λx. f (n f x)
```

```javascript
const SUCC = (n) => (f) => (x) => f(n(f)(x))
console.log(toNumber(SUCC(TWO))) // 3
```

#### Addition (`PLUS`): `m + n`

Applies `f`, `n` times, and then applies `f` another `m` times:

```text
PLUS = λm. λn. λf. λx. m f (n f x)
```

```javascript
const PLUS = (m) => (n) => (f) => (x) => m(f)(n(f)(x))
const FOUR = PLUS(TWO)(TWO)
console.log(toNumber(FOUR)) // 4
```

#### Multiplication (`MULT`): `m × n`

Multiplication composes repeated applications:

```text
MULT = λm. λn. λf. m (n f)
```

```javascript
const MULT = (m) => (n) => (f) => m(n(f))
const SIX = MULT(TWO)(THREE)
console.log(toNumber(SIX)) // 6
```

---

## 5. Church Pairs (Tuples)

A pair bundles two values into a single function closure:

```text
PAIR   = λa. λb. λchoose. choose a b
FIRST  = λp. p TRUE
SECOND = λp. p FALSE
```

```javascript
const PAIR = (a) => (b) => (choose) => choose(a)(b)
const FIRST = (p) => p(TRUE)
const SECOND = (p) => p(FALSE)

const myPair = PAIR('Engine A')('Engine B')
console.log(FIRST(myPair)) // "Engine A"
console.log(SECOND(myPair)) // "Engine B"
```

Pairs and Church numerals support data structures like linked lists and binary trees.

---

## 6. Anonymous Recursion: The Y Combinator

Standard programming languages implement recursion using named function bindings:

```javascript
function factorial(n) {
  return n <= 1 ? 1 : n * factorial(n - 1)
}
```

The function `factorial` references its own name.

In pure lambda calculus, functions are anonymous. The system provides no names, variable assignment, or identifiers. Recursion requires self-reference without using a name.

### Step 1: Self-Application

Functions can take themselves as arguments:

```text
(λx. x x) (λx. x x)
```

This term is **Ω (Omega)**. Evaluating Ω expands infinitely into itself. This demonstrates that non-terminating loops exist in pure lambda calculus.

### Step 2: The Fixed-Point Combinator

A fixed-point combinator `Y` satisfies the equation:

```text
Y F = F (Y F)
```

When this property holds, `Y F` creates a fixed point. When `F` recurses, it receives another copy of itself wrapped inside `F`.

Haskell Curry identified the **Y Combinator**:

```text
Y = λf. (λx. f (x x)) (λx. f (x x))
```

### Step 3: The Z Combinator for Strict Evaluation

In strict (eager) languages like JavaScript, Python, or Go, evaluating the mathematical Y Combinator causes a call stack overflow. The runtime evaluates `(x x)` immediately before passing it to `f`.

Wrapping evaluation in an extra function (`λv. (x x) v`) delays execution. This variant is the **Z Combinator**:

```javascript
const Y = (f) => ((x) => f((v) => x(x)(v)))((x) => f((v) => x(x)(v)))
```

### Step 4: Anonymous Recursion in JavaScript

A factorial generator accepts a recursive step function instead of a global name:

```javascript
// Pure functional factorial with ZERO named self-references
const factorialGenerator = (recurse) => (n) => {
  return n <= 1 ? 1 : n * recurse(n - 1)
}

const factorial = Y(factorialGenerator)

console.log(factorial(5)) // 120
console.log(factorial(6)) // 720
```

The generator contains no self-referential name. The combinator manages recursion through function composition.

---

## 7. Systems Influence

Church's formal model influenced computer systems in several areas:

1. **Lisp and Scheme:** John McCarthy based Lisp on lambda calculus in 1958. This introduced anonymous functions (`lambda`) to practical programming.
2. **Functional Languages:** Haskell, OCaml, Elixir, and Scala descend from typed lambda calculi.
3. **JavaScript / TypeScript:** Arrow functions, closures, and methods like `map`, `filter`, and `reduce` reflect Church encodings.

All computation in this model reduces to functions evaluating arguments.
