const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");
const { test } = require("node:test");

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
const output = (result) => result.stdout + result.stderr;

// A synthetic repository holding the sources docs.cjs reads, generated and committed as a
// clean baseline, so a case can change it and run the real checker against it.
function withFixture(prefix, body) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const changed = (file, transform) =>
    fs.writeFileSync(
      path.join(fixture, file),
      transform(fs.readFileSync(path.join(fixture, file), "utf8")),
    );
  try {
    for (const file of [
      "src",
      "harness/src",
      "plugins",
      ".claude-plugin",
      "mkdocs.yml",
      "docs",
      "harness/reference",
      "harness/qa",
      "scripts/documentation-map.json",
      "package.json",
      "AGENTS.md",
      "ARCHITECTURE.md",
      "KNOWLEDGE.md",
      "harness/AGENTS.md",
      "harness/TESTING.md",
      "harness/PULL-REQUESTS.md",
    ]) {
      fs.mkdirSync(path.dirname(path.join(fixture, file)), { recursive: true });
      fs.cpSync(path.join(root, file), path.join(fixture, file), { recursive: true });
    }
    git(fixture, ["init", "--quiet"]);
    git(fixture, ["config", "user.name", "Documentation control"]);
    git(fixture, ["config", "user.email", "docs-control@example.invalid"]);
    const generated = run(fixture, ["--write"]);
    assert.equal(generated.status, 0, output(generated));
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "synthetic baseline"]);
    const baseline = git(fixture, ["rev-parse", "HEAD"]).toString().trim();
    const clean = run(fixture);
    assert.equal(clean.status, 0, output(clean));
    body({ fixture, changed, baseline });
  } finally {
    // mkdtemp supplies the exact owned root; never derive a delete target from repository input.
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith(prefix));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

test("paired documentation refuses drift and missing companions", () => {
  withFixture("doodlebot-docs-control-", ({ fixture, changed, baseline }) => {
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

    // bootstrap.ts is both a lifecycle source and harness implementation, so the paired
    // change updates a human page of each group.
    changed("harness/src/bootstrap.ts", (body) => body + "\n// Synthetic lifecycle change.\n");
    changed("harness/AGENTS.md", (body) => body + "\nSynthetic AI companion.\n");
    const missingHuman = run(fixture);
    assert.equal(missingHuman.status, 1);
    assert.match(output(missingHuman), /Lifecycle and authentication: update a mapped human page/);
    changed("docs/concepts/one-test-vortex.md", (body) => body + "\nSynthetic human companion.\n");
    changed("docs/concepts/how-it-works.md", (body) => body + "\nSynthetic human companion.\n");
    const paired = run(fixture);
    assert.equal(paired.status, 0, output(paired));
    git(fixture, ["add", "."]);
    git(fixture, ["commit", "--quiet", "-m", "paired synthetic change"]);
    const committed = run(fixture, [], { DOODLEBOT_DOCS_BASE: baseline });
    assert.equal(committed.status, 0, output(committed));
    git(fixture, ["reset", "--hard", "--quiet", baseline]);

    changed("harness/src/bootstrap.ts", (body) => body + "\n// Synthetic lifecycle change.\n");
    changed("docs/concepts/one-test-vortex.md", (body) => body + "\nSynthetic human companion.\n");
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

    fs.unlinkSync(path.join(fixture, "docs/get-started/set-up.md"));
    const missingPage = run(fixture);
    assert.equal(missingPage.status, 1);
    assert.match(
      output(missingPage),
      /Missing paired documentation: docs\/get-started\/set-up\.md/,
    );
  });
});

// The pages mkdocs.yml's nav lists, read as text with no YAML parser: list items naming a
// Markdown file after `nav:` and before the next top-level key, relative to docs_dir.
function navPages(mkdocs) {
  const pages = [];
  let inNav = false;
  for (const line of mkdocs.replace(/\r\n/g, "\n").split("\n")) {
    if (/^nav:\s*$/.test(line)) {
      inNav = true;
      continue;
    }
    if (inNav && /^\S/.test(line)) break;
    if (!inNav) continue;
    const match = /^\s*- .*?:\s*(\S+\.md)\s*$/.exec(line) ?? /^\s*- (\S+\.md)\s*$/.exec(line);
    if (match) pages.push("docs/" + match[1]);
  }
  return pages.sort();
}

function sitePages(docsRoot) {
  const walk = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );
  return walk(path.join(docsRoot, "docs"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.relative(docsRoot, file).split(path.sep).join("/"))
    .filter((file) => !file.startsWith("docs/theme/") && !file.startsWith("docs/stylesheets/"))
    .sort();
}

test("the site navigation lists every documentation page", () => {
  const nav = navPages(fs.readFileSync(path.join(root, "mkdocs.yml"), "utf8"));
  assert.ok(nav.length > 0, "mkdocs.yml has no nav pages");
  assert.equal(new Set(nav).size, nav.length, "a page is listed twice in the nav");
  assert.deepEqual(nav, sitePages(root));
  // The parser must actually see both item forms and stop at the next top-level key.
  assert.deepEqual(
    navPages("nav:\n  - Home: index.md\n  - Group:\n      - extra.md\nplugins:\n  - other.md\n"),
    ["docs/extra.md", "docs/index.md"],
  );
});

test("a stale commands reference fails the check", () => {
  withFixture("doodlebot-docs-commands-", ({ fixture, changed }) => {
    const commands = fs.readFileSync(path.join(fixture, "docs/reference/commands.md"), "utf8");
    assert.match(
      commands,
      /## Set up and run the test Vortex[\s\S]*## Work on Vortex[\s\S]*## Benchmark/,
    );
    assert.match(commands, /\| `\/doodlebot:setup` +\|/);
    assert.match(commands, /\| `\/doodlebot:try` +\| [^|]+\| <code>[^|]+<\/code> +\|/);
    assert.ok(!/\| Doodlebot: /.test(commands), "the plugin prefix is removed");

    const skill = "plugins/doodlebot/skills/fix/SKILL.md";
    changed(skill, (body) =>
      body.replace(/^description: "Doodlebot: /m, 'description: "Doodlebot: Synthetically '),
    );
    const stale = run(fixture);
    assert.equal(stale.status, 1);
    assert.match(output(stale), /docs\/reference\/commands\.md is stale/);
    const regenerated = run(fixture, ["--write"]);
    assert.equal(regenerated.status, 0, output(regenerated));
    assert.match(
      fs.readFileSync(path.join(fixture, "docs/reference/commands.md"), "utf8"),
      /\| `\/doodlebot:fix` +\| Synthetically /,
    );
    git(fixture, ["restore", "."]);

    // A skill missing from COMMAND_GROUPS cannot be silently left out of the reference.
    const extra = path.join(fixture, "plugins/doodlebot/skills/docs-control");
    fs.mkdirSync(extra);
    fs.writeFileSync(
      path.join(extra, "SKILL.md"),
      '---\nname: docs-control\ndescription: "Doodlebot: Synthetic."\n---\n',
    );
    const unordered = run(fixture);
    assert.notEqual(unordered.status, 0);
    assert.match(output(unordered), /Skills of plugin doodlebot .* differ from COMMAND_GROUPS/);
  });
});
