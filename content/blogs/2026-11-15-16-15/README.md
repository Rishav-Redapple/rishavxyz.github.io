# Functional programming basics

Functional programming (FP) is a style of building software by composing pure functions. Anyone who understands how to write a basic function in TypeScript or JavaScript can learn the core ideas of functional programming.

This post is specifically written to simplify the concepts covered in the [Lambda Calculus](/blogs/lambda-calculus-for-working-programmers/) post. It provides a beginner-friendly foundation for those theoretical ideas.

This document introduces functional programming from fundamental principles. It covers variables and functions, first-class values, pure functions, function application, composition, reduction, and recursion. Examples are shown using both Haskell syntax and TypeScript.

---

## 1. Variables and Functions: Data vs Procedures

Traditional imperative programming separates programs into two distinct categories:

1. **Variables (Data):** Values stored in memory, such as numbers, strings, and objects.
2. **Functions (Procedures):** Blocks of code containing sequential steps that manipulate data or mutate state.

In TypeScript, this division is familiar:

```typescript
// Data (variable)
const score: number = 10

// Procedure (function)
function addBonus(x: number): number {
  return x + 5
}
```

In Haskell, the same relationship is expressed with concise syntax:

```haskell
-- Data (value)
score :: Int
score = 10

-- Function (mapping from Int to Int)
addBonus :: Int -> Int
addBonus x = x + 5
```

The type annotation `addBonus :: Int -> Int` states that `addBonus` takes an `Int` and produces an `Int`. In imperative code, procedures often modify outside variables. In functional programming, functions act as mathematical mappings: they transform input data into output data without modifying the input.

---

## 2. Treating Functions as Variables (First-Class Functions)

Functional programming removes the rigid wall between data and procedures. In FP, **functions are first-class values**.

This means a function can be:
- Assigned to a variable.
- Passed as an argument to another function.
- Returned from a function as a result.
- Stored inside data structures like arrays or objects.

Functions that accept other functions as arguments, or return functions, are called **higher-order functions**.

### Higher-Order Functions in TypeScript

```typescript
// A function assigned to a variable
const double = (x: number): number => x * 2

// A function that receives another function as an argument
function applyTwice(fn: (n: number) => number, value: number): number {
  return fn(fn(value))
}

const result = applyTwice(double, 5) // 20
```

### Higher-Order Functions in Haskell

```haskell
double :: Int -> Int
double x = x * 2

-- Takes a function (Int -> Int), an Int, and returns an Int
applyTwice :: (Int -> Int) -> Int -> Int
applyTwice fn value = fn (fn value)

-- applyTwice double 5 evaluates to 20
```

Because functions are values, programs can pass behavior around just like numbers or strings.

---

## 3. Writing a 100% Functional Function

What makes a function functional? A purely functional function is a **pure function**.

A pure function follows two rules:
1. **Deterministic:** Given the same arguments, it always returns the exact same result.
2. **No Side Effects:** It does not mutate external state, modify its input arguments, or perform hidden I/O operations.

### The Anti-Pattern: Impure Functions

The following TypeScript example violates purity:

```typescript
// ❌ IMPURE: Relies on and mutates external state
let total = 0

function addToTotal(amount: number): number {
  total += amount // Side effect: mutates outer variable
  return total
}
```

Calling `addToTotal(5)` produces different results depending on how many times it runs. It depends on time and mutable state.

### The Pure Function

A pure version takes all required data through its parameters and returns a new value:

```typescript
// ✅ 100% FUNCTIONAL: Pure, self-contained, and deterministic
function add(a: number, b: number): number {
  return a + b
}
```

In Haskell, all functions are pure by default. Functions cannot mutate variables:

```haskell
add :: Int -> Int -> Int
add a b = a + b
```

Pure functions depend only on their arguments. They create no external modifications.

---

## 4. Function Application, Removing Parentheses, and Composition

### Function Application (Applicative Syntax)

Applying a function means providing arguments to compute its result.

In TypeScript, function application requires parentheses:

```typescript
add(2, 3)
```

In Haskell, function application uses whitespace instead of parentheses:

```haskell
add 2 3
```

Function application has higher precedence than operators. `f x + 1` means `(f x) + 1`.

### Getting Rid of Parentheses: Currying and `$`

In Haskell, all functions are curried automatically. A function with multiple parameters is treated as a chain of single-argument functions:

```haskell
-- add 2 3 is internally evaluated as:
(add 2) 3
```

Applying one argument creates a specialized function. This is **partial application**:

```haskell
addFive :: Int -> Int
addFive = add 5

-- addFive 10 evaluates to 15
```

In TypeScript, currying is written using nested arrow functions:

```typescript
const curriedAdd = (a: number) => (b: number): number => a + b
const addFive = curriedAdd(5)

addFive(10) // 15
```

When expressions nest deeply, parentheses multiply: `f (g (h x))`.

Haskell provides the application operator `$` to remove parentheses. The `$` operator has low precedence:

```haskell
-- These two expressions are identical:
f (g (h x))
f $ g $ h x
```

### Function Composition (`.`)

Function composition combines two functions into a new function. Applying `(f . g)(x)` computes `f(g(x))`. The output of `g` becomes the direct input to `f`.

In Haskell, composition uses the dot operator (`.`):

```haskell
increment :: Int -> Int
increment x = x + 1

double :: Int -> Int
double x = x * 2

-- Composed function: increment first, then double
doubleThenIncrement :: Int -> Int
doubleThenIncrement = double . increment

-- doubleThenIncrement 3 evaluates to double (increment 3) = 8
```

In TypeScript, function composition is defined as a reusable utility:

```typescript
const compose = <A, B, C>(f: (b: B) => C, g: (a: A) => B) => (x: A): C => f(g(x))

const increment = (x: number): number => x + 1
const double = (x: number): number => x * 2

const doubleThenIncrement = compose(double, increment)
doubleThenIncrement(3) // 8
```

Composition allows developers to construct complex logic by linking small, single-purpose functions together.

---

## 5. Usefulness: Controlling Complexity

Software complexity often grows from shared mutable state. When multiple procedures read and modify the same global variables or object fields, tracking execution bugs requires tracing entire program timelines.

Pure functions eliminate temporal coupling. Because pure functions have no side effects, their behavior is independent of when or where they execute.

Core benefits of this model:

1. **Predictability:** The output depends solely on inputs. Testing requires passing sample inputs and asserting outputs without mocking dependencies.
2. **Referential Transparency:** A function call can be replaced with its return value without altering program behavior.
3. **Modularity:** Small functions with single responsibilities compose easily into larger pipelines.
4. **Concurrency Safety:** Functions that do not mutate shared memory cannot cause race conditions.

---

## 6. Practical Examples: Reduction and Recursion

### Concept 1: Reduction (Expression Evaluation and Folding)

**Reduction** is the process of evaluating an expression by substituting sub-expressions with simpler forms until reaching a final irreducible value.

Consider reducing `doubleThenIncrement 3`:

```text
doubleThenIncrement 3
  → (double . increment) 3
  → double (increment 3)
  → double (3 + 1)
  → double 4
  → 4 * 2
  → 8
```

Each step replaces an expression with its evaluated equivalent.

In data processing, reduction folds a list of values into a single summary value.

In TypeScript, reduction uses the `reduce` array method:

```typescript
const numbers = [1, 2, 3, 4]
const sum = numbers.reduce((accumulator, item) => accumulator + item, 0) // 10
```

In Haskell, reduction uses `foldl` (left fold):

```haskell
numbers = [1, 2, 3, 4]
sumResult = foldl (+) 0 numbers -- 10
```

### Concept 2: Recursion Replacing Loops

Pure functional languages do not use imperative `for` or `while` loops. Loops require a mutable counter or accumulator variable that changes on each iteration.

Functional programming replaces loops with **recursion**. A function calls itself with updated parameters until reaching a base case.

#### Example: Calculating the Sum of a List

Imperative approach with mutable state (TypeScript):

```typescript
function sumImperative(list: number[]): number {
  let total = 0
  for (const n of list) {
    total += n // Mutable state updated in each iteration
  }
  return total
}
```

Functional approach with recursion (Haskell):

```haskell
sumList :: [Int] -> Int
sumList []     = 0           -- Base case: empty list sums to 0
sumList (x:xs) = x + sumList xs -- Recursive case: head + sum of tail
```

Functional approach with recursion (TypeScript):

```typescript
function sumList([head, ...tail]: number[]): number {
  if (head === undefined) return 0 // Base case
  return head + sumList(tail)      // Recursive step
}

sumList([1, 2, 3, 4]) // 10
```

#### Reduction Trace of the Recursive Function

Tracing how `sumList [1, 2, 3]` reduces step by step:

```text
sumList [1, 2, 3]
  → 1 + sumList [2, 3]
  → 1 + (2 + sumList [3])
  → 1 + (2 + (3 + sumList []))
  → 1 + (2 + (3 + 0))
  → 1 + (2 + 3)
  → 1 + 5
  → 6
```

Each recursive call reduces the list size until it hits the base case. The accumulated additions then collapse into the final integer.

### Concept 3: An End-to-End Functional Pipeline

Processing a list of user transactions demonstrates composition, mapping, and reduction working together. The task:
1. Filter out negative values.
2. Add a 10% tax to each amount.
3. Sum the final total.

TypeScript pipeline:

```typescript
const transactions = [100, -20, 50, -10]

const total = transactions
  .filter((amount) => amount > 0)
  .map((amount) => amount * 1.1)
  .reduce((acc, amount) => acc + amount, 0)

console.log(total) // 165
```

Haskell equivalent using function composition and `$`:

```haskell
transactions :: [Double]
transactions = [100, -20, 50, -10]

calculateTotal :: [Double] -> Double
calculateTotal = sum . map (* 1.1) . filter (> 0)

total :: Double
total = calculateTotal transactions -- 165.0
```

The data flows through a pipeline of small, pure operations. Neither example modifies the original array.

---

## 7. Summary

- **Variables and Functions:** Variables represent immutable data values. Functions represent pure transformations mapping inputs to outputs.
- **First-Class Functions:** Functions can be stored in variables, passed to other functions, and returned from functions.
- **Pure Functions:** Functions produce deterministic output and execute without side effects.
- **Function Application:** In Haskell, functions apply with whitespace (`f x`). Currying allows partial application of arguments.
- **Function Composition (`.`):** Combines two functions into one pipeline (`f . g`), passing results directly from one transformation to the next.
- **Reduction:** Evaluates expressions by step-by-step substitution, including folding lists into single values.
- **Recursion:** Replaces stateful loops with pure self-referential function calls terminating at explicit base cases.

---

## 8. Conclusion

Functional programming is not an all-or-nothing paradigm. Developers do not need to rewrite entire systems in Haskell to benefit from functional principles.

Adopting pure functions, avoiding shared mutable state, composing small utilities, and using recursive or declarative list transformations improves software quality. Code becomes easier to test, simpler to understand, and less prone to regression bugs.
