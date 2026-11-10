import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ConfigError } from "./errors";
import {
  KNOWLEDGE_FILE,
  addLesson,
  knowledgeCommand,
  parseLessons,
  removeLesson,
  searchKnowledge,
} from "./knowledgeCommand";
import { USER_STATE_DIR } from "./paths";

const dirs: string[] = [];
function files(): { local: string; shared: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-"));
  dirs.push(dir);
  const shared = path.join(dir, "KNOWLEDGE.md");
  fs.writeFileSync(
    shared,
    "# Knowledge\n\n## Snapshots go blank\n\nA modal overlay hides the tree.\n\n## Ports\n\nPort 3701 is taken.\n\n## Extensions\n\n### Reload loses refs\n\nA watcher reload invalidates refs.\n\n### Port of the old kit\n\nThe old record names a port.\n",
  );
  return { local: path.join(dir, "state", "knowledge.md"), shared };
}
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

const lesson = {
  title: "Install watchers make refs stale",
  area: "install",
  symptom: "Stale or unknown ref after a snapshot",
  cause: "install's dialog watchers take their own snapshots",
  remedy: "Snapshot and click in one call",
  scope: "doodlebot install, any Vortex",
  evidence: "harness/.artifacts/runs/20261110T123734Z-probe-reinstall/report.md",
  vortex: "2.8.0",
};

describe("knowledge store", () => {
  it("lives in the per-user state folder, outside the workspace", () => {
    expect(KNOWLEDGE_FILE).toBe(path.join(USER_STATE_DIR, "knowledge.md"));
  });

  it("adds a lesson with an id and date and reads it back", () => {
    const { local } = files();
    const added = addLesson(lesson, local, new Date("2026-11-10T12:00:00Z"));
    expect(added.id).toMatch(/^k-20261110-[0-9a-f]{6}$/);
    expect(added.fields.seen).toBe("2026-11-10");
    const [read] = parseLessons(fs.readFileSync(local, "utf8"));
    expect(read).toEqual(added);
  });

  it("refuses a lesson without a checked cause and its other required fields", () => {
    const { local } = files();
    expect(() => addLesson({ title: "x", area: "a" }, local)).toThrow(
      /--symptom, --cause, --remedy, --scope, --evidence/,
    );
    expect(fs.existsSync(local)).toBe(false);
  });

  it("refuses text that looks like a credential", () => {
    const { local } = files();
    expect(() =>
      addLesson({ ...lesson, evidence: "Authorization: Bearer abcdefghijklmnop" }, local),
    ).toThrow(ConfigError);
    expect(() => addLesson({ ...lesson, cause: `token ${"x9Qz".repeat(12)}` }, local)).toThrow(
      /credential/,
    );
    // Paths, slugs and commit SHAs are not credentials.
    expect(
      addLesson(
        {
          ...lesson,
          evidence: "commit df8c9f086372a8c5af3a49c5f71d324be6306020, harness/.artifacts/runs/x",
        },
        local,
      ).id,
    ).toMatch(/^k-/);
  });

  it("refuses a duplicate title and removes by id", () => {
    const { local } = files();
    const added = addLesson(lesson, local);
    expect(() => addLesson({ ...lesson, title: lesson.title.toUpperCase() }, local)).toThrow(
      /exists/,
    );
    expect(removeLesson(added.id, local).title).toBe(lesson.title);
    expect(parseLessons(fs.readFileSync(local, "utf8"))).toEqual([]);
    expect(() => removeLesson(added.id, local)).toThrow(/No local lesson/);
  });

  it("searches local lessons first, then the shared KNOWLEDGE.md, matching every word", () => {
    const store = files();
    addLesson(lesson, store.local);
    expect(searchKnowledge(["STALE", "ref"], store).map((m) => m.source)).toEqual(["local"]);
    expect(searchKnowledge(["modal"], store).map((m) => [m.source, m.title])).toEqual([
      ["shared", "Snapshots go blank"],
    ]);
    expect(searchKnowledge(["snapshot"], store).map((m) => m.source)).toEqual(["local", "shared"]);
    // Entries under an area heading match on their own, titled with the area, and the bare
    // area heading is not an entry.
    expect(searchKnowledge(["reload"], store).map((m) => [m.title, m.text])).toEqual([
      [
        "Extensions › Reload loses refs",
        "### Reload loses refs\n\nA watcher reload invalidates refs.",
      ],
    ]);
    expect(searchKnowledge(["extensions"], store)).toEqual([]);
    expect(searchKnowledge(["nothing-like-this"], store)).toEqual([]);
    expect(() => searchKnowledge([], store)).toThrow(/one or more words/);
  });
});

describe("knowledge command", () => {
  it("adds, lists, searches and removes through the CLI forms", () => {
    const store = files();
    const added = JSON.parse(knowledgeCommand(["add"], { ...lesson, json: true }, store)) as {
      id: string;
    };
    expect(knowledgeCommand(["list"], {}, store)).toBe(`${added.id}  ${lesson.title}`);
    expect(knowledgeCommand(["search", "watchers"], {}, store)).toContain(`[local ${added.id}]`);
    expect(knowledgeCommand(["remove", added.id], {}, store)).toBe(
      `removed ${added.id}: ${lesson.title}`,
    );
    expect(knowledgeCommand(["list"], {}, store)).toMatch(/^No local lessons yet/);
    expect(knowledgeCommand(["path"], {}, store)).toBe(store.local);
  });

  it("explains its usage for an unknown sub-command", () => {
    expect(() => knowledgeCommand(["frob"], {}, files())).toThrow(/knowledge add\|search/);
  });
});
