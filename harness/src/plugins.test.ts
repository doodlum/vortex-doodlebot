import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./paths";

const read = (file: string): string =>
  fs.readFileSync(path.join(REPO_ROOT, file), "utf8").replace(/\r\n/g, "\n");
const json = (file: string): Record<string, unknown> =>
  JSON.parse(read(file)) as Record<string, unknown>;

const AUTHOR = { name: "doodlum" };
const HOMEPAGE = "https://doodlum.github.io/vortex-doodlebot/";
const REPOSITORY = "https://github.com/doodlum/vortex-doodlebot";
const LICENSE = "GPL-3.0-only";

interface PluginSpec {
  displayName: string;
  description: string;
  skills: string[];
  shortDescription: string;
  capabilities: string[];
  defaultPrompt: string[];
}

/** The three plugins, in marketplace order, with the values the design fixes. */
const PLUGINS: Record<string, PluginSpec> = {
  doodlebot: {
    displayName: "Doodlebot",
    description: "Set up doodlebot and run its isolated test copy of Vortex.",
    skills: ["setup", "login", "baseline", "start", "stop", "status", "update", "source"],
    shortDescription: "Set up and run a test copy of Vortex",
    capabilities: [
      "Set up the companion",
      "Sign in to Nexus Mods",
      "Start and stop the test Vortex",
    ],
    defaultPrompt: [
      "Set up doodlebot on this machine.",
      "Is doodlebot ready?",
      "Start the test Vortex with the sandbox game.",
    ],
  },
  vortex: {
    displayName: "Vortex",
    description: "Fix, design, drive and check Vortex changes with doodlebot.",
    skills: ["design", "fix", "drive", "qa", "ui-test", "pr"],
    shortDescription: "Fix, design and check Vortex changes",
    capabilities: ["Reproduce and fix bugs", "Design features with EGM", "Drive Vortex and report"],
    defaultPrompt: [
      "Reproduce this Vortex bug.",
      "Check that installing a mod works and report.",
      "Prepare a pull request for my Vortex branch.",
    ],
  },
  benchmark: {
    displayName: "Benchmark",
    description: "Measure Vortex performance and compare two Vortex builds.",
    skills: ["measure", "compare"],
    shortDescription: "Measure and compare Vortex performance",
    capabilities: ["Measure a flow", "Compare two Vortex versions", "Explain the difference"],
    defaultPrompt: [
      "How fast is the Mods table with 3,000 mods?",
      "Compare 2.8.0 with my branch.",
      "Is my change slower?",
    ],
  },
};

/** Skills that run only when the person asks (`disable-model-invocation: true`). */
const PERSON_ONLY = new Set(["setup", "update", "stop", "baseline", "measure", "compare"]);
/** Skills that take no input, so they carry no `argument-hint`. */
const NO_ARGUMENTS = new Set(["stop"]);

const RUN_REPORT_SECTIONS = [
  "Outcome",
  "Scenario and target",
  "Steps",
  "Dialogs and prompts answered",
  "Errors and warnings",
  "Evidence",
  "Not checked",
];
const BENCHMARK_REPORT_SECTIONS = [
  "Question",
  "Builds",
  "Measurement",
  "Conditions",
  "Results",
  "Verdict",
  "Evidence",
  "Caveats",
];
const RUN_SEQUENCE = [
  "doodlebot up",
  "doodlebot call automation_status",
  "doodlebot test",
  "doodlebot down",
];
const RUN_OUTCOMES = [
  "A run whose check exits 1 after writing evidence (a budget failure) counts, and its failures are listed.",
  "A run with no evidence is failed and not counted.",
  "A side with fewer than three counted runs makes the report _Blocked_.",
];

/** Frontmatter between the first two `---` lines, as `key: value` strings, quotes removed. */
function frontmatter(text: string): Record<string, string> {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw new Error("no frontmatter");
  return Object.fromEntries(
    lines
      .slice(1, end)
      .map((line) => /^([\w-]+):\s*(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, match[2]!.replace(/^"(.*)"$/, "$1")]),
  );
}

/** The text after the frontmatter. */
function body(text: string): string {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  return lines.slice(end + 1).join("\n");
}

/** Inline code spans outside fenced blocks (whitespace collapsed) and fenced-block lines. */
function codeOf(markdown: string): { spans: string[]; fenceLines: string[] } {
  const fenceLines: string[] = [];
  const prose: string[] = [];
  let fenced = false;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      prose.push("");
      continue;
    }
    (fenced ? fenceLines : prose).push(line);
  }
  const spans = [...prose.join("\n").matchAll(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)].map(
    (match) => match[2]!.replace(/\s+/g, " ").trim(),
  );
  return { spans, fenceLines };
}

/** `doodlebot <command> [<word>]` uses in code: spans and fenced lines that begin with it. */
function commandUses(markdown: string): { text: string; command: string; word?: string }[] {
  const { spans, fenceLines } = codeOf(markdown);
  return [...spans, ...fenceLines.map((line) => line.trimStart())]
    .filter((text) => text.startsWith("doodlebot "))
    .map((text) => ({
      text,
      match: /^doodlebot ([a-z][a-z0-9-]*)( ([a-z][a-z0-9-]*))?/.exec(text),
    }))
    .filter((use): use is { text: string; match: RegExpExecArray } => use.match !== null)
    .map(({ text, match }) => ({ text, command: match[1]!, word: match[3] }));
}

const REPO_SEGMENT = /(^|\/)(harness|designs)\/|(^|\/)\.vortex-src(\/|$)/;

/**
 * Code tokens holding a repository path (a `harness/`, `designs/` or `.vortex-src` segment)
 * that do not start with `<workspace>/` or `${CLAUDE_PLUGIN_ROOT}/`. Tokens are split on
 * whitespace with quotes stripped; `--x=value` checks its value; the arguments after
 * `doodlebot test <suite>` are the suite's own and exempt.
 */
function pathTokenViolations(markdown: string): string[] {
  const { spans, fenceLines } = codeOf(markdown);
  const violations: string[] = [];
  for (const text of [...spans, ...fenceLines]) {
    const tokens = text.trim().split(/\s+/);
    const suite = tokens.findIndex(
      (token, i) =>
        token === "doodlebot" && tokens[i + 1] === "test" && /^[a-z]/.test(tokens[i + 2] ?? ""),
    );
    const exemptFrom = suite === -1 ? tokens.length : suite + 3;
    tokens.slice(0, exemptFrom).forEach((raw) => {
      let token = raw.replace(/^["'`(]+|["'`),;]+$/g, "");
      const assigned = /^--[\w-]+=(.*)$/.exec(token);
      if (assigned) token = assigned[1]!.replace(/^["']+|["']+$/g, "");
      token = token.replace(/\\/g, "/");
      if (
        REPO_SEGMENT.test(token) &&
        !token.startsWith("<workspace>/") &&
        !token.startsWith("${CLAUDE_PLUGIN_ROOT}/")
      )
        violations.push(token);
    });
  }
  return violations;
}

function markdownFiles(dir: string): string[] {
  return fs
    .readdirSync(path.join(REPO_ROOT, dir), { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return markdownFiles(file);
      return entry.name.endsWith(".md") ? [file] : [];
    })
    .toSorted();
}

const skillFile = (plugin: string, skill: string): string =>
  `plugins/${plugin}/skills/${skill}/SKILL.md`;
const allSkills = Object.entries(PLUGINS).flatMap(([plugin, spec]) =>
  spec.skills.map((skill) => ({ plugin, skill, file: skillFile(plugin, skill) })),
);
const agentFiles = markdownFiles("plugins/vortex/agents");

/** Suite names from whatever list `testCommand.ts` exports (an array, object or map). */
function suiteNames(module: Record<string, unknown>): string[] {
  for (const value of Object.values(module)) {
    const names =
      value instanceof Map
        ? [...value.keys()]
        : Array.isArray(value)
          ? value.map((item: unknown) =>
              typeof item === "string"
                ? item
                : typeof item === "object" && item !== null && "name" in item
                  ? (item as { name: unknown }).name
                  : undefined,
            )
          : typeof value === "object" && value !== null
            ? Object.keys(value)
            : [];
    if (names.includes("core") && names.includes("mods-scroll"))
      return names.filter((name): name is string => typeof name === "string");
  }
  throw new Error("testCommand.ts exports no suite list containing core and mods-scroll");
}

describe("marketplaces", () => {
  it("lists the three plugins for Claude Code", () => {
    expect(json(".claude-plugin/marketplace.json")).toEqual({
      name: "doodlebot",
      owner: AUTHOR,
      plugins: Object.entries(PLUGINS).map(([name, spec]) => ({
        name,
        source: `./plugins/${name}`,
        description: spec.description,
      })),
    });
  });

  it("lists the three plugins for Codex", () => {
    expect(json(".agents/plugins/marketplace.json")).toEqual({
      name: "doodlebot",
      interface: { displayName: "Doodlebot" },
      plugins: Object.keys(PLUGINS).map((name) => ({
        name,
        source: `./plugins/${name}`,
        policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
        category: "Developer Tools",
      })),
    });
  });
});

describe("plugin manifests", () => {
  const version = (json("package.json") as { version: string }).version;

  it("uses the companion version 2.0.0 from package.json", () => {
    expect(version).toBe("2.0.0");
  });

  for (const [name, spec] of Object.entries(PLUGINS)) {
    it(`${name}: Claude manifest`, () => {
      // No `agents` field: Claude Code discovers the default agents/ folder itself.
      expect(json(`plugins/${name}/.claude-plugin/plugin.json`)).toEqual({
        name,
        displayName: spec.displayName,
        version,
        description: spec.description,
        author: AUTHOR,
        homepage: HOMEPAGE,
        repository: REPOSITORY,
        license: LICENSE,
      });
    });

    it(`${name}: Codex manifest`, () => {
      expect(json(`plugins/${name}/.codex-plugin/plugin.json`)).toEqual({
        name,
        version,
        description: spec.description,
        author: AUTHOR,
        homepage: HOMEPAGE,
        repository: REPOSITORY,
        license: LICENSE,
        skills: "./skills/",
        requires_local_executor: true,
        interface: {
          displayName: spec.displayName,
          shortDescription: spec.shortDescription,
          developerName: "doodlum",
          category: "Developer Tools",
          capabilities: spec.capabilities,
          defaultPrompt: spec.defaultPrompt,
        },
      });
    });
  }
});

describe("skills", () => {
  it("has exactly the designed skills in each plugin", () => {
    for (const [name, spec] of Object.entries(PLUGINS))
      expect(fs.readdirSync(path.join(REPO_ROOT, `plugins/${name}/skills`)).toSorted()).toEqual(
        [...spec.skills].toSorted(),
      );
  });

  it("gives every skill a unique name across the plugins", () => {
    const names = allSkills.map(({ file }) => frontmatter(read(file)).name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const { plugin, skill, file } of allSkills) {
    it(`${plugin}:${skill} frontmatter`, () => {
      const meta = frontmatter(read(file));
      expect(meta.name).toBe(skill);
      expect(meta.description).toMatch(new RegExp(`^${PLUGINS[plugin]!.displayName}: \\S`));
      if (NO_ARGUMENTS.has(skill)) expect(meta["argument-hint"]).toBeUndefined();
      else expect(meta["argument-hint"]?.length ?? 0).toBeGreaterThan(0);
      expect(meta["disable-model-invocation"]).toBe(PERSON_ONLY.has(skill) ? "true" : undefined);
    });

    if (skill !== "setup")
      it(`${plugin}:${skill} starts with the version check`, () => {
        const text = body(read(file));
        expect(commandUses(text)[0]?.text).toBe("doodlebot version --json");
        expect(text).toContain("/doodlebot:setup");
        expect(text).toContain("${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json");
        if (skill !== "update") expect(text).toContain("/doodlebot:update");
      });
  }

  it("names the legacy lease store in the setup skill", () => {
    const setup = read(skillFile("doodlebot", "setup"));
    expect(setup).toContain("Legacy lease store");
    expect(setup).toContain("~/.vortex-ai/leases");
  });

  it("defines the run report in the drive skill", () => {
    const drive = read(skillFile("vortex", "drive"));
    for (const section of RUN_REPORT_SECTIONS) expect(drive).toContain(`\n## ${section}\n`);
    expect(drive).toContain("vortex:vortex-driver");
    expect(read(skillFile("vortex", "qa"))).toContain("vortex:vortex-driver");
  });

  it("defines the benchmark report in measure (no verdict) and compare", () => {
    const compare = read(skillFile("benchmark", "compare"));
    for (const section of BENCHMARK_REPORT_SECTIONS) expect(compare).toContain(`\n## ${section}\n`);
    const measure = read(skillFile("benchmark", "measure"));
    for (const section of BENCHMARK_REPORT_SECTIONS.filter((s) => s !== "Verdict"))
      expect(measure).toContain(`\n## ${section}\n`);
    expect(measure).not.toContain("\n## Verdict\n");
  });

  for (const skill of ["measure", "compare"])
    it(`${skill} holds the per-run sequence and the run-outcome rules`, () => {
      const text = read(skillFile("benchmark", skill));
      const run = text.slice(text.indexOf("Each run is"));
      const uses = commandUses(run).map((use) => use.text);
      let from = 0;
      for (const prefix of RUN_SEQUENCE) {
        const at = uses.findIndex((use, i) => i >= from && use.startsWith(prefix));
        expect(at, `${prefix} after step ${String(from)}`).toBeGreaterThanOrEqual(0);
        from = at + 1;
      }
      const flat = text.replace(/\s+/g, " ");
      for (const sentence of RUN_OUTCOMES) expect(flat).toContain(sentence);
    });
});

describe("agents", () => {
  it("ships exactly the runtime Goldfish and the driver", () => {
    expect(agentFiles).toEqual([
      "plugins/vortex/agents/vortex-driver.md",
      "plugins/vortex/agents/vortex-runtime-goldfish.md",
    ]);
  });

  it("keeps the runtime Goldfish read-only and pointed at its persona and standard", () => {
    const adapter = read("plugins/vortex/agents/vortex-runtime-goldfish.md");
    expect(frontmatter(adapter)).toMatchObject({
      name: "vortex-runtime-goldfish",
      tools: "Read, Grep, Glob",
      model: "inherit",
      omitClaudeMd: "true",
    });
    expect(adapter).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md");
    expect(adapter).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex-change-standard.md");
    expect(frontmatter(read("plugins/vortex/resources/vortex_runtime.md")).name).toBe(
      "vortex-runtime-goldfish",
    );
  });

  it("runs the driver on Sonnet with the CLI tools", () => {
    expect(frontmatter(read("plugins/vortex/agents/vortex-driver.md"))).toMatchObject({
      name: "vortex-driver",
      model: "sonnet",
      tools: "Bash, PowerShell, Read, Write, Grep, Glob",
    });
  });
});

describe("doodlebot commands named in the plugins", () => {
  it("takes commands only from code, never from prose", () => {
    const sample = [
      "Run doodlebot frobnicate in prose.",
      "Use `doodlebot up --sandbox`, not `doodlebot <command>`.",
      "```powershell",
      "  doodlebot design check <file>",
      "$x = doodlebot down",
      "```",
    ].join("\n");
    expect(commandUses(sample).map(({ command, word }) => [command, word])).toEqual([
      ["up", undefined],
      ["design", "check"],
    ]);
  });

  it("names only commands, sub-commands and suites the CLI has", async () => {
    const { commands } = await import("./commands");
    const suites = suiteNames((await import("./testCommand")) as Record<string, unknown>);
    const known = new Map<string, string[] | undefined>(
      commands.map((entry: { name: string; subcommands?: string[] }) => [
        entry.name,
        entry.subcommands,
      ]),
    );
    const problems: string[] = [];
    for (const file of markdownFiles("plugins"))
      for (const { text, command, word } of commandUses(read(file))) {
        if (command === "help") continue;
        if (!known.has(command)) problems.push(`${file}: unknown command in "${text}"`);
        const subcommands = known.get(command);
        if (subcommands && (word === undefined || !subcommands.includes(word)))
          problems.push(`${file}: unknown ${command} sub-command in "${text}"`);
        if (command === "test" && word !== undefined && !suites.includes(word))
          problems.push(`${file}: unknown suite in "${text}"`);
      }
    expect(problems).toEqual([]);
  });
});

describe("workspace paths in plugin skills and agents", () => {
  it.each([
    ["an inline span", "Read `<workspace>/harness/AGENTS.md`.", "Read `harness/AGENTS.md`."],
    [
      "a fenced token",
      "```\ndoodlebot design check <workspace>/designs/x.md\n```",
      "```\ndoodlebot design check designs/x.md\n```",
    ],
    [
      "a quoted token",
      '```\n$log = "<workspace>/harness/.artifacts/runs/a.log"\n```',
      "```\n$log = 'harness/.artifacts/runs/a.log'\n```",
    ],
    [
      "a --x=value token",
      "`doodlebot up --dev-dir=<workspace>/.vortex-src`",
      "`doodlebot up --dev-dir=.vortex-src`",
    ],
    [
      "a plugin resource",
      "`${CLAUDE_PLUGIN_ROOT}/resources/harness/x.md`",
      "`resources/harness/x.md`",
    ],
  ])("checks %s", (_form, good, bad) => {
    expect(pathTokenViolations(good)).toEqual([]);
    expect(pathTokenViolations(bad)).toHaveLength(1);
  });

  it("exempts the arguments after doodlebot test <suite>, and nothing else", () => {
    expect(pathTokenViolations("`doodlebot test core harness/src/tests/a.spec.ts`")).toEqual([]);
    expect(pathTokenViolations("`doodlebot up harness/src/tests/a.spec.ts`")).toHaveLength(1);
    expect(pathTokenViolations("See harness/AGENTS.md in prose.")).toEqual([]);
  });

  it("writes every repository path as <workspace>/ or ${CLAUDE_PLUGIN_ROOT}/", () => {
    const problems = [...allSkills.map(({ file }) => file), ...agentFiles].flatMap((file) =>
      pathTokenViolations(body(read(file))).map((token) => `${file}: ${token}`),
    );
    expect(problems).toEqual([]);
  });
});
