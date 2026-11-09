import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { designContentSha256, designTemplate } from "./design";
import { designCommand } from "./designCommand";
import { ConfigError } from "./errors";

const today = () => "2026-01-02";

// Real git repositories: allow for a loaded machine, as the other checkout-backed suites do.
describe("design command", { timeout: 60_000 }, () => {
  let repo: string;
  let base: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", windowsHide: true }).trim();
  const write = (file: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), text);
  };

  /** A complete design whose boundary is `src/in.ts`, approved for its own content. */
  function approvedDesign(): string {
    const draft = designTemplate("Scoped change", "doodlebot", "2026-01-01")
      .replace("## Acceptance Criteria\n", "## Acceptance Criteria\n\n- `works`: It works.\n")
      .replace("## Affected Contracts\n", "## Affected Contracts\n\n- None: tests only.\n")
      .replace("- `designs/SITEMAP.md`", "- `designs/SITEMAP.md`\n- `src/in.ts`");
    return draft.replace(
      "- **Status:** Draft",
      `- **Status:** Approved\n- **Approved:** Person; content ${designContentSha256(draft)}; https://example.test/ok`,
    );
  }

  beforeEach(() => {
    repo = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "design-command-")));
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    write("src/in.ts", "export const a = 1;\n");
    write("src/out.ts", "export const b = 1;\n");
    git("add", ".");
    git("-c", "user.name=test", "-c", "user.email=test@example.test", "commit", "-qm", "base");
    base = git("rev-parse", "HEAD");
  });
  afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("writes the template and refuses to overwrite or run without its flags", () => {
    const file = path.join(repo, "designs", "new", "feature.md");
    expect(designCommand(["new", file], { title: "Feature", target: "vortex" }, today)).toEqual({
      code: 0,
      stdout: `Wrote ${file}`,
    });
    expect(fs.readFileSync(file, "utf8")).toBe(designTemplate("Feature", "vortex", "2026-01-02"));
    expect(() => designCommand(["new", file], { title: "F", target: "vortex" }, today)).toThrow(
      `${file} already exists.`,
    );
    expect(() => designCommand(["new", file], { target: "vortex" }, today)).toThrow(
      "design new needs --title.",
    );
    expect(() => designCommand(["new", file], { title: "F", target: "game" }, today)).toThrow(
      "design new needs --target vortex or doodlebot.",
    );
  });

  it("checks a design in text and JSON, with and without --ready", () => {
    const file = path.join(repo, "designs", "d.md");
    write("designs/d.md", designTemplate("T", "vortex", "2026-01-01"));
    const text = designCommand(["check", file], {}, today);
    expect(text.code).toBe(1);
    expect(text.stdout.split("\n")).toEqual([
      `ISSUES ${file}`,
      "no acceptance criteria",
      "no affected contracts declared",
      "empty file boundary",
      `content sha256: ${designContentSha256(fs.readFileSync(file, "utf8"))}`,
    ]);
    write("designs/d.md", approvedDesign());
    const json = JSON.parse(designCommand(["check", file], { json: true }, today).stdout);
    expect(json).toMatchObject({ file, issues: [] });
    const open = approvedDesign()
      .replace(/- \*\*Status:\*\* Approved\n- \*\*Approved:\*\*[^\n]*/, "- **Status:** In Review")
      .replace("## Open Questions\n\nNone.", "## Open Questions\n\n- Which port?");
    write("designs/d.md", open);
    expect(designCommand(["check", file], {}, today).code).toBe(0);
    const ready = designCommand(["check", file], { ready: true }, today);
    expect(ready.code).toBe(1);
    expect(ready.stdout).toContain("open questions remain");
  });

  it("names files outside the approved boundary and passes once they are reverted", () => {
    const file = path.join(repo, "designs", "d.md");
    write("designs/d.md", approvedDesign());
    write("src/in.ts", "export const a = 2;\n");
    write("src/out.ts", "export const b = 2;\n");
    expect(() => designCommand(["scope", file], { checkout: repo }, today)).toThrow(ConfigError);
    const outside = designCommand(["scope", file], { checkout: repo, base }, today);
    expect(outside).toEqual({ code: 1, stdout: "outside: src/out.ts" });
    const json = JSON.parse(
      designCommand(["scope", file], { checkout: repo, base, json: true }, today).stdout,
    );
    expect(json).toMatchObject({
      approved: true,
      outside: ["src/out.ts"],
      changedFiles: ["designs/d.md", "src/in.ts", "src/out.ts"],
    });
    git("checkout", "--", "src/out.ts");
    expect(designCommand(["scope", file], { checkout: repo, base }, today)).toEqual({
      code: 0,
      stdout: "IN SCOPE",
    });
  });

  it("warns when the design is not approved", () => {
    const file = path.join(repo, "designs", "d.md");
    write(
      "designs/d.md",
      approvedDesign().replace(
        /- \*\*Status:\*\* Approved\n- \*\*Approved:\*\*[^\n]*/,
        "- **Status:** In Review",
      ),
    );
    expect(designCommand(["scope", file], { checkout: repo, base }, today)).toEqual({
      code: 0,
      stdout: "IN SCOPE\nwarning: design is not approved",
    });
  });

  it("refuses unknown subcommands", () => {
    expect(() => designCommand(["publish"], {}, today)).toThrow("Use design new, check or scope.");
  });
});
