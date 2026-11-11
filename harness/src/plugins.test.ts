import { execFileSync } from "node:child_process";
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

/** The one plugin, with the values the design fixes. Its skills are every command. */
const PLUGINS: Record<string, PluginSpec> = {
  doodlebot: {
    displayName: "Doodlebot",
    description:
      "The agent companion for Vortex: try things in a test Vortex, investigate and fix bugs, QA pull requests and releases, and measure builds.",
    // The eight commands of designs/companion-simplified.md 4.1, one per use case.
    skills: ["setup", "source", "try", "investigate", "fix", "qa", "measure", "pr"],
    shortDescription: "The agent companion for Vortex",
    capabilities: [
      "Try things in a test Vortex",
      "Investigate and fix Vortex bugs",
      "QA pull requests and releases",
      "Measure Vortex builds",
    ],
    defaultPrompt: [
      "Set up doodlebot on this machine.",
      "Try installing a mod in Vortex 2.8.0 and report.",
      "Is my branch slower than 2.8.0?",
    ],
  },
};
const ICON = "./assets/icon.png";

/** The commands the eight replaced (design 4.1); no text may name them as commands. */
const REMOVED_SKILLS = [
  "login",
  "baseline",
  "start",
  "stop",
  "status",
  "update",
  "drive",
  "ui-test",
  "compare",
  "design",
];

/** Skills that run only when the person asks (`disable-model-invocation: true`). */
const PERSON_ONLY = new Set(["setup", "measure"]);
/** Skills that take no input, so they carry no `argument-hint`. */
const NO_ARGUMENTS = new Set<string>();

const RUN_REPORT_SECTIONS = [
  "Outcome",
  "Tested against",
  "Scenario and target",
  "Steps",
  "Dialogs and prompts answered",
  "Errors and warnings",
  "Evidence",
  "Not checked",
  "Learned",
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
  "Learned",
];
/** The skills whose report is a markdown template; each must hold a `## Learned` heading. */
const REPORT_TEMPLATES = new Set(["try", "investigate", "qa", "measure"]);
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
/** Vortex branch names that look like a repository path: a design's sibling branch. */
const BRANCH_NAME = /^designs\/(?:<topic>|\*)$/;

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
        !BRANCH_NAME.test(token) &&
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
const agentFiles = markdownFiles("plugins/doodlebot/agents");

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
  it("lists the one plugin for Claude Code", () => {
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

  it("lists the one plugin for Codex", () => {
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
        icon: ICON,
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
          brandColor: "#FF8B24",
          composerIcon: ICON,
          logo: ICON,
        },
      });
    });

    it(`${name}: ships its icon as a square PNG`, () => {
      const png = fs.readFileSync(path.join(REPO_ROOT, `plugins/${name}`, ICON));
      expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
      const width = png.readUInt32BE(16);
      expect(width).toBe(png.readUInt32BE(20));
      expect(width).toBeGreaterThanOrEqual(256);
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

  it("gives every skill a unique name", () => {
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
        expect(text).toContain("/doodlebot:setup --update");
      });

    // learned-section (4.9): every command's report ends with what it learned, and no command
    // patches the kit mid-task.
    if (skill !== "setup")
      it(`${plugin}:${skill} ends its report with a Learned section and never patches the kit`, () => {
        const text = body(read(file));
        expect(text).toMatch(/\bLearned\b/);
        // A report template (a fenced markdown block) has the section as a heading of its own.
        const templates = [...text.matchAll(/```markdown\n([\s\S]*?)\n```/g)].map((m) => m[1]!);
        if (REPORT_TEMPLATES.has(skill)) {
          expect(templates.length, skill).toBeGreaterThan(0);
          for (const template of templates) expect(template, skill).toMatch(/^## Learned$/m);
        }
        expect(text).toContain("${CLAUDE_PLUGIN_ROOT}/resources/knowledge.md");
        expect(text).toContain("doodlebot gap add");
        expect(text.replace(/\s+/g, " ")).toMatch(/[Nn]ever patch the doodlebot workspace/);
      });
  }

  it("gives setup its four modes, and --check runs the read-only status table", () => {
    const setup = read(skillFile("doodlebot", "setup"));
    for (const mode of [
      "## Mode `setup`",
      "## Mode `--check`",
      "## Mode `--login`",
      "## Mode `--update [<ref>]`",
    ])
      expect(setup).toContain(mode);
    const uses = commandUses(setup).map((use) => use.text);
    expect(uses).toContain("doodlebot check");
    expect(uses).toContain("doodlebot game folder <dir>");
    expect(uses).toContain("doodlebot setup --oauth <target> --no-wait");
    expect(uses).toContain("doodlebot update --ref <ref>");
  });

  it("names the legacy lease store in the setup skill", () => {
    const setup = read(skillFile("doodlebot", "setup"));
    expect(setup).toContain("Legacy lease store");
    expect(setup).toContain("~/.vortex-ai/leases");
  });

  it("defines the run report in the try skill, with Tested against and Learned", () => {
    const tryText = read(skillFile("doodlebot", "try"));
    for (const section of RUN_REPORT_SECTIONS) expect(tryText).toContain(`\n## ${section}\n`);
    expect(tryText).toContain("doodlebot:vortex-driver");
    // The content choice is read from the kit, never re-derived (inventory --need, qa list).
    expect(tryText).toContain("doodlebot inventory --need <need>");
    expect(tryText).toContain("doodlebot qa list --json");
    expect(read(skillFile("doodlebot", "qa"))).toContain("doodlebot:vortex-driver");
    // release-version-reported: the report gives the Vortex version that ran, and a version
    // other than the one asked for is a mismatch.
    const testedAgainst = /\n## Tested against\n\n([\s\S]*?)\n## /.exec(tryText)?.[1] ?? "";
    expect(testedAgainst).toContain("Vortex <vortexVersion>");
    expect(tryText.replace(/\s+/g, " ")).toContain(
      "A `vortexVersion` that differs from the requested release is reported as a mismatch.",
    );
    expect(read("plugins/doodlebot/agents/vortex-driver.md")).toContain(
      "${CLAUDE_PLUGIN_ROOT}/skills/try/SKILL.md",
    );
  });

  it("reads the whole renderer console's errors and warnings and reports truncation", () => {
    const args = '`{"since":0,"levels":["error","warn"],"limit":500}`';
    for (const file of [
      skillFile("doodlebot", "try"),
      "plugins/doodlebot/agents/vortex-driver.md",
    ]) {
      const text = read(file).replace(/\s+/g, " ");
      expect(text, file).toContain(args);
      expect(text, file).toContain("truncated");
      expect(text, file).toContain("`lastSeq` is above 500");
      expect(text, file).not.toContain('{"since": 0}`');
    }
  });

  it("logout-needs-go-ahead: try and qa run a logout only with the person's go-ahead", () => {
    const tryText = read(skillFile("doodlebot", "try")).replace(/\s+/g, " ");
    expect(tryText).toContain('"ends the login"');
    expect(tryText).toContain("person's go-ahead");
    expect(tryText).toContain("/doodlebot:setup --login");
    const qa = read(skillFile("doodlebot", "qa")).replace(/\s+/g, " ");
    expect(qa).toContain('`account: "logout"`');
    expect(qa).toContain(
      "unless you pass `--allow-logout`, which you do only when the person named it and gave their go-ahead",
    );
  });

  it("try and qa record the kit gaps the driver proposes, and qa reports workarounds", () => {
    for (const skill of ["try", "qa"]) {
      const text = read(skillFile("doodlebot", skill)).replace(/\s+/g, " ");
      expect(text, skill).toContain("doodlebot gap add --title <t> --command <c>");
      expect(text, skill).toMatch(/proposes? kit gaps|kit gaps it proposes/);
    }
    const qa = read(skillFile("doodlebot", "qa"));
    expect(qa).toMatch(/\| Result \([^)]*passed with workaround: <x>/);
    expect(qa).toContain("**passed with workaround: <x>**");
  });

  it("stops only a test Vortex this session started, read from the instance record", () => {
    for (const skill of ["qa", "setup"]) {
      const text = read(skillFile("doodlebot", skill)).replace(/\s+/g, " ");
      expect(text, skill).toContain("~/.doodlebot/instance.json");
      expect(text, skill).toMatch(/this session started/);
      expect(text, skill).not.toMatch(
        /ask whether to stop (?:that|the) test Vortex; run `doodlebot down` on a yes/,
      );
    }
  });

  it("qa and investigate put .vortex-src back, and qa fetches upstream before the merge-base", () => {
    const qa = read(skillFile("doodlebot", "qa")).replace(/\s+/g, " ");
    expect(qa.indexOf("git -C <checkout> fetch upstream`")).toBeGreaterThan(-1);
    expect(qa.indexOf("git -C <checkout> fetch upstream`")).toBeLessThan(
      qa.indexOf("git -C <checkout> merge-base upstream/master qa/<pr>"),
    );
    expect(qa).toContain("**Put the checkout back.**");
    const investigate = read(skillFile("doodlebot", "investigate")).replace(/\s+/g, " ");
    expect(investigate).toContain(
      "put it back: `git -C <workspace>/.vortex-src switch <that branch>`",
    );
  });

  it("investigate changes no code and never calls a different version not reproduced", () => {
    const text = read(skillFile("doodlebot", "investigate")).replace(/\s+/g, " ");
    expect(text).toContain("You change no code");
    expect(text).toContain("doodlebot release get <version>");
    expect(text).toContain("not reproduced on the user's version");
    expect(text).toContain("blocked: the release publishes no digest");
  });

  it("fix puts the regression test in the Vortex branch and uses the testing procedure", () => {
    const text = read(skillFile("doodlebot", "fix")).replace(/\s+/g, " ");
    expect(text).toContain("${CLAUDE_PLUGIN_ROOT}/resources/testing.md");
    expect(text).toContain("regression test **in the Vortex branch**");
    expect(text).toContain("Revert control");
    expect(text).toContain("/doodlebot:pr");
  });

  it("qa compares base and PR builds, checks designs and releases, and posts only when told", () => {
    const text = read(skillFile("doodlebot", "qa")).replace(/\s+/g, " ");
    for (const phrase of [
      "--design <file>",
      "--release <version>",
      "not proved by this PR",
      "**regression**",
      "**fixed**",
      "**failing on both**",
      "no previous result",
      "Files no entry guards",
      "only when the person says so",
      "Go ahead?",
      "must be clean",
    ])
      expect(text).toContain(phrase);
  });

  it("pr opens the PR from the session's branch, pushed through the fork check", () => {
    const text = read(skillFile("doodlebot", "pr"));
    const uses = commandUses(text).map((use) => use.text);
    expect(uses).toContain("doodlebot push-branch --checkout <checkout>");
    expect(uses).toContain(
      "doodlebot pr-preflight --checkout <checkout> --base upstream/master --test <test> --revert <file>",
    );
    expect(uses.some((use) => use.startsWith("doodlebot pr-checks <number>"))).toBe(true);
    const flat = text.replace(/\s+/g, " ");
    // pr-from-session-branch: the PR's head is the session's branch, a draft by default, in
    // the fork or Nexus-Mods/Vortex as the person says, bound on Claude desktop.
    expect(flat).toContain("--head <fork owner>:<branch> --draft");
    expect(flat).toContain(
      "Open the pull request in your fork (<fork>), or against Nexus-Mods/Vortex?",
    );
    expect(flat).toContain("`bind_pr`");
    // The design is linked at its approved commit on designs/<topic>, never carried.
    expect(flat).toContain("Design approved by <owner> on <date>");
    expect(flat).toContain("<fork>/blob/<sha>/docs/designs/<topic>.md");
    expect(flat).toContain("**A `proto/*` branch is refused**");
    expect(text).not.toMatch(/pr-branch|(?<!\/)pr\/<topic>|design\/<topic>/);
  });

  it("defines the benchmark report in measure, with a Verdict only for two builds", () => {
    const measure = read(skillFile("doodlebot", "measure"));
    for (const section of BENCHMARK_REPORT_SECTIONS) expect(measure).toContain(`\n## ${section}\n`);
    expect(measure).toContain("--a <build> [--b <build>] --check <check>");
    expect(measure.replace(/\s+/g, " ")).toContain("With one build there is no Verdict section");
  });

  it("measure holds the per-run sequence and the run-outcome rules", () => {
    const text = read(skillFile("doodlebot", "measure"));
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

describe("eight-commands: no text names a removed command", () => {
  // Historic designs record what was removed; this test names them itself.
  const exempt = (file: string): boolean =>
    file.startsWith("designs/") ||
    file === "harness/src/plugins.test.ts" ||
    file === "harness/src/companion.test.ts";

  it("finds /doodlebot:<removed> nowhere in the repository", () => {
    const files = execFileSync(
      "git",
      ["-C", REPO_ROOT, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
    )
      .split("\0")
      .filter((file) => /\.(?:md|ts|cjs|js|json|yml|yaml)$/.test(file) && !exempt(file))
      .filter((file) => fs.existsSync(path.join(REPO_ROOT, file)));
    const pattern = new RegExp(`/doodlebot:(?:${REMOVED_SKILLS.join("|")})(?![\\w-])`);
    const hits = files.flatMap((file) =>
      read(file)
        .split("\n")
        .flatMap((line, i) =>
          pattern.test(line) ? [`${file}:${String(i + 1)}: ${line.trim()}`] : [],
        ),
    );
    expect(hits).toEqual([]);
  });
});

describe("agents", () => {
  it("ships exactly the runtime Goldfish and the driver", () => {
    expect(agentFiles).toEqual([
      "plugins/doodlebot/agents/vortex-driver.md",
      "plugins/doodlebot/agents/vortex-runtime-goldfish.md",
    ]);
  });

  it("keeps the runtime Goldfish read-only and pointed at its persona and standard", () => {
    const adapter = read("plugins/doodlebot/agents/vortex-runtime-goldfish.md");
    expect(frontmatter(adapter)).toMatchObject({
      name: "vortex-runtime-goldfish",
      tools: "Read, Grep, Glob",
      model: "sonnet",
      omitClaudeMd: "true",
    });
    expect(adapter).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md");
    expect(adapter).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex-change-standard.md");
    expect(frontmatter(read("plugins/doodlebot/resources/vortex_runtime.md")).name).toBe(
      "vortex-runtime-goldfish",
    );
  });

  it("runs the driver on Sonnet with the CLI tools", () => {
    expect(frontmatter(read("plugins/doodlebot/agents/vortex-driver.md"))).toMatchObject({
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
      "  doodlebot knowledge search <words>",
      "$x = doodlebot down",
      "```",
    ].join("\n");
    expect(commandUses(sample).map(({ command, word }) => [command, word])).toEqual([
      ["up", undefined],
      ["knowledge", "search"],
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
      "```\ndoodlebot knowledge search <workspace>/designs/x.md\n```",
      "```\ndoodlebot knowledge search designs/x.md\n```",
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
    // A design's sibling branch is a Vortex branch name, not a doodlebot path.
    expect(pathTokenViolations("`designs/<topic>` and `designs/*`")).toEqual([]);
    expect(pathTokenViolations("`designs/x.md`")).toHaveLength(1);
  });

  it("names only plugin resources that exist", () => {
    const named = [...allSkills.map(({ file }) => file), ...agentFiles].flatMap((file) =>
      [...read(file).matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(resources\/[\w./-]*[\w-])/g)].map(
        (match) => ({ file, resource: match[1]! }),
      ),
    );
    expect(named.map(({ resource }) => resource)).toContain("resources/knowledge.md");
    expect(
      named
        .filter(
          ({ resource }) => !fs.existsSync(path.join(REPO_ROOT, "plugins/doodlebot", resource)),
        )
        .map(({ file, resource }) => `${file}: ${resource}`),
    ).toEqual([]);
  });

  it("writes every repository path as <workspace>/ or ${CLAUDE_PLUGIN_ROOT}/", () => {
    const problems = [...allSkills.map(({ file }) => file), ...agentFiles].flatMap((file) =>
      pathTokenViolations(body(read(file))).map((token) => `${file}: ${token}`),
    );
    expect(problems).toEqual([]);
  });
});
