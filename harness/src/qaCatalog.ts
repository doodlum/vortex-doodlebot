/**
 * The QA catalogue (design 4.6): `harness/qa/catalog.json`, the checks Vortex's own e2e suite
 * lacks, each guarding the Vortex source it covers. `doodlebot qa list --touching <paths…>`
 * selects the entries a change touches; `doodlebot qa check` (in `pnpm run ci`) keeps the file
 * valid. Results are never written here: each run writes
 * `harness/.artifacts/qa/<vortexVersion>/<entry id>/<time>/report.md`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import { ConfigError } from "./errors";
import {
  chooseContent,
  describeChoice,
  isKnownNeed,
  readInventory,
  type Choice,
  type Inventory,
} from "./inventory";
import { readJsonFile } from "./jsonFile";
import { DEFAULT_ARTIFACT_DIR, HARNESS_ROOT } from "./paths";
import { SUITES } from "./testCommand";

export const CATALOG_FILE = path.join(HARNESS_ROOT, "qa", "catalog.json");
/** Where Vortex keeps its own Playwright specs, relative to the Vortex root. */
export const VORTEX_SPECS_DIR = "packages/e2e/src/tests";

const runSchema = z.union([
  z.object({ check: z.string().min(1), args: z.array(z.string()).default([]) }).strict(),
  z.object({ scenario: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]) }).strict(),
]);

export const catalogEntrySchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, "ids are lower-case words joined by . or -"),
    area: z.string().min(1),
    /** Globs relative to the Vortex root; `**` spans folders, `*` stays inside one. */
    guards: z.array(z.string()).default([]),
    why: z.string().min(1),
    run: runSchema,
    /** What passing means, or "measured" for a check that only measures. */
    pass: z.string().default(""),
    /** Inventory needs (inventory.ts), never a named game or collection. */
    needs: z.array(z.string()).default([]),
    cost: z.enum(["<2m", "<10m", "long"]),
    /** Whether it needs a Nexus account; "logout" when it logs out of it. */
    account: z.union([z.boolean(), z.literal("logout")]),
    network: z.boolean(),
  })
  .strict();

export const catalogSchema = z
  .object({
    vortexE2e: z.object({ commit: z.string().min(1), specs: z.array(z.string()) }).strict(),
    entries: z.array(catalogEntrySchema),
  })
  .strict();

export type CatalogEntry = z.infer<typeof catalogEntrySchema>;
export type Catalog = z.infer<typeof catalogSchema>;

export function parseCatalog(value: unknown, file = CATALOG_FILE): Catalog {
  const parsed = catalogSchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ConfigError(
      `${file} is malformed: ${issue?.path.join(".") ?? "?"}: ${issue?.message ?? "?"}.`,
    );
  }
  return parsed.data;
}

export function readCatalog(file = CATALOG_FILE): Catalog {
  let value: unknown;
  try {
    value = readJsonFile(file);
  } catch (error) {
    throw new ConfigError(`${file} is not readable JSON.`, { cause: error });
  }
  return parseCatalog(value, file);
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

/** A guard glob as a regular expression over `/`-separated paths. */
export function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]!;
    if (char === "*" && glob[i + 1] === "*") {
      const slash = glob[i + 2] === "/";
      pattern += slash ? "(?:.*/)?" : ".*";
      i += slash ? 2 : 1;
    } else if (char === "*") pattern += "[^/]*";
    else if (char === "?") pattern += "[^/]";
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${pattern}$`);
}

/** A touched path as the catalogue spells it: relative to the Vortex root, `/`-separated. */
export function vortexRelative(file: string, vortexRoot?: string): string {
  let value = file;
  if (vortexRoot !== undefined && path.isAbsolute(file)) {
    const relative = path.relative(vortexRoot, file);
    if (!relative.startsWith("..") && !path.isAbsolute(relative)) value = relative;
  }
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

export function guardMatches(guard: string, file: string): boolean {
  return globToRegExp(guard).test(file);
}

export interface Selection {
  selected: { entry: CatalogEntry; matched: string[] }[];
  unselected: { entry: CatalogEntry; reason: string }[];
  /** Touched files no entry guards: each one a candidate for a new entry. */
  unguarded: string[];
}

/**
 * The entries a change touches. Without touched files every entry is selected. An entry that logs
 * out of the account is never selected without the person's go-ahead (`allowLogout`).
 */
export function selectEntries(
  catalog: Catalog,
  touched: string[] | undefined,
  options: { allowLogout?: boolean } = {},
): Selection {
  const selection: Selection = { selected: [], unselected: [], unguarded: [] };
  for (const entry of catalog.entries) {
    const matched =
      touched === undefined
        ? []
        : touched.filter((file) => entry.guards.some((guard) => guardMatches(guard, file)));
    if (touched !== undefined && matched.length === 0) {
      selection.unselected.push({
        entry,
        reason: `no touched file matches its guards (${entry.guards.join(", ")})`,
      });
      continue;
    }
    if (entry.account === "logout" && options.allowLogout !== true) {
      selection.unselected.push({
        entry,
        reason: "it logs out of the Nexus account; it runs only with the person's go-ahead",
      });
      continue;
    }
    selection.selected.push({ entry, matched });
  }
  if (touched !== undefined)
    selection.unguarded = touched.filter(
      (file) =>
        !catalog.entries.some((entry) => entry.guards.some((guard) => guardMatches(guard, file))),
    );
  return selection;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type Verdict = "pass" | "fail" | "measured" | "not tested";

export const isMeasured = (entry: Pick<CatalogEntry, "pass">): boolean =>
  entry.pass.trim().toLowerCase() === "measured";

/**
 * How a run of an entry is reported. A run whose needs were unmet, or that did not run, is
 * "not tested". An entry whose `pass` is "measured" reports "measured" when the run produced its
 * measurement (`ok`) and "not tested" when it produced none: never pass, never fail.
 */
export function judgeResult(
  entry: Pick<CatalogEntry, "pass">,
  run: { ran: boolean; ok?: boolean; choice?: Pick<Choice, "met"> },
): Verdict {
  if (run.choice !== undefined && !run.choice.met) return "not tested";
  if (!run.ran) return "not tested";
  if (isMeasured(entry)) return run.ok === true ? "measured" : "not tested";
  return run.ok === true ? "pass" : "fail";
}

/** The verdicts an entry can still report with this content choice, and the rule behind them. */
export function verdictRule(
  entry: Pick<CatalogEntry, "pass">,
  choice: Pick<Choice, "met">,
): { possible: Verdict[]; rule: string } {
  const runs = [{ ran: false }, { ran: true, ok: false }, { ran: true, ok: true }];
  const possible = [...new Set(runs.map((run) => judgeResult(entry, { ...run, choice })))];
  const rule = !choice.met
    ? "not tested: a need is unmet (content.unmet gives the command that meets it)"
    : isMeasured(entry)
      ? "measured: report the values it measured; not tested when it produced none; never pass or fail"
      : `pass when: ${entry.pass}; fail otherwise; not tested when it did not run`;
  return { possible, rule };
}

/** The newest local report of an entry, from `harness/.artifacts/qa/<version>/<id>/<time>/`. */
export function latestResult(
  entryId: string,
  artifactDir = DEFAULT_ARTIFACT_DIR,
): { vortexVersion: string; time: string; report: string } | undefined {
  const qa = path.join(artifactDir, "qa");
  let latest: { vortexVersion: string; time: string; report: string } | undefined;
  let versions: string[];
  try {
    versions = fs.readdirSync(qa);
  } catch {
    return undefined;
  }
  for (const vortexVersion of versions) {
    let times: string[];
    try {
      times = fs.readdirSync(path.join(qa, vortexVersion, entryId));
    } catch {
      continue;
    }
    for (const time of times) {
      const report = path.join(qa, vortexVersion, entryId, time, "report.md");
      if (fs.existsSync(report) && (latest === undefined || time > latest.time))
        latest = { vortexVersion, time, report };
    }
  }
  return latest;
}

// ---------------------------------------------------------------------------
// qa check
// ---------------------------------------------------------------------------

export interface VortexTree {
  /** Every tracked file at HEAD, relative to the Vortex root. */
  files: string[];
  /** Vortex's own spec files (`packages/e2e/src/tests/*.spec.ts`), by name. */
  specs: string[];
  head?: string;
}

export interface CatalogCheck {
  /** Each makes `qa check` fail. */
  problems: string[];
  /** With a Vortex checkout: specs added since the recorded commit, for the owner to compare. */
  newSpecs: string[];
  /** Specs the catalogue records that the checkout no longer has. */
  removedSpecs: string[];
  /** Guards that match no file at the checkout's HEAD. */
  deadGuards: { id: string; guard: string }[];
}

export function checkCatalog(
  catalog: Catalog,
  options: { suites?: string[]; vortex?: VortexTree } = {},
): CatalogCheck {
  const suites = options.suites ?? SUITES.map((suite) => suite.name);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const entry of catalog.entries) {
    if (seen.has(entry.id)) problems.push(`${entry.id}: the id is used twice`);
    seen.add(entry.id);
    if (entry.guards.length === 0 || entry.guards.some((guard) => guard.trim() === ""))
      problems.push(`${entry.id}: no guards`);
    if (entry.pass.trim() === "") problems.push(`${entry.id}: no pass`);
    if (entry.needs.length === 0) problems.push(`${entry.id}: no needs`);
    for (const need of entry.needs)
      if (!isKnownNeed(need)) problems.push(`${entry.id}: unknown need "${need}"`);
    if (entry.account !== false && !entry.needs.includes("login"))
      problems.push(
        `${entry.id}: account is ${JSON.stringify(entry.account)}, so its needs must list "login"`,
      );
    if ("check" in entry.run && !suites.includes(entry.run.check))
      problems.push(
        `${entry.id}: its check "${entry.run.check}" is not a suite (doodlebot test --list)`,
      );
  }
  const result: CatalogCheck = { problems, newSpecs: [], removedSpecs: [], deadGuards: [] };
  const vortex = options.vortex;
  if (vortex === undefined) return result;
  const recorded = new Set(catalog.vortexE2e.specs);
  result.newSpecs = vortex.specs.filter((spec) => !recorded.has(spec));
  result.removedSpecs = catalog.vortexE2e.specs.filter((spec) => !vortex.specs.includes(spec));
  for (const entry of catalog.entries)
    for (const guard of entry.guards) {
      const pattern = globToRegExp(guard);
      if (!vortex.files.some((file) => pattern.test(file)))
        result.deadGuards.push({ id: entry.id, guard });
    }
  return result;
}

/** The Vortex checkout's tracked files and specs, or undefined when there is no checkout. */
export function readVortexTree(dir: string): VortexTree | undefined {
  if (!fs.existsSync(path.join(dir, ".git"))) return undefined;
  const git = (args: string[]): string =>
    execFileSync("git", ["-C", dir, ...args], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  try {
    const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);
    const specs = files
      .filter((file) => file.startsWith(`${VORTEX_SPECS_DIR}/`) && file.endsWith(".spec.ts"))
      .map((file) => file.slice(VORTEX_SPECS_DIR.length + 1))
      .filter((file) => !file.includes("/"))
      .sort();
    return { files, specs, head: git(["rev-parse", "--short=10", "HEAD"]).trim() };
  } catch {
    return undefined;
  }
}

export function formatCheck(catalog: Catalog, check: CatalogCheck, vortex?: VortexTree): string {
  const lines: string[] = [];
  if (check.problems.length === 0)
    lines.push(`OK: ${String(catalog.entries.length)} catalogue entries are valid.`);
  else lines.push("Catalogue problems:", ...check.problems.map((p) => `  ${p}`));
  if (vortex === undefined) {
    lines.push(
      "Not in a Vortex checkout: the spec diff was skipped (specs and guards were not compared). " +
        "Run `doodlebot qa check` from a Vortex checkout or worktree to compare them.",
    );
    return lines.join("\n");
  }
  lines.push(
    `Vortex checkout at ${vortex.head ?? "?"}; the catalogue records e2e specs at ${catalog.vortexE2e.commit}.`,
  );
  lines.push(
    check.newSpecs.length === 0
      ? "No Vortex e2e spec added since the recorded commit."
      : `Vortex e2e specs added since ${catalog.vortexE2e.commit} (compare them with the catalogue): ${check.newSpecs.join(", ")}`,
  );
  if (check.removedSpecs.length > 0)
    lines.push(`Recorded specs the checkout no longer has: ${check.removedSpecs.join(", ")}`);
  lines.push(
    check.deadGuards.length === 0
      ? "Every guard matches a file at HEAD."
      : `Guards that match no file at HEAD:\n${check.deadGuards.map((g) => `  ${g.id}: ${g.guard}`).join("\n")}`,
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// qa list
// ---------------------------------------------------------------------------

const describeRun = (entry: CatalogEntry): string =>
  "check" in entry.run
    ? `doodlebot test ${[entry.run.check, ...entry.run.args].join(" ")}`
    : `scenario: ${Array.isArray(entry.run.scenario) ? entry.run.scenario.join("; ") : entry.run.scenario}`;

export function formatSelection(selection: Selection, touched: string[] | undefined): string {
  const lines: string[] = [];
  lines.push(
    touched === undefined
      ? `Entries (${String(selection.selected.length)}):`
      : `Selected for ${String(touched.length)} touched file(s) (${String(selection.selected.length)}):`,
  );
  for (const { entry, matched } of selection.selected) {
    lines.push(`  ${entry.id}  [${entry.area}, ${entry.cost}]  ${describeRun(entry)}`);
    lines.push(`    pass: ${entry.pass}`);
    lines.push(
      `    needs: ${entry.needs.join(", ")}; account: ${String(entry.account)}; network: ${String(entry.network)}`,
    );
    if (matched.length > 0) lines.push(`    touched: ${matched.join(", ")}`);
    const latest = latestResult(entry.id);
    if (latest !== undefined)
      lines.push(`    latest: ${latest.vortexVersion} ${latest.time} (${latest.report})`);
  }
  if (selection.unselected.length > 0) {
    lines.push(`Not selected (${String(selection.unselected.length)}):`);
    for (const { entry, reason } of selection.unselected) lines.push(`  ${entry.id}: ${reason}`);
  }
  if (touched !== undefined)
    lines.push(
      `Files no entry guards: ${selection.unguarded.length === 0 ? "none" : selection.unguarded.join(", ")}`,
    );
  return lines.join("\n");
}

export interface QaDeps {
  catalogFile?: string;
  vortexDir?: string;
  readTree?: (dir: string) => VortexTree | undefined;
  /** What doodlebot can test against (inventory.ts), read without launching anything. */
  inventory?: () => Inventory;
}

/** An entry's content choice (chooseContent), as `qa list --json` gives it. */
function contentOf(entry: CatalogEntry, inventory: Inventory) {
  const choice = chooseContent(entry.needs, inventory);
  return { choice, content: describeChoice(choice) };
}

/** `doodlebot qa list|check`. Returns the text to print and the exit code. */
export function qaCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  lists: Record<string, string[]>,
  deps: QaDeps = {},
): { text: string; code: number } {
  const [sub, ...rest] = positional;
  const catalog = readCatalog(deps.catalogFile ?? CATALOG_FILE);
  if (sub === "list") {
    // `--touching a b c`: the first path is the flag's value, the others arrive as positionals.
    const given = [...(lists.touching ?? []), ...rest];
    const touched =
      flags.touching === undefined && given.length === 0
        ? undefined
        : given.map((file) => vortexRelative(file, deps.vortexDir));
    const selection = selectEntries(catalog, touched, {
      allowLogout: flags["allow-logout"] === true,
    });
    if (flags.json === true) {
      const inventory = (deps.inventory ?? readInventory)();
      return {
        text: JSON.stringify(
          {
            selected: selection.selected.map(({ entry, matched }) => {
              const { choice, content } = contentOf(entry, inventory);
              return {
                ...entry,
                matched,
                content,
                verdict: verdictRule(entry, choice),
                latest: latestResult(entry.id) ?? null,
              };
            }),
            unselected: selection.unselected.map(({ entry, reason }) => ({ id: entry.id, reason })),
            unguarded: touched === undefined ? null : selection.unguarded,
          },
          null,
          2,
        ),
        code: 0,
      };
    }
    return { text: formatSelection(selection, touched), code: 0 };
  }
  if (sub === "check") {
    const vortex =
      deps.vortexDir === undefined ? undefined : (deps.readTree ?? readVortexTree)(deps.vortexDir);
    const check = checkCatalog(catalog, vortex === undefined ? {} : { vortex });
    return { text: formatCheck(catalog, check, vortex), code: check.problems.length > 0 ? 1 : 0 };
  }
  throw new ConfigError("Use qa list [--touching <paths…>] [--allow-logout] [--json] or qa check.");
}
