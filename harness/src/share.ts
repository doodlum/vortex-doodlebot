/**
 * `doodlebot knowledge share <id>` and `doodlebot gap share <id>`: a local lesson or kit gap
 * becomes a GitHub issue on doodlebot's repository, which the maintainer turns into a change.
 *
 * - The text is redacted first: local paths become `<workspace>`, `<cache>`, `<game copy>`,
 *   `<temp>` and `<home>` (a `Users\<8.3 short name>` home too); the Windows user, machine and Nexus user names become `<user>`, `<machine>` and
 *   `<nexus user>` wherever they appear. Third-party data is left out unless the person confirms it
 *   separately (`--include-third-party`). The credential guard runs on the result.
 * - Without `--yes` the text is printed and nothing is published: the agent shows it to the person
 *   and reruns with `--yes` once they confirm. The published body is byte-identical to the
 *   printed body.
 * - An open issue with the same title gets a comment instead of a new issue. The issue URL is
 *   recorded in the entry, and a second share of the same id is refused.
 * - Before any search or create, `gh repo view --json hasIssuesEnabled` is read. When issues are
 *   disabled the text is printed with the reason, nothing is created, and the command exits 2.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readContent } from "./content";
import { ConfigError } from "./errors";
import { looksSecret } from "./entryStore";
import { DEFAULT_CACHE_DIR, REPO_ROOT } from "./paths";

export const SHARE_REPO = "doodlum/vortex-doodlebot";

export interface GhResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Runs `gh <args>`; code 127 when gh is not installed. */
export type GhRunner = (args: string[]) => GhResult;

export const defaultGh: GhRunner = (args) => {
  const result = spawnSync("gh", args, { encoding: "utf8", windowsHide: true });
  if (result.error) return { code: 127, stdout: "", stderr: result.error.message };
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
};

export interface RedactionContext {
  home: string;
  workspace: string;
  caches: string[];
  copies: string[];
  user: string;
  machine: string;
  nexusUser?: string;
  /** The temporary folder in every spelling: `os.tmpdir()` is often an 8.3 short path. */
  temp?: string[];
}

/** `os.tmpdir()` as given (often `C:\Users\NEXUST~1\...`) and its long form. */
function tempFolders(): string[] {
  const temp = os.tmpdir();
  let long: string | undefined;
  try {
    long = fs.realpathSync.native(temp);
  } catch {
    long = undefined;
  }
  return [...new Set([temp, ...(long === undefined ? [] : [long])])];
}

/** This machine's paths and names. `VORTEX_AI_NEXUS_USER` (or `--nexus-user`) names the Nexus user. */
export function machineRedaction(nexusUser = process.env.VORTEX_AI_NEXUS_USER): RedactionContext {
  let copies: string[] = [];
  try {
    const content = readContent();
    copies = [
      ...(content.copyFolder === undefined ? [] : [content.copyFolder]),
      ...content.games.map((game) => game.path),
    ];
  } catch {
    // An unreadable content.json names no copies; the home and workspace still apply.
  }
  const cache = process.env.VORTEX_AI_CACHE_DIR;
  return {
    home: os.homedir(),
    workspace: REPO_ROOT,
    caches: [DEFAULT_CACHE_DIR, ...(cache ? [path.resolve(REPO_ROOT, cache)] : [])],
    copies,
    user: os.userInfo().username,
    machine: os.hostname(),
    ...(nexusUser ? { nexusUser } : {}),
    temp: tempFolders(),
  };
}

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Replace every spelling of a path (either slash, any case, trailing slash or not). */
function replacePath(text: string, dir: string, placeholder: string): string {
  const trimmed = dir.replace(/[\\/]+$/, "");
  if (trimmed.length < 3) return text;
  const pattern = trimmed
    .split(/[\\/]+/)
    .map(escape)
    .join("[\\\\/]+");
  return text.replace(new RegExp(pattern, "gi"), placeholder);
}

/** Replace a name where it stands as a word of its own (case-insensitive). */
function replaceName(text: string, name: string | undefined, placeholder: string): string {
  if (name === undefined || name.trim().length < 3) return text;
  return text.replace(
    new RegExp(`(?<![A-Za-z0-9])${escape(name.trim())}(?![A-Za-z0-9])`, "gi"),
    placeholder,
  );
}

export function redact(text: string, ctx: RedactionContext): string {
  const paths: [string, string][] = [
    ...ctx.copies.map((dir): [string, string] => [dir, "<game copy>"]),
    ...ctx.caches.map((dir): [string, string] => [dir, "<cache>"]),
    ...(ctx.temp ?? []).map((dir): [string, string] => [dir, "<temp>"]),
    [ctx.workspace, "<workspace>"],
    [ctx.home, "<home>"],
  ];
  let out = text;
  for (const [dir, placeholder] of paths.toSorted((a, b) => b[0].length - a[0].length))
    out = replacePath(out, dir, placeholder);
  // A home folder in its 8.3 short form (`C:\Users\NEXUST~1`), which no path above spells.
  out = out.replace(
    /(?:\b[A-Za-z]:)?[\\/]+Users[\\/]+[^\\/\s"'`<>]*~\d+(?![^\\/\s"'`<>])/gi,
    "<home>",
  );
  out = replaceName(out, ctx.nexusUser, "<nexus user>");
  out = replaceName(out, ctx.user, "<user>");
  out = replaceName(out, ctx.machine, "<machine>");
  return out;
}

export interface ShareDraft {
  title: string;
  body: string;
  /** Third-party data that was left out. */
  leftOut: boolean;
}

/**
 * The issue text: `[<kind>] <title>` and a body of `- **<Label>:** <value>` lines. `fields` are
 * the entry's shareable fields in order; `thirdParty` is included only when asked.
 */
export function shareDraft(
  kind: "knowledge" | "gap",
  entry: {
    id: string;
    title: string;
    fields: [string, string][];
    notes: string[];
    thirdParty?: string;
  },
  options: { includeThirdParty: boolean; ctx: RedactionContext },
): ShareDraft {
  const lines = [`- **Id:** ${entry.id}`];
  for (const [label, value] of entry.fields) lines.push(`- **${label}:** ${value}`);
  for (const note of entry.notes) lines.push(`- **Note:** ${note}`);
  const leftOut = entry.thirdParty !== undefined && !options.includeThirdParty;
  if (entry.thirdParty !== undefined && options.includeThirdParty)
    lines.push(`- **Third-party data (confirmed by the person):** ${entry.thirdParty}`);
  lines.push(
    "",
    `Shared from a local doodlebot ${kind === "gap" ? "kit gap" : "lesson"} with \`doodlebot ${kind} share\`.`,
  );
  const title = `[${kind}] ${redact(entry.title, options.ctx)}`;
  const body = `${redact(lines.join("\n"), options.ctx)}\n`;
  if (looksSecret(title) || looksSecret(body))
    throw new ConfigError(
      "The text to share looks like it holds a credential or token; nothing was shared. Fix the entry first.",
    );
  return { title, body, leftOut };
}

/** The printed form: the title line, a blank line, then exactly the body that is published. */
export const printedDraft = (draft: ShareDraft): string => `Title: ${draft.title}\n\n${draft.body}`;

interface IssueRef {
  number: number;
  title: string;
  url: string;
}

/** An open issue of the repository whose title equals the draft's (case-insensitive). */
export function findOpenIssue(
  title: string,
  gh: GhRunner,
  repo = SHARE_REPO,
): IssueRef | undefined {
  const result = gh([
    "issue",
    "list",
    "--repo",
    repo,
    "--state",
    "open",
    "--search",
    `${title} in:title`,
    "--json",
    "number,title,url",
    "--limit",
    "50",
  ]);
  if (result.code !== 0) throw ghFailure("search the open issues", result);
  const issues = JSON.parse(result.stdout || "[]") as IssueRef[];
  return issues.find((issue) => issue.title.trim().toLowerCase() === title.trim().toLowerCase());
}

function ghFailure(action: string, result: GhResult): ConfigError {
  if (result.code === 127)
    return new ConfigError(
      `gh is not installed, so doodlebot cannot ${action}. Run the share with --print and paste ` +
        `the text into a new issue at https://github.com/${SHARE_REPO}/issues/new.`,
    );
  return new ConfigError(
    `gh could not ${action} (exit ${String(result.code)}): ${result.stderr.trim().split("\n")[0] ?? ""}. ` +
      "Check `gh auth status`, or share with --print and paste the text by hand.",
  );
}

/**
 * Publish a confirmed draft: a comment on an open issue with the same title, or a new issue.
 * Returns the issue's URL and whether it commented.
 */
export function publishDraft(
  draft: ShareDraft,
  gh: GhRunner,
  repo = SHARE_REPO,
): { url: string; commented: boolean } {
  const existing = findOpenIssue(draft.title, gh, repo);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "doodlebot-share-"));
  const bodyFile = path.join(dir, "body.md");
  try {
    fs.writeFileSync(bodyFile, draft.body);
    if (existing !== undefined) {
      const result = gh([
        "issue",
        "comment",
        String(existing.number),
        "--repo",
        repo,
        "--body-file",
        bodyFile,
      ]);
      if (result.code !== 0) throw ghFailure(`comment on issue #${existing.number}`, result);
      return { url: existing.url, commented: true };
    }
    const result = gh([
      "issue",
      "create",
      "--repo",
      repo,
      "--title",
      draft.title,
      "--body-file",
      bodyFile,
    ]);
    if (result.code !== 0) throw ghFailure("create the issue", result);
    const url = result.stdout
      .trim()
      .split(/\s+/)
      .findLast((word) => word.startsWith("https://"));
    if (url === undefined)
      throw new ConfigError(`gh created the issue but printed no URL: ${result.stdout.trim()}`);
    return { url, commented: false };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * `gh repo view <repo> --json hasIssuesEnabled`: whether the repository takes issues, or
 * undefined (with gh's result) when gh could not say.
 */
export function issuesEnabled(
  gh: GhRunner,
  repo = SHARE_REPO,
): { enabled: boolean | undefined; result: GhResult } {
  const result = gh(["repo", "view", repo, "--json", "hasIssuesEnabled"]);
  if (result.code !== 0) return { enabled: undefined, result };
  try {
    const value = (JSON.parse(result.stdout) as { hasIssuesEnabled?: unknown }).hasIssuesEnabled;
    return { enabled: typeof value === "boolean" ? value : undefined, result };
  } catch {
    return { enabled: undefined, result };
  }
}

export const ISSUES_DISABLED = `Issues are disabled on ${SHARE_REPO}; the owner can enable them, or share this text another way`;

/**
 * The share stopped because the repository takes no issues: `output` is the text for stdout (the
 * Markdown and the reason) and the command exits 2. Nothing was searched or created.
 */
export class IssuesDisabledError extends ConfigError {
  readonly exitCode = 2;
  constructor(readonly output: string) {
    super(ISSUES_DISABLED);
  }
}

export interface ShareDeps {
  gh?: GhRunner;
  ctx?: RedactionContext;
  /** Where the instructions for the agent go (default: stderr), apart from the printed text. */
  notice?: (message: string) => void;
}

/**
 * The `share` sub-command for one entry. `record` stores the issue URL in the entry. Returns the
 * text for stdout.
 */
export function shareEntry(
  kind: "knowledge" | "gap",
  entry: Parameters<typeof shareDraft>[1] & { issue?: string },
  flags: Record<string, string | boolean>,
  record: (url: string) => void,
  deps: ShareDeps = {},
): string {
  const gh = deps.gh ?? defaultGh;
  const notice =
    deps.notice ?? ((message: string): void => void process.stderr.write(`${message}\n`));
  const nexusUser = typeof flags["nexus-user"] === "string" ? flags["nexus-user"] : undefined;
  const draft = shareDraft(kind, entry, {
    includeThirdParty: flags["include-third-party"] === true,
    ctx: deps.ctx ?? machineRedaction(nexusUser),
  });
  const text = printedDraft(draft);
  if (flags.print === true) return text;
  if (entry.issue !== undefined)
    throw new ConfigError(
      `${entry.id} was already shared as ${entry.issue}; it is not shared twice.`,
    );
  if (draft.leftOut)
    notice(
      "Third-party data was left out. Include it only if the person confirms that part separately " +
        "(--include-third-party).",
    );
  // Before any search or create: a repository without issues takes none.
  const issues = issuesEnabled(gh);
  if (issues.enabled === false) throw new IssuesDisabledError(`${text}\n${ISSUES_DISABLED}.`);
  if (issues.enabled === undefined && flags.yes === true)
    throw ghFailure(`read whether ${SHARE_REPO} takes issues`, issues.result);
  if (flags.yes !== true) {
    let existing: IssueRef | undefined;
    let searched = true;
    try {
      existing = findOpenIssue(draft.title, gh);
    } catch {
      searched = false;
    }
    notice(
      [
        `Not published. Show the text above to the person: it goes to the public repository ${SHARE_REPO}.`,
        searched
          ? existing === undefined
            ? "No open issue has this title; --yes creates one."
            : `Open issue #${existing.number} has this title; --yes adds this text to it as a comment (seen again).`
          : "Could not search the open issues (gh missing or signed out); --print gives the text to paste by hand.",
        `After the person confirms: doodlebot ${kind} share ${entry.id} --yes` +
          (flags["include-third-party"] === true ? " --include-third-party" : ""),
      ].join("\n"),
    );
    return text;
  }
  const published = publishDraft(draft, gh);
  record(published.url);
  return `${text}\n${published.commented ? "Commented on" : "Created"} ${published.url}`;
}
