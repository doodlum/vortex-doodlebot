import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
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
      model: "sonnet",
      omitClaudeMd: "true",
    });
    expect(read(adapter)).toContain("${CLAUDE_PLUGIN_ROOT}/resources/vortex_runtime.md");
    expect(frontmatter("plugins/doodlebot/resources/vortex_runtime.md").name).toBe(
      "vortex-runtime-goldfish",
    );
  });

  it("makes the Vortex change standard about runtime proof, not doodlebot's old design checks", () => {
    const standard = read("plugins/doodlebot/resources/vortex-change-standard.md");
    for (const text of ["Acceptance criteria with ids", "negative control", "File boundary"])
      expect(standard).toContain(text);
    for (const removed of ["design check", "readiness role", "readiness manifest", "sha256"])
      expect(standard).not.toContain(removed);
    expect(read("plugins/doodlebot/resources/vortex_runtime.md")).not.toContain("sha256");
  });

  it("leaves design to EGM: no design skill, and AGENTS.md gives the runtime review call", () => {
    expect(fs.existsSync(path.join(REPO_ROOT, "plugins/doodlebot/skills/design"))).toBe(false);
    const agents = read("AGENTS.md");
    for (const text of [
      "EGM artifact directory: harness/.artifacts/egm",
      "/egm:egm-review-loop",
      "plugins/doodlebot/resources/vortex_runtime.md",
      "plugins/doodlebot/resources/vortex-change-standard.md",
      "Direct Dispatch",
      "doodlebot:vortex-runtime-goldfish",
    ])
      expect(agents).toContain(text);
    // EGM's skills have disable-model-invocation: the person types them, from one pasted line.
    expect(agents).toContain("disable-model-invocation: true");
    const line = agents.split("\n").find((l) => l.trim().startsWith("/egm:egm-review-loop "));
    expect(line).toBeDefined();
    for (const argument of [
      "TargetFile:",
      "SemanticTarget: full file",
      "Reviewers:",
      "Standards:",
      "GoldfishContext:",
    ])
      expect(line).toContain(argument);
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
