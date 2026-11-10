import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { GAPS_FILE, addGap, closeGap, defaultIsAncestor, gapCommand, openGaps } from "./gapCommand";
import { USER_STATE_DIR } from "./paths";

const dirs: string[] = [];
function tempDir(prefix = "gaps-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const KIT = "a".repeat(40);
const gap = {
  title: "No tool reads the Downloads queue",
  command: "/doodlebot:drive",
  needed: "the queued downloads and their states",
  happened: "only the finished archives were visible",
  workaround: "vortex_query on state.persistent.downloads (bypasses the UI)",
  blocked: "no",
};

function deps(extra: Partial<Parameters<typeof addGap>[1]> = {}) {
  return {
    file: path.join(tempDir(), "state", "gaps.md"),
    now: new Date("2026-11-10T12:00:00Z"),
    kit: () => KIT,
    isAncestor: () => false,
    ...extra,
  };
}

describe("kit gaps", () => {
  it("live in the per-user state folder, outside the workspace", () => {
    expect(GAPS_FILE).toBe(path.join(USER_STATE_DIR, "gaps.md"));
  });

  it("records every field, with the kit commit, the date and a count", () => {
    const d = deps();
    const result = addGap(gap, d);
    expect(result.outcome).toBe("added");
    expect(result.gap.id).toMatch(/^g-20261110-[0-9a-f]{6}$/);
    const text = fs.readFileSync(d.file, "utf8");
    for (const line of [
      `## ${gap.title}`,
      "- **Command:** /doodlebot:drive",
      "- **What was needed:** the queued downloads and their states",
      "- **What happened:** only the finished archives were visible",
      "- **Workaround used:** vortex_query on state.persistent.downloads (bypasses the UI)",
      "- **Blocked:** no",
      `- **Kit:** ${KIT}`,
      "- **Seen:** 2026-11-10",
      "- **Count:** 1",
      "- **Status:** open",
    ])
      expect(text).toContain(line);
    expect(
      addGap({ ...gap, title: "Another", workaround: undefined }, d).gap.fields.workaround,
    ).toBe("none");
  });

  it("updates the count of the same Command and title, case-insensitively", () => {
    const d = deps();
    const first = addGap(gap, d).gap;
    const later = deps({
      file: d.file,
      now: new Date("2026-11-12T00:00:00Z"),
      kit: () => "b".repeat(40),
    });
    const again = addGap({ ...gap, title: gap.title.toUpperCase() }, later);
    expect(again.outcome).toBe("seen-again");
    expect(again.gap).toMatchObject({
      id: first.id,
      fields: { count: "2", seen: "2026-11-12", kit: "b".repeat(40) },
    });
    // Another command is another gap.
    expect(addGap({ ...gap, command: "/doodlebot:qa" }, d).outcome).toBe("added");
    expect(openGaps(d.file)).toHaveLength(2);
  });

  it("records nothing for a gap the owner rejected", () => {
    const d = deps();
    const { gap: added } = addGap(gap, d);
    closeGap(added.id, { wontfix: true }, d);
    const before = fs.readFileSync(d.file, "utf8");
    const result = addGap(gap, d);
    expect(result.outcome).toBe("rejected");
    expect(result.message).toContain("rejected by the owner on 2026-11-10");
    expect(fs.readFileSync(d.file, "utf8")).toBe(before);
    expect(openGaps(d.file)).toEqual([]);
  });

  it("re-opens a gap closed --by a commit only when the kit contains the fix", () => {
    const fix = "c".repeat(40);
    const seen: [string, string][] = [];
    const without = deps({
      isAncestor: (commit: string, kit: string) => {
        seen.push([commit, kit]);
        return false;
      },
    });
    const { gap: added } = addGap(gap, without);
    closeGap(added.id, { by: fix }, without);
    const before = fs.readFileSync(without.file, "utf8");
    const notPresent = addGap(gap, without);
    expect(notPresent.outcome).toBe("fixed");
    expect(notPresent.message).toContain(`fixed in ${fix}; run \`/doodlebot:setup --update\``);
    expect(seen).toEqual([[fix, KIT]]);
    expect(fs.readFileSync(without.file, "utf8")).toBe(before);

    const withFix = deps({ file: without.file, isAncestor: () => true });
    const reopened = addGap(gap, withFix);
    expect(reopened.outcome).toBe("reopened");
    expect(reopened.gap.fields).toMatchObject({ status: "open", count: "2" });
    expect(reopened.gap.fields.by).toBeUndefined();
    expect(reopened.gap.notes[0]).toContain(`the fix ${fix} did not hold`);
  });

  it("counts a commit git cannot find as the fix not being present", () => {
    const repo = tempDir("gaps-repo-");
    const git = (...args: string[]): string =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.email", "t@example.test");
    git("config", "user.name", "T");
    git("commit", "-q", "--allow-empty", "-m", "fix");
    const fix = git("rev-parse", "HEAD");
    git("commit", "-q", "--allow-empty", "-m", "later");
    const kit = git("rev-parse", "HEAD");
    expect(defaultIsAncestor(fix, kit, repo)).toBe(true);
    expect(defaultIsAncestor(kit, fix, repo)).toBe(false);
    expect(defaultIsAncestor("d".repeat(40), kit, repo)).toBe(false);
  });

  it("refuses credentials, stack traces, missing fields and a bad --blocked", () => {
    const d = deps();
    expect(() => addGap({ ...gap, happened: `token ${"x9Qz".repeat(12)}` }, d)).toThrow(
      /credential/,
    );
    expect(() =>
      addGap({ ...gap, happened: "TypeError at Foo.bar (C:/Users/me/x.js:1:2)" }, d),
    ).toThrow(/stack trace/);
    expect(() => addGap({ ...gap, needed: "" }, d)).toThrow(/needs --needed/);
    expect(() => addGap({ ...gap, blocked: "maybe" }, d)).toThrow(/yes or no/);
    expect(fs.existsSync(d.file)).toBe(false);
  });

  it("closes with exactly one of --by and --wontfix", () => {
    const d = deps();
    const { gap: added } = addGap(gap, d);
    expect(() => closeGap(added.id, {}, d)).toThrow(/exactly one/);
    expect(() => closeGap(added.id, { by: "abc1234", wontfix: true }, d)).toThrow(/exactly one/);
    expect(() => closeGap(added.id, { by: "not a sha" }, d)).toThrow(/hex/);
    expect(() => closeGap("g-none", { wontfix: true }, d)).toThrow(/No kit gap/);
    expect(closeGap(added.id, { by: "abc1234" }, d).fields).toMatchObject({
      status: "closed",
      by: "abc1234",
      closed: "2026-11-10",
    });
  });
});

describe("gap command", () => {
  it("adds, lists (JSON with closed gaps) and closes through the CLI forms", () => {
    const d = deps();
    const added = JSON.parse(gapCommand(["add"], { ...gap, json: true }, d)) as {
      outcome: string;
      gap: { id: string };
    };
    expect(added.outcome).toBe("added");
    expect(gapCommand(["list"], {}, d)).toBe(
      `${added.gap.id}  ${gap.title} [/doodlebot:drive; open; seen 1x, last 2026-11-10]`,
    );
    expect(gapCommand(["close", added.gap.id], { wontfix: true }, d)).toContain("wontfix");
    expect(gapCommand(["list"], {}, d)).toMatch(/^No open kit gaps/);
    expect(gapCommand(["list"], { all: true }, d)).toContain("wontfix");
    expect(
      (JSON.parse(gapCommand(["list"], { json: true }, d)) as { id: string }[]).map((g) => g.id),
    ).toEqual([added.gap.id]);
    expect(() => gapCommand(["frob"], {}, d)).toThrow(/gap add\|list\|close\|share/);
  });
});
