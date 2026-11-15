# B-Tree vs B+ Tree: Index Structures and Range Queries

Database indexes use tree structures to organize sorted records.

B-trees and B+ trees maintain sorted data in wide, balanced trees designed for page-based storage. A traditional B-tree stores data records in both internal nodes and leaf nodes. A B+ tree stores records exclusively in leaf nodes, while internal nodes act as a compact search directory. This leaf-oriented design supports sequential range scans.

[A previous article](/blogs/how-caching-and-indexing-work-in-sqlite/) introduced B-trees in SQLite. This document compares B-trees and B+ trees, their internal layout, and their performance in point lookups and range scans.

---

## 1. Node Structure and Fan-Out

A binary search tree restricts each node to two child pointers. This structure produces deep trees when storing millions of rows. Deep trees require numerous disk page reads to navigate down to a target record.

A B-tree uses wide nodes. A single node stores many sorted keys and child pointers:

```text
          [ 20 | 45 | 80 ]
         /     |     |     \
   <20      20–44  45–79   ≥80
```

To locate key `57`, the engine compares the key against values in the current node, selects the `45–79` child pointer, and repeats. Because each node corresponds to a storage page and references many children, tree depth remains shallow. A few page reads navigate large indexes.

Two rules preserve tree balance:

1. Keys within each node remain sorted.
2. All leaf nodes stay at the same depth.

Full nodes split during insertions. Sparse nodes merge during deletions. These operations ensure logarithmic lookup times.

---

## 2. Standard B-Trees

In a standard B-tree, internal nodes store keys alongside their associated records:

```text
                 [ 40: "Mina" ]
                 /              \
      [ 10: "Ana", 25: "Bo" ]  [ 55: "Omar", 70: "Rae" ]
```

A lookup can terminate at any level: root, internal node, or leaf.

This design introduces architectural trade-offs:

- Storing data records inside internal nodes leaves less space for child pointers. This reduces node fan-out and increases total tree depth.
- Range scans require traversing parent and child subtrees to collect contiguous values, adding navigation steps across levels.

---

## 3. B+ Trees

A B+ tree separates routing keys from stored data. Internal nodes contain only separator keys and child pointers. All indexed data records live in leaf nodes:

```text
                    [ 30 | 60 ]
                  /      |      \
                /        |        \
      [ 5 | 12 | 22 ] [ 30 | 41 | 57 ] [ 60 | 73 | 91 ]
             ↔──────────────↔──────────────↔
                 linked leaf pages, in key order
```

Internal nodes act strictly as a navigation directory. Because directory nodes are compact, each page holds more child pointers. Higher fan-out reduces tree height.

Leaf nodes are ordered and frequently linked sequentially. A range scan proceeds in sequence:

1. Traverse from the root down to the first matching leaf node.
2. Read entries sequentially within the leaf page.
3. Follow the pointer to the next adjacent leaf page.
4. Stop when the upper range limit or `LIMIT` clause is reached.

Example range query:

```sql
SELECT id, title, published_at
FROM articles
WHERE published_at >= '2026-01-01'
  AND published_at < '2027-01-01'
ORDER BY published_at
LIMIT 50;
```

With an index on `published_at`, the engine locates the first record and scans sequentially through adjacent leaf pages. The database avoids individual lookups and subsequent sorting passes.

---

## 4. Architecture Comparison

| Property               | B-tree                                            | B+ tree                                            |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------- |
| Where records may live | Internal nodes and leaves                         | Leaves only                                        |
| Internal-node contents | Keys, child pointers, sometimes records           | Separator keys and child pointers                  |
| Search result          | May finish before reaching a leaf                 | Reaches a leaf                                     |
| Fan-out                | Potentially lower if records are large            | Usually higher because directory entries are small |
| Range scan             | Requires tree navigation between records/subtrees | Natural sequential scan across ordered leaves      |
| Typical use            | General balanced search tree                      | Database and storage-engine indexes                |

Database engines modify these structures to support page layouts, duplicate keys, concurrency controls, and crash recovery.

---

## 5. Page-Based Storage Advantages

Database systems read and write storage in fixed-size pages. Reading a page loads multiple contiguous keys into memory simultaneously. Compact root and internal directory pages remain resident in the page cache.

In large indexes, the root and upper levels remain cached. A lookup requires few disk reads to reach the target leaf page. Range queries then read adjacent leaf pages in key order, maximizing cache efficiency.

Composite indexes support sorting alongside filtering:

```sql
CREATE INDEX articles_by_author_and_date
ON articles (author_id, published_at DESC);
```

Entries for each `author_id` are grouped contiguously in descending date order. The engine seeks to the author record and reads forward. The sort order exists within the physical structure of the index tree.

---

## 6. SQLite Tree Structure

SQLite names its storage and indexing structures **B-trees**.

SQLite implements properties similar to B+ trees:

- Table records reside on leaf pages; interior table pages route queries using integer keys and child pointers.
- Index entries reside on leaf pages; interior index pages route searches to target leaf ranges.
- Internal pages manage navigation, while leaf pages hold query data.

SQLite's format differs from textbook B+ trees.

---

## 7. Equality Lookups and Range Scans

Equality Lookup:

```sql
SELECT *
FROM users
WHERE email = ?;
```

The engine traverses from the root through internal nodes to the target leaf. Both B-trees and B+ trees handle equality lookups efficiently.

Range Lookup:

```sql
SELECT *
FROM events
WHERE occurred_at >= ?
  AND occurred_at < ?
ORDER BY occurred_at;
```

A range query finds the initial record and traverses subsequent entries. Ordered leaf levels enable sequential traversal without repeated root-to-leaf searches.

---

## 8. Index Design Considerations

Index structures influence query execution patterns:

- Placing high-cardinality equality filter columns first in composite indexes isolates candidate rows early.
- Adding range or `ORDER BY` columns after equality columns matches the physical sort order of the tree.
- Using `LIMIT` terminates ordered scans once the requested count is satisfied.
- Covering indexes eliminate table page lookups at the expense of higher write and storage costs.
- `EXPLAIN QUERY PLAN` confirms whether the query planner uses an index for a specific query.

---

## Summary

A B-tree is a balanced, multi-way search tree designed for page-based storage. A B+ tree isolates directory keys in internal nodes and stores data in ordered leaf pages. This separation supports sequential page reads for range queries.
