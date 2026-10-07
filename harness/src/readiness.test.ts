import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  requiredEvidence,
  type ReadinessManifest,
  type EvidenceRole,
} from "./readiness";
import {
  captureCheckoutIdentity,
  collectCommandEvidence,
  fileArtifact,
  hashBytes,
  type Artifact,
  type RuntimeIdentity,
} from "./evidence";
import { summarise, type VortexE2eReport, type TestOutcome } from "./vortexE2e";
import { runPreflight } from "./prPreflight";
import { REPO_ROOT } from "./paths";

describe("readiness from concrete synthetic evidence", { timeout: 60_000 }, () => {
  let root: string;
  let repo: string;
  let base: string;
  let count: number;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };
  const commit = () => {
    git("add", ".");
    git("-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-qm", "fixture");
  };
  const save = (value: unknown): Artifact => {
    const file = path.join(root, `artifact-${count++}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return fileArtifact(file);
  };
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "readiness-"));
    repo = path.join(root, "repo");
    count = 0;
    fs.mkdirSync(repo);
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    write(
      "package.json",
      JSON.stringify({
        packageManager: "pnpm@9.15.0",
        scripts: { ci: "node check.cjs", verify: "node check.cjs" },
      }),
    );
    write("check.cjs", "console.log('synthetic gate completed');");
    write(
      "check-tests.cjs",
      "require('node:assert/strict').equal(2+2,4); require('node:fs').writeFileSync(process.argv[2], JSON.stringify({numPassedTests:1,numFailedTests:0,numPendingTests:0}));",
    );
    write("README.md", "before\n");
    commit();
    base = git("rev-parse", "HEAD");
    write("README.md", "after\n");
    commit();
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  async function command(
    args: string[],
    tests = false,
    options: { checkout?: string; base?: string; runtime?: RuntimeIdentity } = {},
  ): Promise<Artifact> {
    const out = path.join(root, `command-${count++}.json`);
    const report = tests ? path.join(root, `tests-${count++}.json`) : undefined;
    await collectCommandEvidence({
      checkout: options.checkout ?? repo,
      base: options.base ?? base,
      cwd: options.checkout ?? repo,
      owner: "evidence-test",
      command: tests ? [...args, report!] : args,
      out,
      testReport: report,
      testFormat: report === undefined ? undefined : "vitest",
      runtime: options.runtime,
      leaseEnv: { dir: path.join(root, "leases") },
    });
    return fileArtifact(out);
  }
  async function manifest(
    target: "vortex" | "doodlebot" = "doodlebot",
  ): Promise<ReadinessManifest> {
    const ci = await command(["pnpm", "run", target === "doodlebot" ? "ci" : "verify"]);
    const receipt = JSON.parse(fs.readFileSync(ci.path, "utf8"));
    const subject = captureCheckoutIdentity(repo, base);
    const review = save({ observation: "Links and actual diff inspected" });
    return {
      tool: "doodlebot-readiness",
      schemaVersion: 2,
      mode: "final",
      task: {
        id: "task",
        target,
        kind: "docs",
        author: "author",
        summary: "Documentation correction",
      },
      subject,
      kit: receipt.kit,
      risk: { contracts: [], reason: "Only documentation changed", inspectedBy: "qa" },
      authorization: {
        vortexE2eRequested: false,
        appLaunchAllowed: false,
        sourceMutationAllowed: false,
        reference: "task scope",
      },
      acceptance: [{ id: "result", criterion: "Document matches behavior" }],
      evidence: [
        {
          role: "review",
          status: "pass",
          subject,
          reason: "Reviewed actual diff and applicability",
          inspectedBy: "qa",
          criteria: ["result"],
          artifacts: [review],
        },
        {
          role: target === "doodlebot" ? "kit-ci" : "vortex-verify",
          status: "pass",
          subject,
          reason: "Actual synthetic gate",
          inspectedBy: "author",
          criteria: [],
          artifacts: [ci],
          command: ci,
        },
      ],
    };
  }
  function entry(m: ReadinessManifest, role: EvidenceRole) {
    return m.evidence.find((e) => e.role === role)!;
  }
  function sourceRuntime(checkout: string, baseRef: string): RuntimeIdentity {
    const binary = path.join(root, `runtime-${count++}.cjs`);
    fs.writeFileSync(binary, "synthetic runtime bytes; no app executed");
    return {
      kind: "source",
      mode: "production",
      label: "synthetic",
      files: [fileArtifact(binary)],
      source: captureCheckoutIdentity(checkout, baseRef),
    };
  }
  function otherCheckout(name: string, ref: string): string {
    const checkout = path.join(root, name);
    git("worktree", "add", "--detach", checkout, ref);
    return checkout;
  }
  it("accepts actual kit CI evidence without unrelated Vortex gates; Vortex verify does not imply E2E authorization", async () => {
    const kit = await manifest();
    expect(evaluateReadiness(kit, root).ready).toBe(true);
    const vortex = await manifest("vortex");
    expect(evaluateReadiness(vortex, root).ready).toBe(true);
    vortex.authorization.vortexE2eRequested = true;
    expect(evaluateReadiness(vortex, root).issues.join(" ")).toMatch(
      /not authorized.*missing evidence/s,
    );
  });
  it("accepts a kit feature with real scoped execution and wiring assessment, without source mutation or Vortex E2E", async () => {
    write("harness/src/calculation.ts", "export const answer = 4;\n");
    commit();
    const m = await manifest();
    m.task.kind = "feature";
    const scoped = await command(["node", "check-tests.cjs"], true);
    const assessment = save({ assertion: "Consumer wiring and added behavior inspected" });
    for (const role of ["scoped-tests", "control"] as const)
      m.evidence.push({
        role,
        status: "pass",
        subject: m.subject,
        reason: "Verified test consumer",
        inspectedBy: "qa",
        criteria: ["result"],
        artifacts: [scoped],
        command: scoped,
        ...(role === "control" ? { control: { kind: "wiring" as const, assessment } } : {}),
      });
    expect(evaluateReadiness(m, root).issues).toEqual([]);
    entry(m, "control").status = "not-applicable";
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("N/A cannot waive");
  });

  it("rejects a stable dirty Vortex final receipt but permits identified local-diff exploration", async () => {
    write("README.md", "uncommitted reviewed documentation\n");
    const m = await manifest("vortex");
    const receipt = JSON.parse(fs.readFileSync(entry(m, "vortex-verify").command!.path, "utf8"));
    expect(m.subject.dirty).toBe(true);
    expect(receipt.before).toEqual(receipt.after);
    expect(evaluateReadiness(m, root).issues).toEqual([
      "final Vortex readiness requires a clean committed subject; local-diff review remains exploration",
    ]);
    m.mode = "exploration";
    expect(evaluateReadiness(m, root).issues).toEqual([
      "exploration cannot declare final readiness",
    ]);
    expect(entry(m, "review").subject).toEqual(m.subject);
  });
  it("infers runtime checks from the actual diff and rejects relabelling production files as documentation", async () => {
    write("harness/src/instance.ts", "export const changed = true;\n");
    commit();
    const m = await manifest();
    expect(requiredEvidence(m).has("kit-core")).toBe(true);
    expect(evaluateReadiness(m, root).issues.join(" ")).toMatch(
      /docs kind.*omitted affected contract runtime/s,
    );
  });
  it("rejects same-HEAD local source drift, untracked changes, artifact tampering and exploration", async () => {
    const m = await manifest();
    write("README.md", "changed after inspection\n");
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("stale checkout/diff");
    git("checkout", "--", "README.md");
    write("new.ts", "new\n");
    expect(evaluateReadiness(m, root).ready).toBe(false);
    fs.unlinkSync(path.join(repo, "new.ts"));
    const receipt = entry(m, "kit-ci").command!;
    fs.appendFileSync(receipt.path, " ");
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("digest mismatch");
    const next = await manifest();
    next.mode = "exploration";
    expect(evaluateReadiness(next, root).issues).toContain(
      "exploration cannot declare final readiness",
    );
  });
  it("does not accept a command in the wrong cwd or a token containing the gate name", async () => {
    const m = await manifest();
    const gate = entry(m, "kit-ci");
    const receipt = JSON.parse(fs.readFileSync(gate.command!.path, "utf8"));
    receipt.command.requested = ["echo", "ci"];
    gate.command = save(receipt);
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("final gate must be");
    receipt.command.requested = ["pnpm", "run", "ci"];
    receipt.command.cwd = root;
    gate.command = save(receipt);
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("cwd is outside");
  });
  it("rejects missing evidence, self-review, stale schemas and blocked status", async () => {
    const m = await manifest();
    entry(m, "review").inspectedBy = "author";
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("different accountable reviewer");
    entry(m, "review").status = "blocked";
    expect(evaluateReadiness(m, root).ready).toBe(false);
    m.evidence = [];
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("missing evidence");
    expect(() => evaluateReadiness({ ...m, schemaVersion: 1 }, root)).toThrow();
  });

  it("checks every performance receipt's production runtime and corresponding source", async () => {
    const m = await manifest("vortex");
    m.risk.contracts = ["performance"];
    m.authorization.appLaunchAllowed = true;
    m.runtime = sourceRuntime(repo, base);
    const baselineCheckout = otherCheckout("baseline", base);
    const baselineRuntime = sourceRuntime(baselineCheckout, base);
    const baselineRuns: Artifact[] = [];
    const currentRuns: Artifact[] = [];
    for (let i = 0; i < 3; i++) {
      baselineRuns.push(
        await command(["node", "check.cjs"], false, {
          checkout: baselineCheckout,
          base,
          runtime: baselineRuntime,
        }),
      );
      currentRuns.push(await command(["node", "check.cjs"], false, { runtime: m.runtime }));
    }
    // Historical runs remain valid after a later sequential build replaces their
    // binary and advances the checkout; their receipt still binds the original source.
    fs.writeFileSync(baselineRuntime.files[0]!.path, "later build bytes");
    execFileSync("git", ["-C", baselineCheckout, "checkout", "--detach", m.subject.headSha], {
      windowsHide: true,
      stdio: "ignore",
    });
    const assessment = save({ observation: "Synthetic series provenance" });
    m.evidence.push({
      role: "performance",
      status: "pass",
      subject: m.subject,
      reason: "Three distinct executions per revision",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [assessment],
      performance: { baselineRuns, currentRuns, assessment },
    });
    expect(evaluateReadiness(m, root).issues).toEqual([]);
    // Each position is validated; an unrelated top-level receipt cannot supply provenance.
    entry(m, "performance").command = currentRuns[0];
    for (const runs of [baselineRuns, currentRuns]) {
      for (let i = 0; i < runs.length; i++) {
        const original = runs[i]!;
        const receipt = JSON.parse(fs.readFileSync(original.path, "utf8"));
        delete receipt.runtime;
        runs[i] = save(receipt);
        expect(evaluateReadiness(m, root).issues.join(" ")).toContain(
          "every app/performance command needs a concrete runtime",
        );
        runs[i] = original;
      }
      const original = runs[1]!;
      const receipt = JSON.parse(fs.readFileSync(original.path, "utf8"));
      receipt.runtime.mode = "development";
      runs[1] = save(receipt);
      expect(evaluateReadiness(m, root).ready).toBe(false);
      receipt.runtime = runs === baselineRuns ? m.runtime : baselineRuntime;
      runs[1] = save(receipt);
      expect(evaluateReadiness(m, root).ready).toBe(false);
      runs[1] = original;
    }
    expect(evaluateReadiness(m, root).issues).toEqual([]);
  });

  it("accepts the subject runtime in another clean checkout but rejects another revision, base, diff or released app", async () => {
    const m = await manifest("vortex");
    m.risk.contracts = ["runtime"];
    m.authorization.appLaunchAllowed = true;
    const headCheckout = otherCheckout("same-code", "HEAD");
    const baselineCheckout = otherCheckout("old-code", base);
    const current = sourceRuntime(headCheckout, base);
    const assessment = save({ observation: "Synthetic app identity check" });
    const app: ReadinessManifest["evidence"][number] = {
      role: "app-qa",
      status: "pass",
      subject: m.subject,
      reason: "Runtime correspondence",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [assessment],
    };
    m.evidence.push(app);
    const evaluate = async (runtime: RuntimeIdentity) => {
      m.runtime = runtime;
      app.command = await command(["node", "check.cjs"], false, { runtime });
      return evaluateReadiness(m, root);
    };
    expect((await evaluate(current)).issues).toEqual([]);
    expect((await evaluate(sourceRuntime(baselineCheckout, base))).issues.join(" ")).toContain(
      "runtime source identity differs",
    );
    expect((await evaluate(sourceRuntime(headCheckout, "HEAD"))).issues.join(" ")).toContain(
      "runtime source identity differs",
    );
    fs.writeFileSync(path.join(headCheckout, "README.md"), "unreviewed local runtime source");
    expect((await evaluate(sourceRuntime(headCheckout, base))).issues.join(" ")).toContain(
      "runtime source identity differs",
    );
    expect(
      (
        await evaluate({
          kind: "installed",
          mode: "production",
          label: "released",
          files: current.files,
        })
      ).issues.join(" "),
    ).toContain("requires a source runtime");
  });

  it.each(["skip", "todo"] as const)(
    "rejects an actual scoped/control run whose required regression uses %s",
    async (omission) => {
      write(
        "scope.test.js",
        `test('unrelated passes', () => expect(2 + 2).toBe(4)); test.${omission}('required regression');`,
      );
      commit();
      const m = await manifest();
      m.task.kind = "feature";
      const config = path.join(root, "vitest.config.mjs");
      fs.writeFileSync(
        config,
        `export default { cacheDir: ${JSON.stringify(path.join(root, "vitest-cache"))}, test: { include: ['scope.test.js'], environment: 'node', globals: true } };`,
      );
      const out = path.join(root, "skipped-command.json");
      const report = path.join(root, "skipped-tests.json");
      const receipt = await collectCommandEvidence({
        checkout: repo,
        base,
        cwd: repo,
        owner: "skip-test",
        out,
        command: [
          process.execPath,
          path.join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs"),
          "run",
          "--root",
          repo,
          "--config",
          config,
          "--reporter=json",
          "--outputFile",
          report,
        ],
        testReport: report,
        testFormat: "vitest",
        leaseEnv: { dir: path.join(root, "leases") },
      });
      expect(receipt).toMatchObject({ code: 0, tests: { executed: 1, failed: 0, skipped: 1 } });
      const scoped = fileArtifact(out);
      const assessment = save({ observation: "The required regression was skipped" });
      for (const role of ["scoped-tests", "control"] as const)
        m.evidence.push({
          role,
          status: "pass",
          subject: m.subject,
          reason: "Skipped regression receipt",
          inspectedBy: "qa",
          criteria: [],
          artifacts: [scoped],
          command: scoped,
          ...(role === "control" ? { control: { kind: "wiring" as const, assessment } } : {}),
        });
      const result = evaluateReadiness(m, root);
      expect(result.issues).toEqual([
        "scoped-tests: nonempty test-report evidence with zero skipped tests is required",
        "control: nonempty test-report evidence with zero skipped tests is required",
      ]);
    },
  );

  it("requires native preflight producer identity before and after execution", async () => {
    const m = await manifest("vortex");
    const report = await runPreflight({ checkout: repo, base, skipRevert: true });
    const native: ReadinessManifest["evidence"][number] = {
      role: "preflight",
      status: "pass",
      subject: m.subject,
      reason: "Native producer provenance",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [save({ inspected: true })],
      preflight: save(report),
    };
    m.evidence.push(native);
    expect(evaluateReadiness(m, root).issues).toEqual([]);
    const different = { ...report.kit, changesSha256: "f".repeat(64) };
    native.preflight = save({ ...report, kit: different, kitAfter: different });
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain(
      "native report used different kit code",
    );
    native.preflight = save({ ...report, kitAfter: different, passed: false });
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("producing kit code changed");
    for (const obsolete of [
      { ...report, schemaVersion: 3 },
      { ...report, kit: undefined },
      { ...report, kitAfter: undefined },
    ]) {
      native.preflight = save(obsolete);
      expect(evaluateReadiness(m, root).ready).toBe(false);
    }
  });

  it("accepts complete native assertion evidence and rejects missing, omitted or inconsistent executions on either side", async () => {
    const m = await manifest();
    m.task.kind = "bug";
    const scoped = await command(["node", "check-tests.cjs"], true);
    const native = await runPreflight({ checkout: repo, base, skipRevert: true });
    const reporter = (statuses: string[]) => {
      const json = JSON.stringify({
        numTotalTests: statuses.length,
        numPassedTests: statuses.filter((status) => status === "passed").length,
        numFailedTests: statuses.filter((status) => status === "failed").length,
        numPendingTests: statuses.filter((status) => status === "skipped").length,
        numTodoTests: statuses.filter((status) => status === "todo").length,
        testResults: [{ assertionResults: statuses.map((status) => ({ status })) }],
      });
      return { json, sha256: hashBytes(json) };
    };
    // Schema injection tests the consumer; actual native executions are covered in prPreflight.test.ts.
    const data = {
      failureKind: "unclassified",
      restored: true,
      revertedFiles: ["README.md"],
      branchOutput: "assertion passed",
      revertedOutput: "Expected 1 to be 2",
      branchOutputSha256: hashBytes("assertion passed"),
      revertedOutputSha256: hashBytes("Expected 1 to be 2"),
      branchRuns: [{ cwd: ".", tests: ["value.test.ts"], code: 0, reporter: reporter(["passed"]) }],
      revertedRuns: [
        { cwd: ".", tests: ["value.test.ts"], code: 1, reporter: reporter(["failed"]) },
      ],
    };
    const report = {
      ...native,
      passed: false,
      checks: native.checks.map((check) =>
        check.id === "revert" ? { ...check, status: "inconclusive", data } : check,
      ),
    };
    m.evidence.push({
      role: "scoped-tests",
      status: "pass",
      subject: m.subject,
      reason: "Actual scoped fixture",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [scoped],
      command: scoped,
    });
    m.evidence.push({
      role: "control",
      status: "pass",
      subject: m.subject,
      reason: "Consumer assertion fixture",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [scoped],
      control: {
        kind: "intended-assertion",
        assessment: save({ observation: "Synthetic oracle inspected" }),
        preflight: save(report),
        expectedAssertion: "Expected 1 to be 2",
        observedAssertion: "Expected 1 to be 2",
        revertedOutputSha256: data.revertedOutputSha256,
      },
    });
    const control = entry(m, "control").control!;
    expect(evaluateReadiness(m, root).issues).toEqual([]);
    for (const side of ["branchRuns", "revertedRuns"] as const) {
      for (const defect of [
        "missing",
        "zero",
        "skip",
        "todo",
        "digest",
        "counts",
        "exit",
      ] as const) {
        const changed = structuredClone(data);
        const run = changed[side][0]!;
        const status = side === "branchRuns" ? "passed" : "failed";
        if (defect === "missing") delete (run as { reporter?: unknown }).reporter;
        if (defect === "zero") run.reporter = reporter([]);
        if (defect === "skip" || defect === "todo")
          run.reporter = reporter([status, defect === "skip" ? "skipped" : "todo"]);
        if (defect === "digest") run.reporter.sha256 = "a".repeat(64);
        if (defect === "counts") {
          const json = JSON.stringify({ ...JSON.parse(run.reporter.json), numTotalTests: 2 });
          run.reporter = { json, sha256: hashBytes(json) };
        }
        if (defect === "exit") run.code = run.code === 0 ? 1 : 0;
        control.preflight = save({
          ...report,
          checks: report.checks.map((check) =>
            check.id === "revert" ? { ...check, data: changed } : check,
          ),
        });
        expect(evaluateReadiness(m, root).ready, `${side}: ${defect}`).toBe(false);
      }
    }
  });

  function e2e(m: ReadinessManifest, results: TestOutcome[]): VortexE2eReport {
    const source = captureCheckoutIdentity(repo);
    m.source = source;
    const main = path.join(root, "main.cjs");
    const renderer = path.join(root, "renderer.js");
    fs.writeFileSync(main, "main");
    fs.writeFileSync(renderer, "renderer");
    return {
      tool: "vortex-e2e",
      schemaVersion: 4,
      kit: m.kit,
      kitAfter: m.kit,
      identity: source,
      checkout: source.checkout,
      headSha: source.headSha,
      owner: "qa",
      commandCwd: path.join(source.checkout, "packages", "e2e"),
      runtimeFiles: [fileArtifact(main), fileArtifact(renderer)],
      startedAt: new Date().toISOString(),
      durationMs: 1,
      command: ["playwright", "test"],
      specs: [],
      selection: {
        specs: [],
        grep: null,
        grepInvert: null,
        configSha256: "c".repeat(64),
        fixturePatches: [],
        platform: "win32",
        nodeVersion: "v24",
        workers: 1,
        retries: 0,
        ci: true,
      },
      selectedTests: results.map((r) => r.id),
      accounts: { free: false, premium: false },
      patches: [],
      restore: { restored: true, mismatched: [], statusChanges: [] },
      ...summarise(results, []),
      credentialSkipped: [],
      outcomes: results,
      globalErrors: [],
      playwrightExitCode: results.some((r) => r.status === "failed") ? 1 : 0,
      notes: [],
    };
  }
  const outcome = (status: TestOutcome["status"]): TestOutcome => ({
    id: "test",
    file: "a.spec.ts",
    line: 1,
    title: "test",
    status,
    ...(status === "failed"
      ? { failureFingerprint: hashBytes("product assertion"), error: "product assertion" }
      : {}),
  });
  it("keeps separate source and kit identities and cannot waive zero execution, regressions or external failures", async () => {
    const m = await manifest();
    m.authorization.vortexE2eRequested = true;
    m.authorization.appLaunchAllowed = true;
    let current = e2e(m, [outcome("passed")]);
    let baseline = current;
    const qa = save({ inspected: "actual unchanged product assertion" });
    const evidence: ReadinessManifest["evidence"][number] = {
      role: "vortex-e2e",
      status: "pass",
      subject: m.subject,
      reason: "Requested comparison",
      inspectedBy: "qa",
      criteria: [],
      artifacts: [qa],
      e2e: { report: save(current), baseline: save(baseline), dispositions: [] },
    };
    m.evidence.push(evidence);
    expect(evaluateReadiness(m, root).issues).toEqual([]);
    const different = { ...m.kit, changesSha256: "f".repeat(64) };
    for (const side of ["report", "baseline"] as const) {
      const original = evidence.e2e![side];
      evidence.e2e![side] = save({ ...current, kit: different, kitAfter: different });
      expect(evaluateReadiness(m, root).issues.join(" ")).toContain(
        "native report used different kit code",
      );
      evidence.e2e![side] = save({ ...current, kitAfter: different });
      expect(evaluateReadiness(m, root).issues.join(" ")).toContain("producing kit code changed");
      for (const obsolete of [
        { ...current, schemaVersion: 3 },
        { ...current, kit: undefined },
        { ...current, kitAfter: undefined },
      ]) {
        evidence.e2e![side] = save(obsolete);
        expect(evaluateReadiness(m, root).ready).toBe(false);
      }
      evidence.e2e![side] = original;
    }
    current = e2e(m, [outcome("skipped")]);
    evidence.e2e!.report = save(current);
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("zero E2E tests executed");
    current = e2e(m, [outcome("failed")]);
    evidence.e2e!.report = save(current);
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("E2E regression");
    baseline = current;
    evidence.e2e!.baseline = save(baseline);
    evidence.e2e!.dispositions = [
      {
        testId: "test",
        classification: "external-blocker",
        failureFingerprint: current.outcomes[0]!.failureFingerprint!,
        reason: "Ignore this",
        inspectedBy: "qa",
        evidence: qa,
      },
    ];
    expect(evaluateReadiness(m, root).issues.join(" ")).toContain("external, unknown");
    evidence.e2e!.dispositions[0]!.classification = "known-product-failure";
    expect(evaluateReadiness(m, root).issues).toEqual([]);
  });
});
