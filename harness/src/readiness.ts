/** Evidence-complete handoff, never authorization to publish, merge, or release. */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
  checkDesign,
  contractNames,
  outsideBoundary,
  parseDesign,
  relativeInside,
  type DesignDocument,
} from "./design";
import { ConfigError } from "./errors";
import { readJsonFile } from "./jsonFile";
import { compareRuns, validateE2eReport } from "./vortexE2e";
import { completeNativeTestRun, nativeTestReporterSchema } from "./prPreflight";
import {
  artifactSchema,
  assertCurrentIdentity,
  checkArtifact,
  checkRuntime,
  checkoutIdentitySchema,
  commandEvidenceSchema,
  digestSchema,
  hashBytes,
  runtimeIdentitySchema,
  sameIdentity,
  sameSourceIdentity,
  type Artifact,
  type CheckoutIdentity,
  type CommandEvidence,
} from "./evidence";

const text = z.string().trim().min(1);
const role = z.enum([
  "preflight",
  "scoped-tests",
  "control",
  "app-qa",
  "review",
  "kit-ci",
  "kit-core",
  "vortex-verify",
  "performance",
  "vortex-e2e",
  "design-review",
]);
export type EvidenceRole = z.infer<typeof role>;
const contracts = z.enum(contractNames);
export const READINESS_SCHEMA_VERSION = 3;
export const readinessManifestSchema = z.strictObject({
  tool: z.literal("doodlebot-readiness"),
  schemaVersion: z.literal(READINESS_SCHEMA_VERSION),
  mode: z.enum(["exploration", "final"]),
  task: z.strictObject({
    id: text,
    kind: z.enum(["bug", "feature", "docs", "tests", "refactor"]),
    target: z.enum(["vortex", "doodlebot"]),
    summary: text,
    author: text,
  }),
  subject: checkoutIdentitySchema,
  kit: checkoutIdentitySchema,
  source: checkoutIdentitySchema.optional(),
  runtime: runtimeIdentitySchema.optional(),
  /** The approved design document this change implements. */
  design: artifactSchema.optional(),
  risk: z.strictObject({ contracts: z.array(contracts), reason: text, inspectedBy: text }),
  authorization: z.strictObject({
    vortexE2eRequested: z.boolean(),
    appLaunchAllowed: z.boolean(),
    sourceMutationAllowed: z.boolean(),
    reference: text,
  }),
  acceptance: z.array(z.strictObject({ id: text, criterion: text })).min(1),
  evidence: z.array(
    z.strictObject({
      role,
      status: z.enum(["pass", "fail", "inconclusive", "blocked", "not-applicable"]),
      subject: checkoutIdentitySchema,
      reason: text,
      inspectedBy: text,
      criteria: z.array(text),
      artifacts: z.array(artifactSchema),
      command: artifactSchema.optional(),
      preflight: artifactSchema.optional(),
      /** design-review only: the content digest the Goldfish reviewers were given. */
      reviewedDesignSha256: digestSchema.optional(),
      dispositions: z
        .array(z.strictObject({ key: text, reason: text, evidence: artifactSchema }))
        .optional(),
      control: z
        .strictObject({
          kind: z.enum(["intended-assertion", "absent-behavior", "wiring", "invariant"]),
          assessment: artifactSchema,
          preflight: artifactSchema.optional(),
          baselineCommand: artifactSchema.optional(),
          expectedAssertion: text.optional(),
          observedAssertion: text.optional(),
          revertedOutputSha256: digestSchema.optional(),
        })
        .optional(),
      performance: z
        .strictObject({
          baselineRuns: z.array(artifactSchema).min(3),
          currentRuns: z.array(artifactSchema).min(3),
          assessment: artifactSchema,
        })
        .optional(),
      e2e: z
        .strictObject({
          report: artifactSchema,
          baseline: artifactSchema,
          dispositions: z.array(
            z.strictObject({
              testId: text,
              classification: z.enum(["known-product-failure", "external-blocker", "unknown"]),
              failureFingerprint: digestSchema,
              reason: text,
              inspectedBy: text,
              evidence: artifactSchema,
            }),
          ),
        })
        .optional(),
    }),
  ),
});
export type ReadinessManifest = z.infer<typeof readinessManifestSchema>;

const preflightSchema = z
  .strictObject({
    tool: z.literal("pr-preflight"),
    schemaVersion: z.literal(4),
    kit: checkoutIdentitySchema,
    kitAfter: checkoutIdentitySchema,
    identity: checkoutIdentitySchema,
    checkout: text,
    base: text,
    baseSha: text,
    head: text,
    headSha: text,
    mergeBase: text,
    notes: z.array(z.string()),
    passed: z.boolean(),
    checks: z
      .array(
        z.strictObject({
          id: z.enum(["size", "callers", "state", "dispatch", "revert", "comments", "description"]),
          title: text,
          status: z.enum(["pass", "warn", "fail", "skip", "inconclusive"]),
          summary: text,
          details: z.array(z.string()),
          data: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .length(7),
  })
  .superRefine((report, ctx) => {
    if (
      new Set(report.checks.map((c) => c.id)).size !== 7 ||
      report.passed !==
        (sameIdentity(report.kit, report.kitAfter) &&
          report.checks.every((c) => c.status !== "fail" && c.status !== "inconclusive"))
    )
      ctx.addIssue({ code: "custom", message: "inconsistent preflight checks" });
  });
const testFile = (file: string): boolean =>
  /(?:\.test\.|\.spec\.|(?:^|\/)__tests__\/|(?:^|\/)tests\/)/.test(file);
const docFile = (file: string): boolean => /\.(?:md|txt|rst)$/i.test(file);

/** Path-derived minimum; an independent applicability review adds semantic risks. */
export function inferredContracts(manifest: ReadinessManifest): string[] {
  const risks = new Set<string>();
  for (const file of manifest.subject.changedFiles.filter((f) => !docFile(f) && !testFile(f))) {
    if (manifest.task.target === "doodlebot") {
      if (
        file.startsWith("src/") ||
        /^harness\/src\/(?:instance|bootstrap|config|runningVortex|processes|processRunner|source|electronRuntime|hotReload|extensionBuild|auth|login|uiDriver|cdp|sandbox|mainPreload|e2e)[^/]*\./.test(
          file,
        )
      )
        risks.add("runtime");
      if (/uiAutomation|uiDriver|responsive|screenshot|recording/.test(file)) risks.add("ui");
    } else {
      if (/^(?:src|extensions|packages)\//.test(file)) risks.add("runtime");
      if (/\.(?:tsx|css|scss)$|\/ui\//.test(file)) risks.add("ui");
      if (/\/reducers\/|\/store\/|\/state\/|migration|deployment/.test(file))
        risks.add("persistent-data");
      if (/^packages\/(?:vortex-api|adaptor-api)\/|^src\/shared\/src\/api\//.test(file))
        risks.add("public-api");
    }
  }
  return [...risks].sort();
}

/** The argv prefixes that run the complete core contract; anything else is not kit-core. */
export const KIT_CORE_PREFIXES = [
  ["node", "bin/doodlebot.cjs", "test", "core"],
  ["pnpm", "exec", "playwright", "test", "--config", "harness/playwright.config.ts"],
] as const;

/**
 * Whether a recorded kit-core command runs the whole core contract: one of the accepted prefixes
 * followed by nothing but an optional JSON reporter. A filter (--grep, a spec path, --project)
 * or the removed package script for the core suite is refused. Only the Playwright prefix
 * ignores a bare `--`; `doodlebot test core` passes every argument through verbatim, so a `--`
 * there reaches Playwright, which reads what follows as a filter, and is refused.
 */
export function isCompleteCoreCommand(argv: readonly string[]): boolean {
  const prefix = KIT_CORE_PREFIXES.find((candidate) =>
    candidate.every((part, index) => argv[index] === part),
  );
  if (prefix === undefined) return false;
  const rest = argv.slice(prefix.length);
  const tail = prefix[0] === "pnpm" ? rest.filter((arg) => arg !== "--") : rest;
  return ["", "--reporter=json", "--reporter json"].includes(tail.join(" "));
}

export function requiredEvidence(manifest: ReadinessManifest): Map<EvidenceRole, string> {
  const required = new Map<EvidenceRole, string>([
    ["review", "independent acceptance and applicability review"],
  ]);
  const risk = new Set([...manifest.risk.contracts, ...inferredContracts(manifest)]);
  required.set(
    manifest.task.target === "doodlebot" ? "kit-ci" : "vortex-verify",
    "target repository final gate",
  );
  if (manifest.task.target === "vortex" && manifest.task.kind !== "docs")
    required.set("preflight", "Vortex source submission checks");
  if (manifest.task.kind !== "docs") required.set("scoped-tests", "executable/test change");
  if (["bug", "feature", "refactor"].includes(manifest.task.kind))
    required.set("control", "task-specific regression or equivalence evidence");
  if (
    manifest.task.target === "doodlebot" &&
    ["runtime", "ui", "persistent-data"].some((r) => risk.has(r))
  )
    required.set("kit-core", "affected kit app/runtime contract");
  if (
    manifest.task.target === "vortex" &&
    ["runtime", "ui", "persistent-data"].some((r) => risk.has(r))
  )
    required.set("app-qa", "affected production app behavior");
  if (risk.has("performance"))
    required.set("performance", "performance claim or affected performance contract");
  if (manifest.authorization.vortexE2eRequested)
    required.set("vortex-e2e", "explicitly requested upstream E2E");
  if (designRequired(manifest) || manifest.design !== undefined)
    required.set("design-review", "Goldfish review of the approved design before implementation");
  return required;
}

function designRequired(manifest: ReadinessManifest): boolean {
  return manifest.task.kind === "feature" || manifest.task.kind === "refactor";
}

const REVIEW_REPORT = /^round-(\d+)-(.+)\.md$/;
const CONFIRMATION_REVIEWERS = ["implementation_readiness", "vortex-runtime-goldfish"];
const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

export interface ReadinessReport {
  tool: "doodlebot-readiness";
  schemaVersion: 3;
  taskId: string;
  subject: CheckoutIdentity;
  mode: "exploration" | "final";
  ready: boolean;
  issues: string[];
  required: { role: EvidenceRole; reason: string }[];
  meaning: "evidence-complete handoff only; no production, publication, merge or release authority";
}

export function evaluateReadiness(value: unknown, directory: string): ReadinessReport {
  const version = (value as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== READINESS_SCHEMA_VERSION)
    throw new ConfigError(
      `readiness manifest schemaVersion ${JSON.stringify(version)} is not supported; this doodlebot reads schema ${READINESS_SCHEMA_VERSION}`,
    );
  const manifest = readinessManifestSchema.parse(value);
  const issues: string[] = [];
  const required = requiredEvidence(manifest);
  const read = (ref: Artifact): unknown => readJsonFile(checkArtifact(ref, directory));
  const inspect = (ref: Artifact): void => {
    checkArtifact(ref, directory);
  };
  const add = (prefix: string, fn: () => void): void => {
    try {
      fn();
    } catch (error) {
      issues.push(`${prefix}: ${(error as Error).message}`);
    }
  };
  const loadCommand = (ref: Artifact, baseline = false, passing = true): CommandEvidence => {
    const command = commandEvidenceSchema.parse(read(ref));
    inspect(command.output);
    if (!sameIdentity(command.kit, manifest.kit))
      throw new Error("command used different kit code");
    if (!sameIdentity(command.before, command.after))
      throw new Error("source changed during command");
    if (!command.runtimeUnchanged) throw new Error("runtime changed during command");
    if (baseline) {
      if (command.before.headSha !== manifest.subject.baseSha || command.before.dirty)
        throw new Error("baseline command has wrong source identity");
    } else if (!sameIdentity(command.before, manifest.subject))
      throw new Error("stale command source identity");
    if (
      command.aborted ||
      command.signal !== null ||
      command.code === null ||
      (passing && command.code !== 0)
    )
      throw new Error("command failed or was interrupted");
    const relative = path.relative(command.before.checkout, command.command.cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw new Error("command cwd is outside its subject");
    if (command.tests !== undefined) inspect(command.tests.report);
    return command;
  };
  const testsComplete = (command: CommandEvidence): void => {
    if (command.tests === undefined || command.tests.executed === 0 || command.tests.skipped !== 0)
      throw new Error("nonempty test-report evidence with zero skipped tests is required");
  };
  const testsPassed = (command: CommandEvidence): void => {
    testsComplete(command);
    if (command.tests!.failed !== 0) throw new Error("passing test-report evidence is required");
  };
  const producerKit = (report: { kit: CheckoutIdentity; kitAfter: CheckoutIdentity }): void => {
    if (!sameIdentity(report.kit, report.kitAfter))
      throw new Error("producing kit code changed during native report execution");
    if (!sameIdentity(report.kit, manifest.kit))
      throw new Error("native report used different kit code");
  };
  const commandRuntime = (command: CommandEvidence, baseline = false): void => {
    const runtime = command.runtime;
    if (runtime === undefined)
      throw new Error("every app/performance command needs a concrete runtime identity");
    // Historical baselines retain the identity checked during their own execution;
    // sequential builds may have replaced those files before final readiness.
    if (!baseline) {
      checkRuntime(runtime, directory);
      if (JSON.stringify(runtime) !== JSON.stringify(manifest.runtime))
        throw new Error("command and manifest need matching concrete runtime identities");
    }
    if (manifest.task.target === "vortex" && runtime.kind !== "source")
      throw new Error("Vortex app/performance evidence requires a source runtime for the subject");
    if (runtime.kind === "source") {
      const source = manifest.task.target === "vortex" ? command.before : manifest.source;
      if (source === undefined || !sameSourceIdentity(runtime.source!, source))
        throw new Error("runtime source identity differs from the Vortex subject");
    }
  };
  const checkDesignReview = (evidence: ReadinessManifest["evidence"][number]): void => {
    const problems: string[] = [];
    if (evidence.inspectedBy === manifest.task.author)
      problems.push("reviewer must differ from the author");
    if (evidence.criteria.length > 0)
      problems.push("criteria must be empty; a design review proves no acceptance criterion");
    if (evidence.reviewedDesignSha256 === undefined)
      problems.push("reviewedDesignSha256 is required");
    else if (design !== undefined && evidence.reviewedDesignSha256 !== design.contentSha256)
      problems.push("reviewed digest differs from the approved design");
    const reports = evidence.artifacts.flatMap((ref) => {
      const file = checkArtifact(ref, directory);
      const match = REVIEW_REPORT.exec(path.basename(file));
      return match === null ? [] : [{ file, round: match[1]!, reviewer: match[2]! }];
    });
    evidence.artifacts.forEach(inspect);
    const rounds = new Set(reports.map((r) => r.round));
    const complete = [...rounds].some((round) =>
      CONFIRMATION_REVIEWERS.every((reviewer) =>
        reports.some((r) => r.round === round && r.reviewer === reviewer),
      ),
    );
    if (!complete)
      problems.push(
        "needs round-<n>-implementation_readiness.md and round-<n>-vortex-runtime-goldfish.md from one round",
      );
    const checkoutLine = `Checkout: ${evidence.subject.headSha} ${evidence.subject.changesSha256}`;
    for (const report of reports) {
      const lines = fs
        .readFileSync(report.file, "utf8")
        .split(/\r?\n/)
        .map((l) => l.trim());
      if (!lines.includes(`Reviewed content sha256: ${evidence.reviewedDesignSha256 ?? ""}`))
        problems.push(`report ${report.file} does not record the reviewed digest`);
      // The report's own Checkout line: exactly one, naming the reviewed checkout.
      const checkouts = lines.filter((line) => line.startsWith("Checkout:"));
      if (checkouts.length !== 1 || checkouts[0] !== checkoutLine)
        problems.push(`report ${report.file} names another checkout`);
    }
    // Same base as the subject, so committed implementation files appear as changes too.
    if (evidence.subject.baseSha !== manifest.subject.baseSha)
      problems.push("reviewed checkout used another base");
    const allowed = new Set([
      "designs/SITEMAP.md",
      ...(designFile === undefined ? [] : [designFile]),
    ]);
    const implementation = evidence.subject.changedFiles.filter((file) => !allowed.has(file));
    if (implementation.length > 0)
      problems.push(`reviewed checkout had implementation changes: ${implementation.join(", ")}`);
    try {
      execFileSync(
        "git",
        [
          "-C",
          manifest.subject.checkout,
          "merge-base",
          "--is-ancestor",
          evidence.subject.headSha,
          manifest.subject.headSha,
        ],
        { stdio: "ignore", windowsHide: true },
      );
    } catch (error) {
      const status = (error as { status?: number }).status;
      problems.push(
        status === 1
          ? "reviewed head is not an ancestor of the subject head"
          : `cannot check ancestry: ${(error as Error).message}`,
      );
    }
    if (problems.length > 0) throw new Error(problems.join("; design-review: "));
  };
  const loadPreflight = (ref: Artifact) => {
    const report = preflightSchema.parse(read(ref));
    producerKit(report);
    if (
      !sameIdentity(report.identity, manifest.subject) ||
      report.headSha !== manifest.subject.headSha ||
      report.baseSha !== manifest.subject.baseSha
    )
      throw new Error("stale preflight source identity");
    return report;
  };

  add("subject", () => assertCurrentIdentity(manifest.subject));
  add("kit", () => assertCurrentIdentity(manifest.kit));
  if (manifest.source !== undefined) add("source", () => assertCurrentIdentity(manifest.source!));
  if (manifest.runtime !== undefined)
    add("runtime", () => checkRuntime(manifest.runtime!, directory));
  if (manifest.mode === "exploration") issues.push("exploration cannot declare final readiness");
  if (manifest.mode === "final" && manifest.task.target === "vortex" && manifest.subject.dirty)
    issues.push(
      "final Vortex readiness requires a clean committed subject; local-diff review remains exploration",
    );
  if (manifest.task.kind === "docs" && manifest.subject.changedFiles.some((f) => !docFile(f)))
    issues.push("applicability: docs kind cannot waive checks for non-document changes");
  if (
    manifest.task.kind === "tests" &&
    manifest.subject.changedFiles.some((f) => !docFile(f) && !testFile(f))
  )
    issues.push("applicability: tests kind cannot waive controls for production changes");
  for (const risk of inferredContracts(manifest))
    if (!manifest.risk.contracts.includes(risk as z.infer<typeof contracts>))
      issues.push(`applicability: omitted affected contract ${risk}`);
  if (
    [...required.keys()].some((r) =>
      ["kit-core", "app-qa", "performance", "vortex-e2e"].includes(r),
    ) &&
    !manifest.authorization.appLaunchAllowed
  )
    issues.push("blocked: required live-app checks are not authorized");
  const criteria = new Set(manifest.acceptance.map((c) => c.id));
  if (criteria.size !== manifest.acceptance.length) issues.push("duplicate acceptance criterion");

  // The approved design: its structure and approval, target, acceptance text, contracts and
  // file boundary must all match what this manifest claims was done.
  let design: DesignDocument | undefined;
  let designFile: string | undefined;
  if (manifest.design === undefined) {
    if (designRequired(manifest))
      issues.push("design: an approved design is required for feature and refactor tasks");
  } else
    add("design", () => {
      const file = fs.realpathSync.native(checkArtifact(manifest.design!, directory));
      const doc = parseDesign(fs.readFileSync(file, "utf8"));
      design = doc;
      designFile = relativeInside(manifest.subject.checkout, file);
      for (const issue of checkDesign(doc)) issues.push(`design: ${issue}`);
      if (doc.status !== "Approved") issues.push("design: not approved");
      if (doc.target !== manifest.task.target)
        issues.push(
          `design: target ${doc.target} differs from task target ${manifest.task.target}`,
        );
      for (const item of doc.acceptance) {
        const claimed = manifest.acceptance.find((c) => c.id === item.id);
        if (claimed === undefined)
          issues.push(`design: acceptance ${item.id} missing from manifest`);
        else if (collapse(claimed.criterion) !== collapse(item.criterion))
          issues.push(`design: acceptance ${item.id} text differs from the approved design`);
      }
      for (const claimed of manifest.acceptance)
        if (!doc.acceptance.some((item) => item.id === claimed.id))
          issues.push(`design: acceptance ${claimed.id} not in the approved design`);
      for (const contract of doc.contracts)
        if (!(manifest.risk.contracts as string[]).includes(contract))
          issues.push(`design: contract ${contract} missing from risk.contracts`);
      const boundary = doc.boundary.map((b) => b.entry);
      for (const file of outsideBoundary(manifest.subject.changedFiles, boundary, designFile))
        issues.push(`design: ${file} outside the approved boundary`);
    });

  const covered = new Set<string>();
  const seen = new Set<EvidenceRole>();
  for (const evidence of manifest.evidence) {
    const prefix = evidence.role;
    if (seen.has(prefix)) issues.push(`${prefix}: duplicate evidence`);
    seen.add(prefix);
    if (prefix !== "design-review" && evidence.reviewedDesignSha256 !== undefined)
      issues.push(`${prefix}: reviewedDesignSha256 belongs only to design-review`);
    if (prefix === "design-review") {
      // A design review predates the implementation, so it is bound to the reviewed design
      // and a pre-implementation checkout instead of the current diff.
      if (manifest.design === undefined) {
        issues.push("design-review: no design in the manifest");
        continue;
      }
      if (["fail", "inconclusive", "blocked"].includes(evidence.status)) {
        issues.push(`${prefix}: ${evidence.status}: ${evidence.reason}`);
        continue;
      }
      if (evidence.status === "not-applicable") {
        issues.push(`${prefix}: required by an approved design; N/A cannot waive it`);
        continue;
      }
      add(prefix, () => checkDesignReview(evidence));
      continue;
    }
    if (!sameIdentity(evidence.subject, manifest.subject)) {
      issues.push(`${prefix}: stale evidence identity`);
      continue;
    }
    if (["fail", "inconclusive", "blocked"].includes(evidence.status)) {
      issues.push(`${prefix}: ${evidence.status}: ${evidence.reason}`);
      continue;
    }
    if (evidence.status === "not-applicable") {
      if (required.has(prefix))
        issues.push(`${prefix}: required by ${required.get(prefix)}; N/A cannot waive it`);
      continue;
    }
    add(prefix, () => {
      if (evidence.artifacts.length === 0)
        throw new Error("passing evidence needs inspected artifacts");
      evidence.artifacts.forEach(inspect);
      for (const id of evidence.criteria)
        if (!criteria.has(id)) throw new Error(`unknown acceptance criterion ${id}`);
      if (prefix === "review" && evidence.inspectedBy === manifest.task.author)
        throw new Error("review must name a different accountable reviewer");
      const command = evidence.command === undefined ? undefined : loadCommand(evidence.command);
      if (
        ["scoped-tests", "kit-ci", "kit-core", "vortex-verify"].includes(prefix) &&
        command === undefined
      )
        throw new Error("runner-generated command evidence is required");
      if (prefix === "kit-ci" || prefix === "vortex-verify") {
        const script = prefix === "kit-ci" ? "ci" : "verify";
        if (
          JSON.stringify(command!.command.requested) !== JSON.stringify(["pnpm", "run", script]) ||
          command!.command.cwd !== manifest.subject.checkout
        )
          throw new Error(`final gate must be pnpm run ${script} in the subject root`);
      }
      if (prefix === "scoped-tests" || prefix === "kit-core") testsPassed(command!);
      if (["kit-core", "app-qa"].includes(prefix)) {
        if (!manifest.authorization.appLaunchAllowed)
          throw new Error("app checks are not authorized");
        if (command === undefined) throw new Error("app checks need a recorded command");
        commandRuntime(command);
      }
      if (prefix === "kit-core") {
        if (manifest.runtime?.kind !== "installed")
          throw new Error("kit core must establish stock released Vortex compatibility");
        if (!isCompleteCoreCommand(command!.command.requested) || command!.tests!.skipped !== 0)
          throw new Error(
            "kit core must run the complete unfiltered core contract without skipped tests",
          );
      }
      if (prefix === "preflight") {
        if (evidence.preflight === undefined) throw new Error("structured preflight required");
        for (const check of loadPreflight(evidence.preflight).checks.filter(
          (c) => c.id !== "revert",
        )) {
          if (["fail", "inconclusive"].includes(check.status))
            throw new Error(`${check.id}: ${check.status}`);
          if (check.status === "warn") {
            const disposition = evidence.dispositions?.find((d) => d.key === check.id);
            if (disposition === undefined) throw new Error(`uninspected warning ${check.id}`);
            inspect(disposition.evidence);
          }
        }
      }
      if (prefix === "control") {
        const control = evidence.control;
        if (control === undefined) throw new Error("task-specific control is required");
        inspect(control.assessment);
        const allowed =
          manifest.task.kind === "bug"
            ? ["intended-assertion"]
            : manifest.task.kind === "feature"
              ? ["absent-behavior", "wiring", "intended-assertion"]
              : ["invariant"];
        if (!allowed.includes(control.kind))
          throw new Error("control kind does not match task kind");
        if (control.kind === "intended-assertion") {
          if (!manifest.authorization.sourceMutationAllowed && manifest.task.target === "vortex")
            throw new Error("Vortex source mutation is not authorized");
          if (control.preflight === undefined)
            throw new Error("negative-control preflight required");
          const check = loadPreflight(control.preflight).checks.find((c) => c.id === "revert");
          const data = z
            .object({
              failureKind: z.literal("unclassified"),
              restored: z.literal(true),
              revertedFiles: z.array(text).min(1),
              branchOutput: z.string(),
              revertedOutput: z.string(),
              branchOutputSha256: digestSchema,
              revertedOutputSha256: digestSchema,
              branchRuns: z
                .array(
                  z.object({
                    cwd: text,
                    tests: z.array(text).min(1),
                    code: z.literal(0),
                    reporter: nativeTestReporterSchema,
                  }),
                )
                .min(1),
              revertedRuns: z
                .array(
                  z.object({
                    cwd: text,
                    tests: z.array(text).min(1),
                    code: z.number().int(),
                    reporter: nativeTestReporterSchema,
                  }),
                )
                .min(1),
            })
            .parse(check?.data);
          [...data.branchRuns, ...data.revertedRuns].forEach(completeNativeTestRun);
          if (
            check?.status !== "inconclusive" ||
            !data.revertedRuns.some((r) => r.code > 0) ||
            JSON.stringify(data.branchRuns.map(({ cwd, tests }) => ({ cwd, tests }))) !==
              JSON.stringify(data.revertedRuns.map(({ cwd, tests }) => ({ cwd, tests })))
          )
            throw new Error("negative-control selection or failure is invalid");
          if (
            hashBytes(data.branchOutput) !== data.branchOutputSha256 ||
            hashBytes(data.revertedOutput) !== data.revertedOutputSha256 ||
            control.revertedOutputSha256 !== data.revertedOutputSha256
          )
            throw new Error("negative-control output digest mismatch");
          if (
            !control.expectedAssertion ||
            !control.observedAssertion ||
            !data.revertedOutput.includes(control.observedAssertion)
          )
            throw new Error("intended assertion must be inspected in the actual output");
        } else {
          if (command === undefined) throw new Error("control needs a recorded scoped test run");
          testsPassed(command);
          if (control.kind === "absent-behavior") {
            if (control.baselineCommand === undefined)
              throw new Error("absent behavior needs baseline execution");
            const baseline = loadCommand(control.baselineCommand, true, false);
            testsComplete(baseline);
            if (
              baseline.code === 0 ||
              !control.observedAssertion ||
              !fs
                .readFileSync(checkArtifact(baseline.output, directory), "utf8")
                .includes(control.observedAssertion)
            )
              throw new Error("baseline did not demonstrate the inspected absent behavior");
          }
        }
      }
      if (prefix === "performance") {
        if (!manifest.authorization.appLaunchAllowed)
          throw new Error("app checks are not authorized");
        if (manifest.runtime?.mode !== "production")
          throw new Error("performance needs a production runtime");
        if (evidence.performance === undefined)
          throw new Error("three actual baseline/current runs and assessment required");
        for (const baseline of [true, false]) {
          const runs = baseline
            ? evidence.performance.baselineRuns
            : evidence.performance.currentRuns;
          for (const ref of runs) {
            const run = loadCommand(ref, baseline);
            commandRuntime(run, baseline);
            if (run.runtime!.mode !== "production")
              throw new Error("every performance run needs a production runtime");
          }
        }
        const all = [...evidence.performance.baselineRuns, ...evidence.performance.currentRuns];
        if (new Set(all.map((r) => r.sha256)).size !== all.length)
          throw new Error("performance runs must be distinct");
        inspect(evidence.performance.assessment);
      }
      if (prefix === "vortex-e2e") {
        if (!manifest.authorization.vortexE2eRequested || !manifest.authorization.appLaunchAllowed)
          throw new Error("upstream E2E was not authorized");
        if (evidence.e2e === undefined)
          throw new Error("current and baseline E2E reports required");
        const current = validateE2eReport(read(evidence.e2e.report));
        const baseline = validateE2eReport(read(evidence.e2e.baseline));
        producerKit(current);
        producerKit(baseline);
        const source = manifest.task.target === "vortex" ? manifest.subject : manifest.source;
        if (
          source === undefined ||
          current.headSha !== source.headSha ||
          current.identity.changesSha256 !== source.changesSha256 ||
          baseline.headSha !== source.baseSha
        )
          throw new Error("E2E source identity differs from the Vortex subject (not the kit SHA)");
        for (const run of [current, baseline]) {
          if (
            run.identity.dirty ||
            run.globalErrors.length ||
            run.restore?.restored !== true ||
            run.patches.some((p) => !p.restored) ||
            run.playwrightExitCode === null
          )
            throw new Error("E2E interrupted, dirty, globally failed or not restored");
          if (run.counts.passed + run.counts.failed + run.counts.flaky === 0)
            throw new Error("zero E2E tests executed");
          if (run.counts.skipped || run.counts.credentialSkipped || run.counts.flaky)
            throw new Error(
              "blocked E2E coverage: skipped, credentials or flaky outcomes cannot be waived",
            );
          if (run.playwrightExitCode !== 0 && run.counts.failed === 0)
            throw new Error("unexplained E2E exit");
          if (run.runtimeFiles.length < 2)
            throw new Error("E2E lacks actual main/renderer build identity");
          if (run === current) run.runtimeFiles.forEach(inspect);
          if (run.commandCwd !== path.join(run.checkout, "packages", "e2e"))
            throw new Error("E2E cwd mismatch");
          if (!manifest.authorization.sourceMutationAllowed && run.patches.some((p) => p.applied))
            throw new Error("fixture source mutation was not authorized");
        }
        const comparison = compareRuns(current, baseline, evidence.e2e.baseline.path);
        if (
          comparison.regressions.length ||
          comparison.notRun.length ||
          comparison.lostCoverage.length ||
          comparison.changedFailures.length ||
          comparison.metadataChanges.length
        )
          throw new Error(
            "E2E regression, changed failure, missing coverage or execution-condition drift requires a new comparable run",
          );
        const dispositions = evidence.e2e.dispositions;
        if (new Set(dispositions.map((d) => d.testId)).size !== dispositions.length)
          throw new Error("duplicate E2E disposition");
        for (const failure of comparison.preExisting) {
          const disposition = dispositions.find((d) => d.testId === failure.id);
          const outcome = current.outcomes.find((o) => o.id === failure.id);
          if (
            disposition === undefined ||
            disposition.classification !== "known-product-failure" ||
            disposition.failureFingerprint !== outcome?.failureFingerprint
          )
            throw new Error(`external, unknown or uninspected existing failure: ${failure.id}`);
          inspect(disposition.evidence);
        }
        if (dispositions.some((d) => !comparison.preExisting.some((f) => f.id === d.testId)))
          throw new Error("disposition does not identify an unchanged existing failure");
      }
      evidence.criteria.forEach((id) => covered.add(id));
    });
  }
  for (const [requiredRole, reason] of required)
    if (!seen.has(requiredRole)) issues.push(`${requiredRole}: missing evidence (${reason})`);
  for (const id of criteria)
    if (!covered.has(id)) issues.push(`acceptance ${id}: no passing evidence`);
  return {
    tool: "doodlebot-readiness",
    schemaVersion: 3,
    taskId: manifest.task.id,
    subject: manifest.subject,
    mode: manifest.mode,
    ready: issues.length === 0,
    issues,
    required: [...required].map(([requiredRole, reason]) => ({ role: requiredRole, reason })),
    meaning:
      "evidence-complete handoff only; no production, publication, merge or release authority",
  };
}

export function readinessFromFile(file: string): ReadinessReport {
  return evaluateReadiness(readJsonFile(file), path.dirname(path.resolve(file)));
}
