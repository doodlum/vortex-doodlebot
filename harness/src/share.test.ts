import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { gapCommand } from "./gapCommand";
import { knowledgeCommand, parseLessons } from "./knowledgeCommand";
import { type GhResult, type RedactionContext, SHARE_REPO, redact } from "./share";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "share-"));
  dirs.push(dir);
  return dir;
}

const ctx: RedactionContext = {
  home: "C:\\Users\\Ada Lovelace",
  workspace: "C:\\Users\\Ada Lovelace\\doodlebot",
  caches: ["C:\\Users\\Ada Lovelace\\doodlebot\\harness\\.cache"],
  copies: ["D:\\GameCopies", "D:\\GameCopies\\stardewvalley"],
  user: "Ada Lovelace",
  machine: "ADA-DESKTOP",
  nexusUser: "adalove42",
};

/** A gh that answers from a script and records every call, with the body file's bytes. */
function fakeGh(answers: Record<string, GhResult>) {
  const calls: { args: string[]; body?: string }[] = [];
  const gh = (args: string[]): GhResult => {
    const bodyAt = args.indexOf("--body-file");
    calls.push({
      args,
      ...(bodyAt === -1 ? {} : { body: fs.readFileSync(args[bodyAt + 1]!, "utf8") }),
    });
    const key = `${args[0]} ${args[1]}`;
    return answers[key] ?? { code: 0, stdout: "", stderr: "" };
  };
  return { gh, calls };
}

const noGh = (): GhResult => {
  throw new Error("gh must not run");
};
const missingGh = (): GhResult => ({ code: 127, stdout: "", stderr: "spawn gh ENOENT" });

const lesson = {
  title: "Install watchers make refs stale on ADA-DESKTOP",
  area: "install",
  symptom: "Stale ref after a snapshot in C:/Users/Ada Lovelace/doodlebot/harness/.cache/live",
  cause: "install's dialog watchers take their own snapshots",
  remedy: "Snapshot and click in one call",
  scope: "doodlebot install on D:\\GameCopies\\stardewvalley, signed in as adalove42",
  evidence:
    "c:\\users\\ada lovelace\\doodlebot\\harness\\.artifacts\\runs\\x\\report.md by Ada Lovelace",
  vortex: "2.8.0",
  "third-party": "a user's vortex.log line",
};

function store() {
  const local = path.join(tempDir(), "knowledge.md");
  const added = JSON.parse(knowledgeCommand(["add"], { ...lesson, json: true }, { local })) as {
    id: string;
  };
  return { local, id: added.id };
}

describe("redaction", () => {
  it("replaces paths in any spelling, longest first, and names wherever they appear", () => {
    expect(
      redact(
        "C:/Users/Ada Lovelace/doodlebot/harness/.cache/live, D:\\GameCopies\\stardewvalley\\x, " +
          "c:\\users\\ada lovelace\\doodlebot\\README.md, C:\\Users\\Ada Lovelace\\Documents, " +
          "Ada Lovelace on ADA-DESKTOP as adalove42",
        ctx,
      ),
    ).toBe(
      "<cache>/live, <game copy>\\x, <workspace>\\README.md, <home>\\Documents, " +
        "<user> on <machine> as <nexus user>",
    );
  });

  it("redacts the temporary folder in both spellings and any 8.3 short home folder", () => {
    const withTemp: RedactionContext = {
      ...ctx,
      temp: [
        "C:\\Users\\ADALOV~1\\AppData\\Local\\Temp",
        "C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp",
      ],
    };
    expect(
      redact(
        "C:\\Users\\ADALOV~1\\AppData\\Local\\Temp\\doodlebot-pr-x\\a.log, " +
          "C:\\Users\\Ada Lovelace\\AppData\\Local\\Temp\\b.log, " +
          "c:/users/adalov~1/Downloads/vortex.log, C:\\Users\\OTHERU~2\\x",
        withTemp,
      ),
    ).toBe("<temp>\\doodlebot-pr-x\\a.log, <temp>\\b.log, <home>/Downloads/vortex.log, <home>\\x");
    // Without a temp entry (an older context), the short home is still caught.
    expect(redact("C:\\Users\\ADALOV~1\\AppData\\Local\\Temp\\c.log", ctx)).toBe(
      "<home>\\AppData\\Local\\Temp\\c.log",
    );
  });
});

describe("share", () => {
  it("prints the redacted text without third-party data and publishes nothing without --yes", () => {
    const { local, id } = store();
    const { gh, calls } = fakeGh({ "issue list": { code: 0, stdout: "[]", stderr: "" } });
    const notices: string[] = [];
    const text = knowledgeCommand(
      ["share", id],
      {},
      { local },
      {
        gh,
        ctx,
        notice: (m) => notices.push(m),
      },
    );
    expect(
      text.startsWith("Title: [knowledge] Install watchers make refs stale on <machine>\n\n"),
    ).toBe(true);
    expect(text).toContain("- **Symptom:** Stale ref after a snapshot in <cache>/live");
    expect(text).toContain(
      "- **Scope:** doodlebot install on <game copy>, signed in as <nexus user>",
    );
    expect(text).toContain("<workspace>\\harness\\.artifacts\\runs\\x\\report.md by <user>");
    expect(text).toContain("- **Vortex:** 2.8.0");
    for (const secret of ["Ada", "ADA-DESKTOP", "adalove42", "GameCopies", "vortex.log line"])
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    expect(notices.join("\n")).toContain("Third-party data was left out");
    expect(notices.join("\n")).toContain(`doodlebot knowledge share ${id} --yes`);
    // A declined confirmation creates nothing: only the read-only search ran.
    expect(calls.map((c) => c.args.slice(0, 2).join(" "))).toEqual(["issue list"]);
    expect(parseLessons(fs.readFileSync(local, "utf8"))[0]?.fields.issue).toBeUndefined();
  });

  it("publishes with --yes a body byte-identical to the printed one, and records the issue", () => {
    const { local, id } = store();
    const printed = knowledgeCommand(["share", id], { print: true }, { local }, { ctx });
    const { gh, calls } = fakeGh({
      "issue list": { code: 0, stdout: "[]", stderr: "" },
      "issue create": {
        code: 0,
        stdout: `https://github.com/${SHARE_REPO}/issues/7\n`,
        stderr: "",
      },
    });
    const out = knowledgeCommand(
      ["share", id],
      { yes: true },
      { local },
      { gh, ctx, notice: () => {} },
    );
    expect(out).toContain(`Created https://github.com/${SHARE_REPO}/issues/7`);
    const create = calls.find((c) => c.args[1] === "create")!;
    expect(create.args).toEqual(
      expect.arrayContaining(["--repo", SHARE_REPO, "--title", printed.split("\n")[0]!.slice(7)]),
    );
    expect(`Title: ${create.args[create.args.indexOf("--title") + 1]!}\n\n${create.body!}`).toBe(
      printed,
    );
    expect(parseLessons(fs.readFileSync(local, "utf8"))[0]?.fields.issue).toBe(
      `https://github.com/${SHARE_REPO}/issues/7`,
    );
    // No second share of the same id.
    expect(() =>
      knowledgeCommand(["share", id], { yes: true }, { local }, { gh, ctx, notice: () => {} }),
    ).toThrow(/already shared as https:\/\/github.com\/doodlum\/vortex-doodlebot\/issues\/7/);
  });

  it("includes third-party data only when the person confirmed it", () => {
    const { local, id } = store();
    expect(
      knowledgeCommand(
        ["share", id],
        { print: true, "include-third-party": true },
        { local },
        { ctx },
      ),
    ).toContain("- **Third-party data (confirmed by the person):** a user's vortex.log line");
  });

  it("comments on an open issue with the same title instead of creating one", () => {
    const dir = tempDir();
    const file = path.join(dir, "gaps.md");
    const deps = {
      file,
      kit: () => "a".repeat(40),
      isAncestor: () => false,
      ctx,
      notice: () => {},
    };
    const added = JSON.parse(
      gapCommand(
        ["add"],
        {
          title: "Inventory missed a GOG game",
          command: "doodlebot inventory",
          needed: "the GOG copy of Stardew Valley",
          happened: "only Steam manifests were read",
          blocked: "no",
          json: true,
        },
        deps,
      ),
    ) as { gap: { id: string } };
    const { gh, calls } = fakeGh({
      "issue list": {
        code: 0,
        stdout: JSON.stringify([
          { number: 3, title: "[gap] inventory missed a GOG game", url: "https://x/issues/3" },
        ]),
        stderr: "",
      },
      "issue comment": { code: 0, stdout: "https://x/issues/3#issuecomment-1\n", stderr: "" },
    });
    const out = gapCommand(["share", added.gap.id], { yes: true }, { ...deps, gh });
    expect(out).toContain("Commented on https://x/issues/3");
    expect(calls.map((c) => c.args.slice(0, 3).join(" "))).toEqual([
      "issue list --repo",
      "issue comment 3",
    ]);
    expect(calls[1]!.body).toContain("- **Command:** doodlebot inventory");
    expect(gapCommand(["list"], { json: true }, deps)).toContain('"issue": "https://x/issues/3"');
  });

  it("prints with --print without gh, and refuses text that holds a credential", () => {
    const { local, id } = store();
    expect(knowledgeCommand(["share", id], { print: true }, { local }, { gh: noGh, ctx })).toMatch(
      /^Title: \[knowledge\] /,
    );
    // An entry edited by hand to hold a token is never published.
    fs.writeFileSync(
      local,
      fs.readFileSync(local, "utf8").replace("Snapshot and click", `Bearer ${"t0k3n".repeat(4)}`),
    );
    expect(() => knowledgeCommand(["share", id], { print: true }, { local }, { ctx })).toThrow(
      /credential/,
    );
  });

  it("explains how to share by hand when gh is missing", () => {
    const { local, id } = store();
    expect(() =>
      knowledgeCommand(
        ["share", id],
        { yes: true },
        { local },
        { gh: missingGh, ctx, notice: () => {} },
      ),
    ).toThrow(/--print/);
  });
});
