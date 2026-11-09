import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { requiredSections } from "./design";
import { REPO_ROOT } from "./paths";

const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), "utf8");

/** Frontmatter between the first two `---` lines, as exact `key: value` strings. */
function frontmatter(file: string): Record<string, string> {
  const lines = read(file).replace(/\r\n/g, "\n").split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw new Error(`${file} has no frontmatter`);
  return Object.fromEntries(
    lines
      .slice(1, end)
      .map((line) => /^(\w+):\s*(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => [match[1]!, match[2]!]),
  );
}

describe("EGM resources", () => {
  it("pins the EGM marketplace and enables the plugin for Claude Code", () => {
    expect(JSON.parse(read(".claude/settings.json"))).toEqual({
      extraKnownMarketplaces: {
        egm: {
          source: { source: "github", repo: "google/elephant-goldfish-model", ref: "v0.1.1" },
        },
      },
      enabledPlugins: { "egm@egm": true },
    });
  });

  it("gives the runtime Goldfish a read-only, instruction-free adapter with the persona's name", () => {
    const adapter = ".claude/agents/vortex-runtime-goldfish.md";
    expect(frontmatter(adapter)).toMatchObject({
      name: "vortex-runtime-goldfish",
      tools: "Read, Grep, Glob",
      model: "inherit",
      omitClaudeMd: "true",
    });
    expect(read(adapter)).toContain("harness/egm/vortex_runtime.md");
    expect(frontmatter("harness/egm/vortex_runtime.md").name).toBe("vortex-runtime-goldfish");
  });

  it("names every required section in the Vortex change standard", () => {
    const standard = read("harness/egm/vortex-change-standard.md");
    for (const section of requiredSections) expect(standard).toContain(section);
  });

  it("provides the Elephant procedure and points every agent at it", () => {
    expect(frontmatter(".claude/skills/vortex-elephant/SKILL.md").name).toBe("vortex-elephant");
    const agents = read("AGENTS.md");
    expect(agents).toContain("EGM artifact directory: harness/.artifacts/egm");
    expect(agents).toContain(".claude/skills/vortex-elephant/SKILL.md");
    expect(agents).toContain("harness/egm/vortex_runtime.md");
    const workflow = read("harness/AGENT-WORKFLOW.md");
    for (const file of [
      "harness/egm/vortex-change-standard.md",
      "harness/egm/vortex_runtime.md",
      ".claude/agents/vortex-runtime-goldfish.md",
      ".claude/skills/vortex-elephant/SKILL.md",
    ])
      expect(workflow).toContain(file);
  });

  it("documents EGM setup for each coding agent", () => {
    const guide = read("docs/guides/agent-plugins.md");
    for (const text of [
      "v0.1.1",
      "codex plugin marketplace add google/elephant-goldfish-model",
      "codex plugin add egm@egm",
      "2.1.271",
      "issues/237",
    ])
      expect(guide).toContain(text);
  });
});
