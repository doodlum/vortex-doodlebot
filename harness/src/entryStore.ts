/**
 * The Markdown store behind `doodlebot knowledge` and `doodlebot gap`: one `## <title>` section per
 * entry, an `- **Id:**` line, `- **<Label>:** <text>` lines for its fields and any number of
 * `- **Note:**` lines. Files live in `~/.doodlebot`, outside every workspace, and are rewritten
 * through a temporary file and a rename. Every value passes the credential guard first.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";

/** The fields of an entry, in the order they are written: `[key, label]`. */
export type Labels<F extends string> = readonly (readonly [F, string])[];

export interface Entry<F extends string> {
  id: string;
  title: string;
  fields: Partial<Record<F, string>>;
  /** Appended `- **Note:**` lines, oldest first. */
  notes: string[];
}

/**
 * Text that looks like a credential: a bearer header, or an unbroken run of 32 or more
 * base64-style characters mixing letters and digits. Hyphens, dots and slashes break a run, so
 * paths and slugs pass; pure hex (a commit SHA or digest) passes too.
 */
export function looksSecret(value: string): boolean {
  if (/\bBearer\s+\S{8,}/i.test(value)) return true;
  return (value.match(/[A-Za-z0-9+_=]{32,}/g) ?? []).some(
    (run) => /\d/.test(run) && /[A-Za-z]/.test(run) && !/^[0-9a-fA-F]+$/.test(run),
  );
}

/** A JavaScript stack frame: `at name (file:line:column)`. */
export function looksLikeStackTrace(value: string): boolean {
  return /\bat\s+[\w$.<>[\]]+\s+\([^()\s]+:\d+:\d+\)/.test(value);
}

/** Refuses any value that looks like a credential or a stack trace. `what` names the store. */
export function guardValues(values: Record<string, unknown>, what: string): void {
  for (const [key, value] of Object.entries(values)) {
    if (typeof value !== "string") continue;
    if (looksSecret(value))
      throw new ConfigError(
        `--${key} looks like it holds a credential or token. Never store secrets in ${what}.`,
      );
    if (looksLikeStackTrace(value))
      throw new ConfigError(
        `--${key} looks like a stack trace. Write what happened in plain words; keep traces in the run report.`,
      );
  }
}

export const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

export const today = (now: Date): string => now.toISOString().slice(0, 10);

/** `<prefix>-<yyyymmdd>-<6 hex>`. */
export const newId = (prefix: string, now: Date): string =>
  `${prefix}-${today(now).replace(/-/g, "")}-${randomBytes(3).toString("hex")}`;

export function parseEntries<F extends string>(markdown: string, labels: Labels<F>): Entry<F>[] {
  const entries: Entry<F>[] = [];
  let current: Entry<F> | undefined;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { id: "", title: heading[1]!.trim(), fields: {}, notes: [] };
      entries.push(current);
      continue;
    }
    const field = /^- \*\*([^*:]+):\*\* (.*)$/.exec(line);
    if (!current || !field) continue;
    const label = field[1]!;
    const value = field[2]!;
    if (label === "Id") current.id = value.trim();
    else if (label === "Note") current.notes.push(value.trim());
    else {
      const known = labels.find(([, name]) => name === label);
      if (known) current.fields[known[0]] = value.trim();
    }
  }
  return entries.filter((entry) => entry.id !== "");
}

export function renderEntry<F extends string>(entry: Entry<F>, labels: Labels<F>): string {
  const lines = [`## ${entry.title}`, "", `- **Id:** ${entry.id}`];
  for (const [key, label] of labels)
    if (entry.fields[key] !== undefined) lines.push(`- **${label}:** ${entry.fields[key]}`);
  for (const note of entry.notes) lines.push(`- **Note:** ${note}`);
  return lines.join("\n") + "\n";
}

/** An entry for `--json`: its fields at the top level (null when absent), no `fields` object. */
export type FlatEntry<F extends string> = { id: string; title: string } & Record<
  F,
  string | null
> & { notes: string[] };

export function flatEntry<F extends string>(entry: Entry<F>, labels: Labels<F>): FlatEntry<F> {
  const fields = Object.fromEntries(labels.map(([key]) => [key, entry.fields[key] ?? null]));
  return { id: entry.id, title: entry.title, ...fields, notes: entry.notes } as FlatEntry<F>;
}

export function readEntries<F extends string>(file: string, labels: Labels<F>): Entry<F>[] {
  return fs.existsSync(file) ? parseEntries(fs.readFileSync(file, "utf8"), labels) : [];
}

export function writeEntries<F extends string>(
  file: string,
  header: string,
  entries: Entry<F>[],
  labels: Labels<F>,
): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = entries.map((entry) => renderEntry(entry, labels)).join("\n");
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, header + (body ? `\n${body}` : ""));
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

/** The entry with `id`, or a ConfigError with `missing`. */
export function findEntry<F extends string>(
  entries: Entry<F>[],
  id: string,
  missing: string,
): Entry<F> {
  const found = entries.find((entry) => entry.id === id);
  if (!found) throw new ConfigError(missing);
  return found;
}
