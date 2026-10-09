# Tables

Get a table with `vortex.table("mods")`, `"downloads"`, `"plugins"`, or `"load-order"`. Actions open the page, check starting state, operate the UI, verify the effect and record timing. Do not wrap them in `measure()`.

Mods and Downloads support generated data. Plugins and Load Order need real game data and [game-specific controls](../testing/table-fixtures.md#t2-install-real-data-before-testing-game-tables).

## open and rows

<!-- contract:benchmarks.tables:BenchmarkTable.open -->

```typescript
open(): Promise<void>;
```

<!-- /contract -->

<!-- contract:benchmarks.tables:BenchmarkTable.rows -->

```typescript
rows(): Promise<string[]>;
```

<!-- /contract -->

`open()` requires a uniquely visible table with at least two populated rows on first use. `rows()` returns attached matching rows' text in DOM order. Virtualized off-screen rows can be blank; this is not a complete sorted inventory.

## scroll

<!-- contract:benchmarks.tables:BenchmarkTable.scroll -->

```typescript
scroll(options: { ticks?: number; delta?: number; name?: string } = {}): Promise<void>;
```

<!-- /contract -->

Uses wheel input and checks viewport movement and visible cells. A non-scrollable fixture is blocked.

## search

<!-- contract:benchmarks.tables:BenchmarkTable.search -->

```typescript
search(options: InputOptions | string): Promise<void>;
```

<!-- /contract -->

Pass a string for the default input or an explicit action. Search must change matching rows. Clear an active search with `search("")`.

## filter

<!-- contract:benchmarks.tables:BenchmarkTable.filter -->

```typescript
filter(options: InputOptions | string): Promise<void>;
```

<!-- /contract -->

Mods shorthand supports `"enabled"`, `"disabled"`, and `"all"`. Prepare both enabled and disabled mods. Custom and Downloads controls use [explicit actions](#explicit-actions).

## sort

<!-- contract:benchmarks.tables:BenchmarkTable.sort -->

```typescript
sort(options: ActionOptions | string = "name"): Promise<void>;
```

<!-- /contract -->

Shorthand supports `"name"` and `"filename"`. It reads names and establishes order before timing, then reverses and validates all row IDs. This setup warms rendering; use another case for untouched rows. Other columns require explicit expected order.

## group and ungroup

<!-- contract:benchmarks.tables:BenchmarkTable.group -->

```typescript
group(options: ActionOptions | string = "status"): Promise<void>;
```

<!-- /contract -->

<!-- contract:benchmarks.tables:BenchmarkTable.ungroup -->

```typescript
ungroup(options?: ActionOptions): Promise<void>;
```

<!-- /contract -->

Shorthand groups by status and checks headings. Ungroup requires an already-grouped table and checks their removal.

## enable and disable

<!-- contract:benchmarks.tables:BenchmarkTable.enable -->

```typescript
enable(options: ActionOptions | readonly string[]): Promise<void>;
```

<!-- /contract -->

<!-- contract:benchmarks.tables:BenchmarkTable.disable -->

```typescript
disable(options: ActionOptions | readonly string[]): Promise<void>;
```

<!-- /contract -->

Pass Mods IDs from `seedMods()`. Disable enabled mods before testing enable. Already-satisfied state is blocked as a no-op.

## selectAll

<!-- contract:benchmarks.tables:BenchmarkTable.selectAll -->

```typescript
selectAll(options?: ActionOptions): Promise<void>;
```

<!-- /contract -->

Selects and checks all rows. Prepare a different initial selection.

## drag

<!-- contract:benchmarks.tables:BenchmarkTable.drag -->

```typescript
drag(options: DragOptions): Promise<void>;
```

<!-- /contract -->

Requires the actual source handle, target and expected new order. Unsupported dragging is blocked; a state dispatch cannot substitute for UI input.

## Explicit actions

<!-- contract:benchmarks.types:ActionOptions -->

```typescript
export interface ActionOptions {
  /** CSS selector for the actual user control. Exactly one visible match is required. */
  control: string;
  /** An observable consequence, different from its value before the action. */
  expect: Expectation;
  name?: string;
}
```

<!-- /contract -->

<!-- contract:benchmarks.types:InputOptions -->

```typescript
export interface InputOptions extends ActionOptions {
  value: string;
}
```

<!-- /contract -->

<!-- contract:benchmarks.types:Expectation -->

```typescript
export interface Expectation extends Observation {
  equals: unknown;
}
```

<!-- /contract -->

`control` selects one visible, enabled control. `expect` reads the changed outcome from DOM, state or game files. It must differ from the starting value. Missing controls/data block; unsuccessful actions or assertions fail.

```typescript
await vortex.table("mods").search({
  control: "#table-mods .header-name input",
  value: "no-matching-mod",
  expect: { selector: "#table-mods tr[data-rowid]", read: "count", equals: 0 },
});
```

DOM reads support `"text"`, `"texts"`, `"count"`, `"value"`, and `"attribute"`; attribute reads also need `attribute`. Use one observation source and an `equals` value matching its shape. See [action recipes](#explicit-actions).
