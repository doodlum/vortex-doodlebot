/**
 * `doodlebot knowledge`: lessons an agent has verified on this machine, kept outside the
 * workspace in `~/.doodlebot/knowledge.md` so they survive `update` and re-setup, are shared by
 * Claude Code and Codex, and never make the workspace dirty. `search` also reads the shared,
 * reviewed `KNOWLEDGE.md` of the workspace. A local lesson is a lead to recheck against the
 * current code, never a fact; a lesson that keeps holding goes to doodlebot as a pull request.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { REPO_ROOT, USER_STATE_DIR } from "./paths";

export const KNOWLEDGE_FILE = path.join(USER_STATE_DIR, "knowledge.md");
export const SHARED_KNOWLEDGE_FILE = path.join(REPO_ROOT, "KNOWLEDGE.md");

/** The fields of an entry, in the order they are written. */
export const FIELDS = [
  ["area", "Area"],
  ["symptom", "Symptom"],
  ["cause", "Cause"],
  ["remedy", "Remedy"],
  ["scope", "Scope"],
  ["evidence", "Evidence"],
  ["vortex", "Vortex"],
  ["seen", "Seen"],
] as const;
type Field = (typeof FIELDS)[number][0];
const REQUIRED: Field[] = ["area", "symptom", "cause", "remedy", "scope", "evidence"];

export interface Lesson {
  id: string;
  title: string;
  fields: Partial<Record<Field, string>>;
}
export interface Match {
  source: "local" | "shared";
  id?: string;
  title: string;
  text: string;
}

const HEADER =
  "# Local doodlebot knowledge\n\n" +
  "Lessons verified on this machine by `doodlebot knowledge add`. Each is a lead to recheck\n" +
  "against the current code, not a fact. Share one that keeps holding as a pull request to\n" +
  "doodlebot's KNOWLEDGE.md.\n";

/**
 * Text that looks like a credential: a bearer header, or an unbroken run of 32 or more
 * base64-style characters mixing letters and digits. Hyphens, dots and slashes break a run, so
 * paths and slugs pass; pure hex (a commit SHA or digest) passes too.
 */
function looksSecret(value: string): boolean {
  if (/\bBearer\s+\S{8,}/i.test(value)) return true;
  return (value.match(/[A-Za-z0-9+_=]{32,}/g) ?? []).some(
    (run) => /\d/.test(run) && /[A-Za-z]/.test(run) && !/^[0-9a-fA-F]+$/.test(run),
  );
}

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

export function parseLessons(markdown: string): Lesson[] {
  const lessons: Lesson[] = [];
  let current: Lesson | undefined;
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) {
      current = { id: "", title: heading[1]!.trim(), fields: {} };
      lessons.push(current);
      continue;
    }
    const field = /^- \*\*([A-Za-z]+):\*\* (.*)$/.exec(line);
    if (!current || !field) continue;
    if (field[1] === "Id") current.id = field[2]!.trim();
    const known = FIELDS.find(([, label]) => label === field[1]);
    if (known) current.fields[known[0]] = field[2]!.trim();
  }
  return lessons.filter((lesson) => lesson.id !== "");
}

function render(lesson: Lesson): string {
  const lines = [`## ${lesson.title}`, "", `- **Id:** ${lesson.id}`];
  for (const [key, label] of FIELDS)
    if (lesson.fields[key] !== undefined) lines.push(`- **${label}:** ${lesson.fields[key]}`);
  return lines.join("\n") + "\n";
}

function readLessons(file: string): Lesson[] {
  return fs.existsSync(file) ? parseLessons(fs.readFileSync(file, "utf8")) : [];
}

function writeLessons(file: string, lessons: Lesson[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const body = lessons.map(render).join("\n");
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, HEADER + (body ? `\n${body}` : ""));
  fs.renameSync(temp, file);
}

export function addLesson(
  values: { title: string } & Partial<Record<Field, string>>,
  file = KNOWLEDGE_FILE,
  now = new Date(),
): Lesson {
  const missing = ["title", ...REQUIRED].filter((key) => !values[key as Field | "title"]?.trim());
  if (missing.length > 0)
    throw new ConfigError(
      `knowledge add needs ${missing.map((key) => `--${key}`).join(", ")}. ` +
        "Record only a lesson whose cause you checked; keep guesses in the run report.",
    );
  for (const [key, value] of Object.entries(values))
    if (typeof value === "string" && looksSecret(value))
      throw new ConfigError(
        `--${key} looks like it holds a credential or token. Never store secrets in knowledge.`,
      );
  const lessons = readLessons(file);
  const title = oneLine(values.title);
  if (lessons.some((lesson) => lesson.title.toLowerCase() === title.toLowerCase()))
    throw new ConfigError(
      `A local lesson titled "${title}" exists; remove it first or choose another title.`,
    );
  const date = now.toISOString().slice(0, 10);
  const lesson: Lesson = {
    id: `k-${date.replace(/-/g, "")}-${randomBytes(3).toString("hex")}`,
    title,
    fields: {},
  };
  for (const [key] of FIELDS)
    if (key !== "seen" && values[key]?.trim()) lesson.fields[key] = oneLine(values[key]!);
  lesson.fields.seen = date;
  writeLessons(file, [...lessons, lesson]);
  return lesson;
}

export function removeLesson(id: string, file = KNOWLEDGE_FILE): Lesson {
  const lessons = readLessons(file);
  const found = lessons.find((lesson) => lesson.id === id);
  if (!found) throw new ConfigError(`No local lesson with id ${id}; see doodlebot knowledge list.`);
  writeLessons(
    file,
    lessons.filter((lesson) => lesson !== found),
  );
  return found;
}

/** `## ` sections of the shared KNOWLEDGE.md, each with its heading and text. */
function sharedSections(file: string): { title: string; text: string }[] {
  if (!fs.existsSync(file)) return [];
  // Each `### ` entry is one lesson, titled "<area> › <entry>"; text under a `## ` area heading
  // before its first entry is a section of its own.
  const sections: { title: string; text: string }[] = [];
  let area = "";
  for (const block of fs
    .readFileSync(file, "utf8")
    .replace(/\r\n/g, "\n")
    .split(/^(?=#{2,3} )/m)) {
    const heading = /^(#{2,3}) (.+)$/m.exec(block);
    if (!heading || !block.startsWith(heading[1]!)) continue;
    const name = heading[2]!.trim();
    if (heading[1] === "##") area = name;
    const text = block.trim();
    if (heading[1] === "##" && text === `## ${name}`) continue;
    sections.push({ title: heading[1] === "###" && area ? `${area} › ${name}` : name, text });
  }
  return sections;
}

/** Entries holding every word (case-insensitive), local lessons first. */
export function searchKnowledge(
  words: string[],
  files: { local?: string; shared?: string } = {},
): Match[] {
  const terms = words.map((word) => word.toLowerCase()).filter(Boolean);
  if (terms.length === 0) throw new ConfigError("knowledge search needs one or more words.");
  const holds = (text: string): boolean => {
    const lower = text.toLowerCase();
    return terms.every((term) => lower.includes(term));
  };
  const local = readLessons(files.local ?? KNOWLEDGE_FILE)
    .map((lesson) => ({
      source: "local" as const,
      id: lesson.id,
      title: lesson.title,
      text: render(lesson).trim(),
    }))
    .filter((match) => holds(match.text));
  const shared = sharedSections(files.shared ?? SHARED_KNOWLEDGE_FILE)
    .map((section) => ({ source: "shared" as const, ...section }))
    .filter((match) => holds(match.text));
  return [...local, ...shared];
}

const USAGE = "Use doodlebot knowledge add|search|list|remove|path (see doodlebot --help).";

export function knowledgeCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  files: { local?: string; shared?: string } = {},
): string {
  const local = files.local ?? KNOWLEDGE_FILE;
  const json = flags.json === true;
  const [sub, ...rest] = positional;
  switch (sub) {
    case "path":
      return local;
    case "add": {
      const value = (key: string): string | undefined =>
        typeof flags[key] === "string" ? (flags[key] as string) : undefined;
      const lesson = addLesson(
        {
          title: value("title") ?? "",
          ...Object.fromEntries(FIELDS.map(([key]) => [key, value(key)])),
        },
        local,
      );
      return json
        ? JSON.stringify(lesson, null, 2)
        : `added ${lesson.id}: ${lesson.title} (${local})`;
    }
    case "list": {
      const lessons = readLessons(local);
      if (json) return JSON.stringify(lessons, null, 2);
      return lessons.length === 0
        ? `No local lessons yet (${local}).`
        : lessons.map((lesson) => `${lesson.id}  ${lesson.title}`).join("\n");
    }
    case "remove": {
      if (!rest[0]) throw new ConfigError("knowledge remove needs a lesson id.");
      const lesson = removeLesson(rest[0], local);
      return `removed ${lesson.id}: ${lesson.title}`;
    }
    case "search": {
      const matches = searchKnowledge(rest, { local, shared: files.shared });
      if (json) return JSON.stringify(matches, null, 2);
      if (matches.length === 0) return `No knowledge matches ${rest.join(" ")}.`;
      return matches
        .map(
          (match) =>
            `[${match.source}${match.id ? ` ${match.id}` : ""}] ${match.title}\n${match.text}`,
        )
        .join("\n\n");
    }
    default:
      throw new ConfigError(USAGE);
  }
}
