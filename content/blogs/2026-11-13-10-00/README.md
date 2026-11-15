# Caching and Indexing Mechanics in SQLite

SQLite is often described as a database in a single file. Queries do not scan the entire file sequentially on every execution. SQLite avoids unnecessary disk I/O through multiple mechanisms. It uses an internal page cache, operating system filesystem cache, write-ahead logging (WAL), and B-tree indexes.

Caching keeps recently accessed database pages in memory. Indexing locates specific pages directly.

This document describes page storage, caching layers, WAL concurrency, and index query planning in SQLite.

---

## 1. Page-Based Storage

SQLite stores data in fixed-size **pages**. A page is typically 4 KiB, though page size is configurable at database creation. Tables and indexes are B-trees composed of these pages.

Consider this query:

```sql
SELECT title, published_at
FROM articles
WHERE author_id = ?
ORDER BY published_at DESC
LIMIT 20;
```

SQLite reads B-tree pages rather than individual row objects. It reads pages to navigate to matching entries, and then reads pages containing the requested column values. Caching retains recently read pages in memory. Indexing minimizes the number of page reads required during navigation.

Queries returning few rows can still exhibit high latency if the engine must inspect many candidate pages.

---

## 2. The Two Cache Layers

SQLite queries interact with two independent caching layers:

### SQLite's Page Cache

Each SQLite database connection maintains a private page cache in process memory. The engine checks this cache before issuing read operations to the operating system. Cache hits avoid system calls and disk reads.

Cache capacity is configured per connection using `PRAGMA cache_size`:

```sql
-- A positive value sets the number of pages.
PRAGMA cache_size = 2000;

-- A negative value sets the approximate memory limit in KiB.
PRAGMA cache_size = -8192;
```

Connection caches are private by default. They are not shared across separate database connections. Opening new connections for short-lived tasks bypasses cached pages.

### The Operating System Filesystem Cache

The operating system caches file blocks in RAM. When SQLite requests a page recently read from disk, the operating system serves it directly from memory.

A process restart purges SQLite's connection cache while the operating system cache remains populated.

---

## 3. Write-Ahead Logging (WAL)

SQLite supports multiple journal modes. Write-ahead logging (WAL) alters concurrency behavior:

```sql
PRAGMA journal_mode = WAL;
```

In rollback-journal mode, writers block concurrent readers. In WAL mode, writers append modifications to a separate WAL file. Readers continue accessing an unmodified snapshot of the main database concurrently.

SQLite permits only one active writer at a time in WAL mode.

A **checkpoint** copies committed pages from the WAL file back into the primary database file. Long-running read transactions can delay checkpoint completion.

WAL lifecycle flow:

```text
reader begins → chooses a stable snapshot → reads database/WAL pages
writer begins → appends changed pages to WAL → commits
reader ends   → newer readers can see the new snapshot
checkpoint    → folds WAL pages back into the main database file
```

---

## 4. B-Tree Indexes

SQLite indexes use B-tree structures. Entries are stored in sorted order by indexed columns and point to associated table rows.

For the example query, a composite index covers the filter and ordering conditions:

```sql
CREATE INDEX articles_by_author_and_date
ON articles (author_id, published_at DESC);
```

The engine seeks directly to an `author_id`, reads entries in descending date order, and stops after 20 results. This avoids in-memory sorting.

### Multi-Column Index Ordering

Multi-column indexes match search filters from the leftmost column onward:

```sql
CREATE INDEX games_by_category_status_date
ON games (category_id, status, published_at DESC);
```

This index supports queries filtering by `category_id`, or by `category_id` and `status`. It does not support queries filtering only by `status`.

---

## 5. Covering Indexes

A covering index contains all columns requested by a query. SQLite resolves the query entirely from index pages without reading table rows:

```sql
CREATE INDEX articles_feed_covering
ON articles (author_id, published_at DESC, title);

SELECT title, published_at
FROM articles
WHERE author_id = ?
ORDER BY published_at DESC
LIMIT 20;
```

Covering indexes eliminate table page lookups for frequent read queries. However, indexes increase disk consumption, memory cache usage, and write overhead during inserts and updates.

---

## 6. The Query Planner

SQLite evaluates available indexes and cost estimates to select an execution plan. The `EXPLAIN QUERY PLAN` command outputs the chosen plan:

```sql
EXPLAIN QUERY PLAN
SELECT title, published_at
FROM articles
WHERE author_id = 42
ORDER BY published_at DESC
LIMIT 20;
```

Common plan indicators:

- `SEARCH ... USING INDEX`: An index lookup was selected.
- `USING COVERING INDEX`: All queried values exist in the index.
- `SCAN`: A full scan of the table or index. Full scans can be efficient for small tables.
- `USE TEMP B-TREE FOR ORDER BY`: SQLite sorts intermediate results because the index order does not match query ordering.

---

## 7. Statistics and Maintenance

The query planner uses table statistics to estimate row distributions. Inaccurate statistics can cause suboptimal index selection.

Updating table statistics:

```sql
ANALYZE;
```

---

## 8. Indexing Workflow

An indexing review follows these stages:

1. Record the complete query, including `WHERE`, `JOIN`, `ORDER BY`, and `LIMIT` clauses.
2. Inspect the execution plan with `EXPLAIN QUERY PLAN`.
3. Evaluate index selectivity. Indexes provide the largest performance gains when filtering out most rows.
4. Construct an index matching query predicates, placing equality filters before range or sorting columns.
5. Measure write overhead on batch inserts and updates.
6. Remove redundant indexes to control maintenance costs.

---

## 9. Performance Issues Outside the Database Engine

Query latency often originates outside SQLite:

- **N+1 Queries:** Fetching related records in sequential single-row queries multiplies round-trip overhead.
- **Long Transactions:** Unfinished transactions delay writes and checkpoints.
- **Unbounded Result Sets:** Queries returning thousands of rows create serialization and network latency.
- **Connection Churn:** Opening new connections repeatedly prevents page cache reuse.

---

## Summary

Caching reduces repeated page reads. Indexes minimize the number of pages required to locate matching rows. WAL mode allows concurrent readers during single-writer operations. `EXPLAIN QUERY PLAN` reveals the query planner's access paths.
