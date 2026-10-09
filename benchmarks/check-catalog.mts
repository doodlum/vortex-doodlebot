import assert from "node:assert/strict";
import { allCases } from "./catalog";

// An independent expected-ID set catches omissions and duplicate substitutions.
const expected = new Set<string>();
for (const collection of [1, 2, 3, 5]) {
  for (const benchmark of ["B1", "B2", "B3", "B4"]) expected.add(`${benchmark}-C${collection}`);
}
for (const collection of [1, 2, 3, 5]) expected.add(`B5-C${collection}`);
for (const benchmark of ["B1", "B2", "B3", "B4", "B5"]) expected.add(`${benchmark}-C2-AE`);
for (const count of [150, 570, 1594, 2685]) {
  for (const action of [
    "scroll",
    "sort",
    "group",
    "ungroup",
    "search",
    "filter",
    "enable",
    "disable",
    "select-all",
  ])
    expected.add(`T1-${action}-${count}`);
  for (const table of ["plugins", "load-order"]) {
    for (const action of ["scroll", "drag", "sort", "enable", "disable"])
      expected.add(`T2-${table}-${action}-${count}`);
  }
  for (const action of ["scroll", "sort", "filter"]) expected.add(`T3-${action}-${count}`);
  expected.add(`T4-background-${count}`);
}
const actual = allCases.map((item) => item.id);
assert.equal(new Set(actual).size, actual.length, "Duplicate case ID");
assert.equal(
  actual.length,
  117,
  "Expected 117 cases including both GTS variants and excluding undecided collections",
);
assert.deepEqual(new Set(actual), expected, "Catalog differs from the documented matrix");
for (const item of allCases) {
  assert.ok(item.name.trim());
  assert.equal(typeof item.run, "function");
  assert.equal(
    item.dataset,
    item.id.startsWith("B") || item.id.startsWith("T2-") ? "real" : "synthetic",
  );
}
console.log(
  "Catalog verified: 25 collection (including base/AE GTS), 36 Mods, 40 game-table, 12 Downloads, 4 background = 117 cases. Undecided collections are excluded. This check does not launch Vortex.",
);
