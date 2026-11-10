import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { chooseContent } from "./inventory";
import {
  CATALOG_FILE,
  checkCatalog,
  formatSelection,
  globToRegExp,
  guardMatches,
  judgeResult,
  parseCatalog,
  qaCommand,
  readCatalog,
  selectEntries,
  vortexRelative,
  type Catalog,
} from "./qaCatalog";
import { SUITES } from "./testCommand";

const entry = (fields: Record<string, unknown> = {}) => ({
  id: "collections.download-retry",
  area: "collections",
  guards: ["src/renderer/src/extensions/collections/**", "src/main/src/downloading/**"],
  why: "No Vortex e2e spec installs a collection or fails a download.",
  run: { check: "collection-download-retry", args: [] },
  pass: "Every member whose downloads failed is installed after Resume.",
  needs: ["sandbox:fallout4", "collection:offline"],
  cost: "<2m",
  account: false,
  network: false,
  ...fields,
});
const catalogOf = (...entries: Record<string, unknown>[]): Catalog =>
  parseCatalog({ vortexE2e: { commit: "acb3d86210", specs: ["smoke.spec.ts"] }, entries });

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "qa-catalog-"));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("the catalogue file", () => {
  it("parses, and qa check passes on it (catalogue-valid)", () => {
    const catalog = readCatalog();
    expect(catalog.entries.length).toBeGreaterThanOrEqual(9);
    expect(checkCatalog(catalog).problems).toEqual([]);
    // Every check the kit has besides the core and OAuth contracts has an entry.
    const checks = catalog.entries.flatMap((e) => ("check" in e.run ? [e.run.check] : []));
    expect(new Set(checks)).toEqual(
      new Set(SUITES.map((s) => s.name).filter((name) => name !== "core" && name !== "oauth")),
    );
    const churn = catalog.entries.find((e) => "check" in e.run && e.run.check === "download-churn");
    expect(churn?.pass).toBe("measured");
    const bethesda = catalog.entries.find((e) => "check" in e.run && e.run.check === "bethesda");
    expect(bethesda?.pass).toMatch(/Vortex <= 2\.8.*#24282/);
    expect(path.basename(path.dirname(CATALOG_FILE))).toBe("qa");
  });

  it("refuses a malformed file: an unknown field, a bad cost, a run that is neither form", () => {
    expect(() => catalogOf(entry({ extra: 1 }))).toThrow(/malformed/);
    expect(() => catalogOf(entry({ cost: "<1h" }))).toThrow(/malformed: entries\.0\.cost/);
    expect(() => catalogOf(entry({ run: { suite: "x" } }))).toThrow(/malformed/);
    expect(() => catalogOf(entry({ account: "maybe" }))).toThrow(/malformed/);
    expect(
      catalogOf(entry({ run: { scenario: ["open Mods", "sort by name"] } })).entries,
    ).toHaveLength(1);
  });
});

describe("qa check", () => {
  it("fails on an entry missing guards, pass or needs, or whose check is not a suite", () => {
    const { pass: _pass, ...withoutPass } = entry({ id: "no.pass" });
    const check = checkCatalog(
      catalogOf(
        withoutPass,
        entry({ id: "no.guards", guards: [] }),
        entry({ id: "no.needs", needs: [] }),
        entry({ id: "bad.need", needs: ["my-skyrim"] }),
        entry({ id: "bad.check", run: { check: "zoom", args: [] } }),
        entry({ id: "no.guards" }),
        entry({ id: "fine" }),
      ),
    );
    expect(check.problems).toEqual([
      "no.pass: no pass",
      "no.guards: no guards",
      "no.needs: no needs",
      'bad.need: unknown need "my-skyrim"',
      'bad.check: its check "zoom" is not a suite (doodlebot test --list)',
      "no.guards: the id is used twice",
    ]);
    expect(check.newSpecs).toEqual([]);
  });

  it("with a Vortex checkout lists specs added since the recorded commit and guards matching nothing", () => {
    const catalog = catalogOf(
      entry({ guards: ["src/renderer/src/extensions/collections/**", "src/gone/**"] }),
    );
    const check = checkCatalog(catalog, {
      vortex: {
        files: ["src/renderer/src/extensions/collections/index.ts"],
        specs: ["smoke.spec.ts", "collections.spec.ts"],
      },
    });
    expect(check.problems).toEqual([]);
    expect(check.newSpecs).toEqual(["collections.spec.ts"]);
    expect(check.deadGuards).toEqual([{ id: "collections.download-retry", guard: "src/gone/**" }]);
  });

  it("qaCommand check exits 1 on a planted entry without pass, 0 on the real file", () => {
    const file = path.join(root, "catalog.json");
    const { pass: _pass, ...withoutPass } = entry();
    fs.writeFileSync(
      file,
      JSON.stringify({ vortexE2e: { commit: "x", specs: [] }, entries: [withoutPass] }),
    );
    const planted = qaCommand(["check"], {}, {}, { catalogFile: file });
    expect(planted.code).toBe(1);
    expect(planted.text).toContain("collections.download-retry: no pass");
    const real = qaCommand(["check"], {}, {}, { vortexDir: root, readTree: () => undefined });
    expect(real.code).toBe(0);
    expect(real.text).toMatch(/^OK: \d+ catalogue entries are valid\./);
  });
});

describe("guards and selection", () => {
  it("matches globs: ** spans folders, * stays in one", () => {
    expect(guardMatches("src/a/**", "src/a/b/c.ts")).toBe(true);
    expect(guardMatches("src/a/**", "src/a")).toBe(false);
    expect(guardMatches("src/**/x.ts", "src/x.ts")).toBe(true);
    expect(guardMatches("src/**/x.ts", "src/p/q/x.ts")).toBe(true);
    expect(guardMatches("src/*.ts", "src/a.ts")).toBe(true);
    expect(guardMatches("src/*.ts", "src/a/b.ts")).toBe(false);
    expect(guardMatches("src/Table.tsx", "src/Table.tsx")).toBe(true);
    expect(guardMatches("src/Table.tsx", "src/Tablextsx")).toBe(false);
    expect(globToRegExp("a?c").test("abc")).toBe(true);
    expect(vortexRelative("src\\a\\b.ts")).toBe("src/a/b.ts");
    expect(vortexRelative(path.join(root, "src", "x.ts"), root)).toBe("src/x.ts");
  });

  it("selects by touched files, gives each unselected entry its reason, and lists unguarded files", () => {
    const catalog = catalogOf(
      entry(),
      entry({
        id: "plugins.page",
        guards: ["src/renderer/src/extensions/gamebryo_plugin_management/**"],
      }),
      entry({ id: "account.logout", account: "logout" }),
    );
    const touched = ["src/main/src/downloading/queue.ts", "src/renderer/src/views/MainWindow.tsx"];
    const selection = selectEntries(catalog, touched);
    expect(selection.selected.map((s) => [s.entry.id, s.matched])).toEqual([
      ["collections.download-retry", ["src/main/src/downloading/queue.ts"]],
    ]);
    expect(selection.unselected.map((u) => [u.entry.id, u.reason])).toEqual([
      [
        "plugins.page",
        "no touched file matches its guards (src/renderer/src/extensions/gamebryo_plugin_management/**)",
      ],
      [
        "account.logout",
        "it logs out of the Nexus account; it runs only with the person's go-ahead",
      ],
    ]);
    // unguarded-files-listed
    expect(selection.unguarded).toEqual(["src/renderer/src/views/MainWindow.tsx"]);
    expect(formatSelection(selection, touched)).toContain(
      "Files no entry guards: src/renderer/src/views/MainWindow.tsx",
    );
    expect(
      selectEntries(catalog, touched, { allowLogout: true }).selected.map((s) => s.entry.id),
    ).toContain("account.logout");
    // Without touched files every entry is listed.
    expect(selectEntries(catalog, undefined).selected).toHaveLength(2);
  });

  it("qa list takes --touching paths from the flag and the positionals that follow it", () => {
    const result = qaCommand(
      ["list", "src/renderer/src/extensions/gamebryo_plugin_management/index.ts", "README.md"],
      { touching: "src/renderer/src/controls/Table.tsx", json: true },
      { touching: ["src/renderer/src/controls/Table.tsx"] },
    );
    const json = JSON.parse(result.text) as {
      selected: { id: string }[];
      unselected: { id: string; reason: string }[];
      unguarded: string[];
    };
    expect(json.selected.map((s) => s.id)).toEqual(
      expect.arrayContaining(["plugins.page", "mods.large-library", "bethesda.missing-masters"]),
    );
    expect(json.unselected.length).toBeGreaterThan(0);
    expect(json.unguarded).toEqual(["README.md"]);
  });
});

describe("results", () => {
  it("measured-not-passed: a measured entry never reports pass", () => {
    const measured = { pass: "measured" };
    expect(judgeResult(measured, { ran: true, ok: true })).toBe("measured");
    expect(judgeResult(measured, { ran: true, ok: false })).toBe("fail");
    expect(judgeResult(measured, { ran: false })).toBe("not tested");
    for (const run of [{ ran: true, ok: true }, { ran: true }, { ran: false, ok: true }])
      expect(judgeResult(measured, run)).not.toBe("pass");
    const passing = { pass: "Every member installs." };
    expect(judgeResult(passing, { ran: true, ok: true })).toBe("pass");
    expect(judgeResult(passing, { ran: true, ok: false })).toBe("fail");
  });

  it("missing-need-not-tested: an entry whose need is unmet is not tested, never passed", () => {
    const login = chooseContent(["login"], {
      items: [{ id: "login", kind: "login", ready: false, next: "x", label: "no login" }],
    });
    expect(
      judgeResult({ pass: "Every member installs." }, { ran: true, ok: true, choice: login }),
    ).toBe("not tested");
    const met = chooseContent(["login"], {
      items: [{ id: "login", kind: "login", ready: true, label: "login" }],
    });
    expect(
      judgeResult({ pass: "Every member installs." }, { ran: true, ok: true, choice: met }),
    ).toBe("pass");
  });
});
