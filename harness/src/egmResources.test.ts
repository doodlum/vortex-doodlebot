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
  it("pins the EGM marketplace, registers this one and enables EGM and doodlebot", () => {
    expect(JSON.parse(read(".claude/settings.json"))).toEqual({
      extraKnownMarketplaces: {
        egm: {
          source: { source: "github", repo: "google/elephant-goldfish-model", ref: "v0.1.1" },
        },
        doodlebot: { source: { source: "directory", path: "." } },
      },
      enabledPlugins: {
        "egm@egm": true,
        "doodlebot@doodlebot": true,
      },
    });
  });

  it("gives the runtime Goldfish a read-only, instruction-free adapter with the persona's name", () => {
    const adapter = "plugins/doodlebot/agents/vortex-runtime-goldfish.md";
    expect(frontmatter(adapter)).toMatchObject({
      name: "vortex-runtime-goldfish",
      tools: "Read, Grep, Glob",
      model: "inherit",
      omitClaudeMd: "true",
    });
    expect(read(adapter)).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md");
    expect(frontmatter("plugins/doodlebot/resources/vortex_runtime.md").name).toBe(
      "vortex-runtime-goldfish",
    );
  });

  it("names every required section in the Vortex change standard", () => {
    const standard = read("plugins/doodlebot/resources/vortex-change-standard.md");
    for (const section of requiredSections) expect(standard).toContain(section);
  });

  it("provides the Elephant procedure and points every agent at it", () => {
    expect(frontmatter("plugins/doodlebot/skills/design/SKILL.md").name).toBe("design");
    const agents = read("AGENTS.md");
    expect(agents).toContain("EGM artifact directory: harness/.artifacts/egm");
    expect(agents).toContain("plugins/doodlebot/skills/design/SKILL.md");
    expect(agents).toContain("plugins/doodlebot/resources/vortex_runtime.md");
    expect(agents).toContain("plugins/doodlebot/agents/vortex-runtime-goldfish.md");
    const workflow = read("harness/AGENT-WORKFLOW.md");
    for (const file of [
      "plugins/doodlebot/resources/vortex-change-standard.md",
      "plugins/doodlebot/resources/vortex_runtime.md",
      "plugins/doodlebot/agents/vortex-runtime-goldfish.md",
      "plugins/doodlebot/skills/design/SKILL.md",
    ])
      expect(workflow).toContain(file);
  });

  it("documents EGM setup for each coding agent", () => {
    const guide = read("docs/get-started/install.md");
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
