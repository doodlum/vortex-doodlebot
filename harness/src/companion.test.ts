import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

/**
 * The command forms and benchmark-engine names removed by designs/agent-companion.md: the
 * `pnpm run ai` CLI and its `ai:*` scripts, the setup wizard, the benchmark scripts, SDK and
 * examples. Their replacements are the `doodlebot` command and the plugins.
 */
const REMOVED = [
  "pnpm run ai",
  "pnpm --silent run ai",
  "run ai -- ",
  "ai:test",
  "pnpm run setup",
  "pnpm run benchmark",
  "my-first-test",
  "harness/benchmarks",
  "withVortex(",
  "BenchmarkSession",
];
const ALLOWED = new Set([
  "designs/egm-workflow.md",
  "designs/agent-companion.md",
  "harness/src/companion.test.ts",
  "harness/src/singleInstance.test.ts",
]);

/** Files removed by designs/companion-simplified.md; none may come back. */
const REMOVED_FILES = [
  "harness/src/design.ts",
  "harness/src/designCommand.ts",
  "harness/src/readiness.ts",
  "harness/readiness.example.json",
  "plugins/doodlebot/skills/design/SKILL.md",
  "harness/src/mainPreload.ts",
  "harness/src/vortexE2e.ts",
  "harness/patches",
  "harness/src/tests/zoom.e2e.ts",
  "harness/src/tests/panels.e2e.ts",
  // Commands 16 -> 8 (4.1): merged into setup, try, fix and measure.
  ...["login", "baseline", "start", "stop", "status", "update", "drive", "ui-test", "compare"].map(
    (skill) => `plugins/doodlebot/skills/${skill}`,
  ),
  // One manual (plan step 9): folded into the skills and harness/AGENTS.md.
  "harness/AGENT-WORKFLOW.md",
  "harness/WORKFLOWS.md",
  "harness/KNOWLEDGE-ROUTES.md",
  // The drive guide is now docs/guides/try-vortex.md.
  "docs/guides/drive-vortex.md",
];

/**
 * Names of the machinery designs/companion-simplified.md removed. Designs record that history,
 * and tests that assert the absence name them; nothing else may.
 */
const STALE_TERMS = [
  "AGENT-WORKFLOW.md",
  "KNOWLEDGE-ROUTES.md",
  "WORKFLOWS.md",
  "drive-vortex.md",
  "doodlebot readiness",
  "readiness manifest",
  "schema-3",
  "design-review entry",
  "design-review role",
  "design new",
  "design check",
  "design scope",
  "/doodlebot:design",
  "login-import",
  "vortex-e2e",
  "isolate-user-folders",
  "test zoom",
  "test panels",
];
const staleExempt = (file: string): boolean =>
  file.startsWith("designs/") || /\.test\.(?:ts|cjs)$/.test(file);

/**
 * The managed Vortex clone and the variables that named a checkout, retired by
 * designs/vortex-checkout.md: doodlebot works in the session's Vortex checkout, or one cloned with
 * `source --clone <dir>`. Joined so this file holds no literal mention of its own.
 */
const CHECKOUT_TERMS = [
  [".vortex", "src"].join("-"),
  ["VORTEX_AI", "SOURCE_DIR"].join("_"),
  ["VORTEX_AI", "DEV_DIR"].join("_"),
];
/**
 * Designs record the history. `.gitignore` keeps an old clone out of `git status`; `check` and
 * `clean` (checkCommand.ts, diskUse.ts) still recognise one. The config and evidence tests assert
 * that a leftover variable is ignored.
 */
const CHECKOUT_EXEMPT = new Set([
  ".gitignore",
  "harness/src/checkCommand.ts",
  "harness/src/checkCommand.test.ts",
  "harness/src/diskUse.ts",
  "harness/src/diskUse.test.ts",
  "harness/src/config.test.ts",
  "harness/src/evidence.test.ts",
]);

/** `file:line: term` for each retired checkout term in a file outside the exemptions. */
function checkoutTermHits(file: string, text: string): string[] {
  if (file.startsWith("designs/") || CHECKOUT_EXEMPT.has(file)) return [];
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    for (const term of CHECKOUT_TERMS)
      if (line.includes(term)) hits.push(`${file}:${String(index + 1)}: ${term}`);
  });
  return hits;
}
const BINARY = /\.(?:png|jpe?g|gif|ico|ttf|woff2?|zip|7z|exe|dll)$/i;

/** Tracked and untracked non-ignored files that exist on disk. */
function repositoryFiles(): string[] {
  return execFileSync(
    "git",
    ["-C", REPO_ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  )
    .split("\0")
    .filter((file) => file !== "" && !BINARY.test(file))
    .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)));
}

const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

/**
 * The scripts the `ci` job of a workflow runs, in order: the `- run: pnpm run <script>` lines
 * from the line `  ci:` up to the next key at the same two-space indentation.
 */
function ciJobScripts(workflow: string): string[] {
  const lines = workflow.split(/\r?\n/);
  const start = lines.indexOf("  ci:");
  if (start === -1) throw new Error("the workflow has no `  ci:` job");
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((line) => /^ {2}\S/.test(line));
  return (next === -1 ? rest : rest.slice(0, next))
    .map((line) => /^\s+- run: pnpm run (\S+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => match[1]!);
}

/** The scripts a package `ci` script runs: its `pnpm run <script>` parts, split on `&&`. */
function ciScriptSteps(script: string): string[] {
  return script.split("&&").map((part) => {
    const match = /^pnpm run (\S+)$/.exec(part.trim());
    if (match === null) throw new Error(`ci step is not \`pnpm run <script>\`: ${part.trim()}`);
    return match[1]!;
  });
}

describe("the agent companion", () => {
  it("leaves no removed command form or benchmark-engine name outside the allow-list", () => {
    const hits: string[] = [];
    for (const file of repositoryFiles()) {
      if (ALLOWED.has(file)) continue;
      const lines = read(file).split(/\r?\n/);
      lines.forEach((line, index) => {
        for (const removed of REMOVED)
          if (line.includes(removed)) hits.push(`${file}:${String(index + 1)}: ${removed}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it("names no removed machinery outside designs and the tests that assert its absence", () => {
    const hits: string[] = [];
    for (const file of repositoryFiles()) {
      if (staleExempt(file)) continue;
      read(file)
        .split(/\r?\n/)
        .forEach((line, index) => {
          for (const term of STALE_TERMS)
            if (line.includes(term)) hits.push(`${file}:${String(index + 1)}: ${term}`);
        });
    }
    expect(hits).toEqual([]);
  });

  it("no-vortex-src: names no managed clone or checkout variable outside the exemptions", () => {
    const hits = repositoryFiles().flatMap((file) => checkoutTermHits(file, read(file)));
    expect(hits).toEqual([]);
  });

  it("no-vortex-src: a planted mention fails, and only the exemptions pass", () => {
    const clone = CHECKOUT_TERMS[0]!;
    const planted = `Clone it into <workspace>/${clone} first.`;
    expect(checkoutTermHits("docs/guides/fix-a-bug.md", `ok\n${planted}`)).toEqual([
      `docs/guides/fix-a-bug.md:2: ${clone}`,
    ]);
    expect(checkoutTermHits("plugins/doodlebot/skills/try/SKILL.md", CHECKOUT_TERMS[2]!)).toEqual([
      `plugins/doodlebot/skills/try/SKILL.md:1: ${CHECKOUT_TERMS[2]!}`,
    ]);
    expect(checkoutTermHits("harness/src/config.ts", CHECKOUT_TERMS[1]!)).toHaveLength(1);
    for (const exempt of ["designs/vortex-checkout.md", ".gitignore", "harness/src/diskUse.ts"])
      expect(checkoutTermHits(exempt, planted)).toEqual([]);
  });

  it("keeps removed files and package scripts removed", () => {
    for (const file of REMOVED_FILES) expect(fs.existsSync(path.join(REPO_ROOT, file))).toBe(false);
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const stale = Object.keys(pkg.scripts).filter((name) =>
      /^(setup|benchmark|ai)(:|$)/.test(name),
    );
    expect(stale).toEqual([]);
  });

  it("scans a real listing that skips files deleted from disk but still in the index", () => {
    const files = repositoryFiles();
    // An empty or wrong listing would make the scan above pass vacuously.
    expect(files).toEqual(
      expect.arrayContaining(["AGENTS.md", "harness/AGENTS.md", "bin/doodlebot.cjs"]),
    );
    expect(files.every((file) => fs.existsSync(path.join(REPO_ROOT, file)))).toBe(true);
  });

  it("runs the same checks, in the same order, in ci.yml's ci job and the ci script", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const script = pkg.scripts.ci;
    expect(script).toBeDefined();
    const steps = ciScriptSteps(script!);
    expect(steps.length).toBeGreaterThan(0);
    expect(ciJobScripts(read(".github/workflows/ci.yml"))).toEqual(steps);
  });

  it("reads only the ci job's run lines, up to the next job", () => {
    const workflow = [
      "jobs:",
      "  ci:",
      "    steps:",
      "      - run: pnpm install --frozen-lockfile",
      "      - run: pnpm run typecheck",
      "      - name: lint",
      "        run: pnpm run ignored",
      "      - run: pnpm run lint",
      "  core-released:",
      "    steps:",
      "      - run: pnpm run build",
    ].join("\r\n");
    expect(ciJobScripts(workflow)).toEqual(["typecheck", "lint"]);
    expect(ciScriptSteps("pnpm run typecheck && pnpm run lint")).toEqual(["typecheck", "lint"]);
    expect(() => ciScriptSteps("pnpm run typecheck && vitest run")).toThrow(/not `pnpm run/);
  });
});
