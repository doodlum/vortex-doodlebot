const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { test } = require("node:test");
const { checkExamples, extractExample } = require("./docs-examples.cjs");

const root = path.resolve(__dirname, "..");
const script = path.join(__dirname, "docs.cjs");
const env = { ...process.env, DOODLEBOT_DOCS_BASE: "" };
const run = (fixture, args = [], extraEnv = {}) =>
  cp.spawnSync(process.execPath, [script, "--root", fixture, ...args], {
    cwd: root,
    env: { ...env, ...extraEnv },
    encoding: "utf8",
  });
const git = (fixture, args) => cp.execFileSync("git", args, { cwd: fixture, stdio: "pipe" });

test("paired documentation refuses drift and missing companions", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-docs-control-"));
  const output = (result) => result.stdout + result.stderr;
  const changed = (file, transform) =>
    fs.writeFileSync(
      path.join(fixture, file),
      transform(fs.readFileSync(path.join(fixture, file), "utf8")),
    );
  try {
    for (const file of [
      "src",
      "harness/src",
      "harness/benchmarks",
      "benchmarks",
      "docs",
      "harness/reference",
      "scripts/documentation-map.json",
      "package.json",
      "AGENTS.md",
      "ARCHITECTURE.md",
      "KNOWLEDGE.md",
      "harness/AGENTS.md",
      "harness/TESTING.md",
      "harness/AGENT-WORKFLOW.md",
      "harness/KNOWLEDGE-ROUTES.md",
      "harness/WORKFLOWS.md",
    ]) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.cpSync(path.join(root, file), path.join(fixture, file), { recursive: true });
    }
    git(fixture, ["init", "--quiet"]);
    git(fixture, ["config", "user.name", "Documentation control"]);
    git(fixture, ["config", "user.email", "docs-control@example.invalid"]);
    const generated = run(fixture, ["--write"]);
    assert.equal(generated.status, 0, output(generated));
    const mcpReference = fs.readFileSync(path.join(fixture, "docs/reference/mcp-tools.md"), "utf8");
    assert.match(
      mcpReference,
      /## perf_trace_start[\s\S]*?\*\*Availability:\*\* Bearer token required\./,
    );
    assert.ok(
      mcpReference.includes("\\_\\_CALLBACK\\_\\_"),
      "Literal callback sentinel must be escaped as text",
    );
    assert.ok(
      !mcpReference.includes("**CALLBACK**"),
      "Callback sentinel must never become bold Markdown",
    );
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "synthetic baseline"]);
    const baseline = git(fixture, ["rev-parse", "HEAD"]).toString().trim();
    const clean = run(fixture);
    assert.equal(clean.status, 0, output(clean));

    changed("docs/reference/mcp-tools.md", (body) => body + "\nInvented contract\n");
    const stale = run(fixture);
    assert.equal(stale.status, 1);
    assert.match(output(stale), /docs\/reference\/mcp-tools\.md is stale/);
    git(fixture, ["restore", "."]);

    // A newly implemented CLI branch must enter the generated inventory, even when it
    // is a switch case (not only the early if-dispatch branches).
    changed(
      "harness/src/cli.ts",
      (body) =>
        body +
        '\nfunction docsControl(command: string) { switch (command) { case "docs-control": return; } }\n',
    );
    const contract = run(fixture);
    assert.equal(contract.status, 1);
    assert.match(output(contract), /reference\/cli\.md is stale/);
    const regenerated = run(fixture, ["--write"]);
    assert.equal(regenerated.status, 0, output(regenerated));
    assert.match(
      fs.readFileSync(path.join(fixture, "docs/reference/cli.md"), "utf8"),
      /`docs-control`/,
    );
    assert.equal(run(fixture).status, 0);
    git(fixture, ["restore", "."]);

    changed("harness/src/bootstrap.ts", (body) => body + "\n// Synthetic lifecycle change.\n");
    changed("harness/AGENTS.md", (body) => body + "\nSynthetic AI companion.\n");
    const missingHuman = run(fixture);
    assert.equal(missingHuman.status, 1);
    assert.match(output(missingHuman), /Lifecycle and authentication: update a mapped human page/);
    changed("docs/guides/lifecycle.md", (body) => body + "\nSynthetic human companion.\n");
    const paired = run(fixture);
    assert.equal(paired.status, 0, output(paired));
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "paired synthetic change"]);
    const committed = run(fixture, [], { DOODLEBOT_DOCS_BASE: baseline });
    assert.equal(committed.status, 0, output(committed));
    git(fixture, ["reset", "--hard", "--quiet", baseline]);

    changed("harness/src/bootstrap.ts", (body) => body + "\n// Synthetic lifecycle change.\n");
    changed("docs/guides/lifecycle.md", (body) => body + "\nSynthetic human companion.\n");
    const missingAI = run(fixture);
    assert.equal(missingAI.status, 1);
    assert.match(output(missingAI), /Lifecycle and authentication: update a mapped AI/);
    // Committing must not allow an incomplete change to evade the base comparison.
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "unpaired synthetic change"]);
    const committedFailure = run(fixture, [], { DOODLEBOT_DOCS_BASE: baseline });
    assert.equal(committedFailure.status, 1);
    assert.match(output(committedFailure), /Lifecycle and authentication: update a mapped AI/);
    git(fixture, ["reset", "--hard", "--quiet", baseline]);

    changed("docs/index.md", (body) => body + "\n[Use the AI manual](../harness/AGENTS.md)\n");
    const audience = run(fixture);
    assert.equal(audience.status, 1);
    assert.match(output(audience), /links to AI instructions/);
    git(fixture, ["restore", "."]);

    fs.unlinkSync(path.join(fixture, "docs/guides/lifecycle.md"));
    const missingPage = run(fixture);
    assert.equal(missingPage.status, 1);
    assert.match(output(missingPage), /Missing paired documentation: docs\/guides\/lifecycle\.md/);
  } finally {
    // mkdtemp supplies the exact owned root; never derive a delete target from repository input.
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith("doodlebot-docs-control-"));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("runnable human examples compile against the actual harness", () => {
  assert.deepEqual(checkExamples(root), []);
});

test("duplicate example filenames cannot hide an unchecked example", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-example-control-"));
  try {
    fs.mkdirSync(path.join(fixture, "harness"));
    fs.mkdirSync(path.join(fixture, "docs"));
    fs.writeFileSync(
      path.join(fixture, "harness/tsconfig.json"),
      '{"compilerOptions":{"strict":true}}',
    );
    for (const page of ["first.md", "second.md"])
      fs.writeFileSync(
        path.join(fixture, "docs", page),
        '```typescript title="duplicate.mts"\nconst value = 1;\n```\n',
      );
    assert.match(checkExamples(fixture)[0], /Duplicate runnable TypeScript filename duplicate.mts/);
  } finally {
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith("doodlebot-example-control-"));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test("example checking rejects an invented method on the human TypeScript API", () => {
  const file = "docs/getting-started/first-session.md";
  const original = extractExample(root, file, "first-test.mts");
  const code = original.replace("vortex.call", "vortex.inventedCall");
  assert.notEqual(code, original, "The control must actually change the example");
  assert.ok(
    checkExamples(root, { [file]: code }).some((message) => message.includes("inventedCall")),
  );
});

test("example checking rejects arguments that the real MCP schema would silently strip", () => {
  const file = "docs/guides/mod-workflows.md";
  const original = extractExample(root, file, "local-mod.mts");
  const code = original.replaceAll("expectedActiveProfileId:", "expectedActiveGameId:");
  assert.notEqual(code, original, "The control must actually change the example");
  assert.ok(
    checkExamples(root, { [file]: code }).some((message) =>
      message.includes("set_mods_enabled does not accept expectedActiveGameId"),
    ),
  );
});
