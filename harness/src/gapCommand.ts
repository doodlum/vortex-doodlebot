/**
 * `doodlebot gap`: kit gaps, things doodlebot should have done for a task and didn't, kept in
 * `~/.doodlebot/gaps.md` beside the local lessons (entryStore.ts). An agent records a gap instead
 * of patching the workspace mid-task; the owner picks one and fixes it as a doodlebot change, then
 * closes it with `--by <commit>`, or rejects it with `--wontfix` so it is not raised again.
 *
 * The same gap is the same `Command` and title (case-insensitive). An add that matches:
 * - an open gap updates its Seen, Kit and Count;
 * - a `wontfix` gap records nothing;
 * - a gap closed `--by <commit>` re-opens only when Kit already contains that commit (the fix did
 *   not hold). A commit git cannot find counts as "fix not present".
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

import {
  type Entry,
  findEntry,
  guardValues,
  newId,
  oneLine,
  readEntries,
  today,
  writeEntries,
} from "./entryStore";
import { ConfigError } from "./errors";
import { REPO_ROOT, USER_STATE_DIR } from "./paths";
import { type ShareDeps, shareEntry } from "./share";
import { versionInfo } from "./versionCommand";

export const GAPS_FILE = path.join(USER_STATE_DIR, "gaps.md");

export const GAP_FIELDS = [
  ["command", "Command"],
  ["needed", "What was needed"],
  ["happened", "What happened"],
  ["workaround", "Workaround used"],
  ["blocked", "Blocked"],
  ["kit", "Kit"],
  ["seen", "Seen"],
  ["count", "Count"],
  ["status", "Status"],
  ["closed", "Closed"],
  ["by", "Fixed by"],
  ["thirdParty", "Third-party"],
  ["issue", "Issue"],
] as const;
type GapField = (typeof GAP_FIELDS)[number][0];
export type Gap = Entry<GapField>;

const HEADER =
  "# Doodlebot kit gaps\n\n" +
  "What the kit should have done for a task and didn't, recorded by `doodlebot gap add`. The\n" +
  "owner fixes a gap as a doodlebot change and closes it with `doodlebot gap close <id> --by\n" +
  "<commit>`, or rejects it with `--wontfix`.\n";

export interface GapDeps extends ShareDeps {
  file?: string;
  now?: Date;
  /** The `doodlebot version` commit. */
  kit?: () => string;
  /** `git merge-base --is-ancestor <commit> <kit>` in the workspace: false when unknown. */
  isAncestor?: (commit: string, kit: string) => boolean;
}

const defaultKit = (): string => versionInfo().commit;

export const defaultIsAncestor = (commit: string, kit: string, root = REPO_ROOT): boolean =>
  spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", commit, kit], {
    stdio: "ignore",
    windowsHide: true,
  }).status === 0;

const readGaps = (file: string): Gap[] => readEntries(file, GAP_FIELDS);
const writeGaps = (file: string, gaps: Gap[]): void => writeEntries(file, HEADER, gaps, GAP_FIELDS);

const sameGap = (gap: Gap, command: string, title: string): boolean =>
  (gap.fields.command ?? "").trim().toLowerCase() === command.trim().toLowerCase() &&
  gap.title.trim().toLowerCase() === title.trim().toLowerCase();

export type AddOutcome = "added" | "seen-again" | "rejected" | "fixed" | "reopened";

export interface GapInput {
  title: string;
  command: string;
  needed: string;
  happened: string;
  workaround?: string;
  blocked: string;
  thirdParty?: string;
}

export function addGap(
  input: GapInput,
  deps: GapDeps = {},
): { outcome: AddOutcome; gap: Gap; message: string } {
  const file = deps.file ?? GAPS_FILE;
  const now = deps.now ?? new Date();
  const missing = (["title", "command", "needed", "happened", "blocked"] as const).filter(
    (key) => !input[key]?.trim(),
  );
  if (missing.length > 0)
    throw new ConfigError(
      `gap add needs ${missing.map((key) => `--${key}`).join(", ")}. A gap is something the kit ` +
        "should have done and didn't; a Vortex bug is an issue report instead.",
    );
  const blocked = input.blocked.trim().toLowerCase();
  if (blocked !== "yes" && blocked !== "no")
    throw new ConfigError("gap add --blocked takes yes or no: did the task stop?");
  guardValues(
    {
      title: input.title,
      command: input.command,
      needed: input.needed,
      happened: input.happened,
      workaround: input.workaround,
      "third-party": input.thirdParty,
    },
    "gaps",
  );
  const kit = (deps.kit ?? defaultKit)();
  const gaps = readGaps(file);
  const title = oneLine(input.title);
  const command = oneLine(input.command);
  const match = gaps.find((gap) => sameGap(gap, command, title));
  const date = today(now);
  const bump = (gap: Gap): void => {
    gap.fields.seen = date;
    gap.fields.kit = kit;
    gap.fields.count = String(Number(gap.fields.count ?? "1") + 1);
  };
  if (match !== undefined) {
    const status = match.fields.status ?? "open";
    if (status === "wontfix")
      return {
        outcome: "rejected",
        gap: match,
        message: `${match.id}: rejected by the owner on ${match.fields.closed ?? "an earlier date"}; nothing recorded.`,
      };
    if (status === "closed") {
      const by = match.fields.by ?? "";
      const holds = by !== "" && (deps.isAncestor ?? defaultIsAncestor)(by, kit);
      if (!holds)
        return {
          outcome: "fixed",
          gap: match,
          message: `${match.id}: fixed in ${by || "a later doodlebot"}; run \`/doodlebot:setup --update\`. Nothing recorded.`,
        };
      bump(match);
      match.fields.status = "open";
      match.notes.push(`${date}: re-opened; the fix ${by} did not hold on ${kit}`);
      delete match.fields.closed;
      delete match.fields.by;
      writeGaps(file, gaps);
      return {
        outcome: "reopened",
        gap: match,
        message: `re-opened ${match.id}: the fix ${by} did not hold (seen ${match.fields.count} times)`,
      };
    }
    bump(match);
    writeGaps(file, gaps);
    return {
      outcome: "seen-again",
      gap: match,
      message: `seen again: ${match.id} ${match.title} (seen ${match.fields.count} times)`,
    };
  }
  const gap: Gap = {
    id: newId("g", now),
    title,
    fields: {
      command,
      needed: oneLine(input.needed),
      happened: oneLine(input.happened),
      workaround: oneLine(input.workaround?.trim() ? input.workaround : "none"),
      blocked,
      kit,
      seen: date,
      count: "1",
      status: "open",
      ...(input.thirdParty?.trim() ? { thirdParty: oneLine(input.thirdParty) } : {}),
    },
    notes: [],
  };
  writeGaps(file, [...gaps, gap]);
  return { outcome: "added", gap, message: `added ${gap.id}: ${gap.title} (${file})` };
}

const missingGap = (id: string): string => `No kit gap with id ${id}; see doodlebot gap list.`;

export function closeGap(
  id: string,
  how: { by?: string; wontfix?: boolean },
  deps: GapDeps = {},
): Gap {
  const file = deps.file ?? GAPS_FILE;
  if ((how.by === undefined) === (how.wontfix !== true))
    throw new ConfigError(
      "gap close needs exactly one of --by <commit> (fixed) or --wontfix (rejected by the owner).",
    );
  if (how.by !== undefined && !/^[0-9a-f]{7,40}$/i.test(how.by.trim()))
    throw new ConfigError("gap close --by takes the commit that fixed it (7 to 40 hex digits).");
  const gaps = readGaps(file);
  const gap = findEntry(gaps, id, missingGap(id));
  gap.fields.status = how.wontfix === true ? "wontfix" : "closed";
  gap.fields.closed = today(deps.now ?? new Date());
  if (how.by !== undefined) gap.fields.by = how.by.trim();
  else delete gap.fields.by;
  writeGaps(file, gaps);
  return gap;
}

/** Open gaps, for `setup --check` and the Learned section. */
export function openGaps(file = GAPS_FILE): Gap[] {
  return readGaps(file).filter((gap) => (gap.fields.status ?? "open") === "open");
}

function shareable(gap: Gap): [string, string][] {
  return GAP_FIELDS.filter(
    ([key]) => !["thirdParty", "issue", "status", "closed", "by"].includes(key),
  )
    .filter(([key]) => gap.fields[key] !== undefined)
    .map(([key, label]) => [label, gap.fields[key]!]);
}

const USAGE = "Use doodlebot gap add|list|close|share (see doodlebot --help).";

export function gapCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  deps: GapDeps = {},
): string {
  const file = deps.file ?? GAPS_FILE;
  const json = flags.json === true;
  const text = (key: string): string | undefined =>
    typeof flags[key] === "string" ? (flags[key] as string) : undefined;
  const [sub, id] = positional;
  switch (sub) {
    case "add": {
      const result = addGap(
        {
          title: text("title") ?? "",
          command: text("command") ?? "",
          needed: text("needed") ?? "",
          happened: text("happened") ?? "",
          workaround: text("workaround"),
          blocked: text("blocked") ?? "",
          thirdParty: text("third-party"),
        },
        deps,
      );
      return json
        ? JSON.stringify({ outcome: result.outcome, gap: result.gap }, null, 2)
        : result.message;
    }
    case "list": {
      // JSON always holds every gap, closed ones too, so an agent can match before adding.
      const gaps = readGaps(file);
      if (json) return JSON.stringify(gaps, null, 2);
      const shown =
        flags.all === true ? gaps : gaps.filter((gap) => (gap.fields.status ?? "open") === "open");
      if (shown.length === 0) return `No open kit gaps (${file}).`;
      return shown
        .map(
          (gap) =>
            `${gap.id}  ${gap.title} [${gap.fields.command ?? "?"}; ${gap.fields.status ?? "open"}` +
            `${gap.fields.blocked === "yes" ? "; blocked" : ""}; seen ${gap.fields.count ?? "1"}x, ` +
            `last ${gap.fields.seen ?? "?"}]`,
        )
        .join("\n");
    }
    case "close": {
      if (!id) throw new ConfigError("gap close needs a gap id.");
      const gap = closeGap(id, { by: text("by"), wontfix: flags.wontfix === true }, deps);
      return json
        ? JSON.stringify(gap, null, 2)
        : gap.fields.status === "wontfix"
          ? `closed ${gap.id} as wontfix: it is not raised again`
          : `closed ${gap.id}, fixed by ${gap.fields.by!}`;
    }
    case "share": {
      if (!id) throw new ConfigError("gap share needs a gap id.");
      const gaps = readGaps(file);
      const gap = findEntry(gaps, id, missingGap(id));
      return shareEntry(
        "gap",
        {
          id: gap.id,
          title: gap.title,
          fields: shareable(gap),
          notes: gap.notes,
          thirdParty: gap.fields.thirdParty,
          issue: gap.fields.issue,
        },
        flags,
        (url) => {
          gap.fields.issue = url;
          writeGaps(file, gaps);
        },
        deps,
      );
    }
    default:
      throw new ConfigError(USAGE);
  }
}
