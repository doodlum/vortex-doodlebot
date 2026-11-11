/**
 * `doodlebot knowledge`: lessons an agent has verified on this machine, kept outside the
 * workspace in `~/.doodlebot/knowledge.md` so they survive `update` and re-setup, are shared by
 * Claude Code and Codex, and never make the workspace dirty. `search` also reads the shared,
 * reviewed `KNOWLEDGE.md` of the workspace. A local lesson is a lead to recheck against the
 * current code, never a fact. `note` records that a lesson did not hold; `share` turns one into a
 * GitHub issue for the maintainer (share.ts).
 */
import fs from "node:fs";
import path from "node:path";

import {
  type Entry,
  type FlatEntry,
  findEntry,
  flatEntry,
  guardValues,
  newId,
  oneLine,
  parseEntries,
  readEntries,
  renderEntry,
  today,
  writeEntries,
} from "./entryStore";
import { ConfigError } from "./errors";
import { REPO_ROOT, USER_STATE_DIR } from "./paths";
import { type ShareDeps, shareEntry } from "./share";

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
  ["thirdParty", "Third-party"],
  ["issue", "Issue"],
] as const;
type Field = (typeof FIELDS)[number][0];
const REQUIRED: Field[] = ["area", "symptom", "cause", "remedy", "scope", "evidence", "vortex"];
/** The fields `knowledge add` takes as flags (`--third-party` for thirdParty). */
const INPUT: Field[] = [...REQUIRED, "thirdParty"];
const flagName = (key: string): string => (key === "thirdParty" ? "third-party" : key);

export type Lesson = Entry<Field>;
/** A search match. A local lesson's match also carries its fields at the top level. */
export type Match =
  | ({ source: "local"; text: string } & FlatEntry<Field>)
  | { source: "shared"; id?: undefined; title: string; text: string };

/** A lesson for `--json`: `area`, `symptom` and the other fields at the top level. */
export const flatLesson = (lesson: Lesson): FlatEntry<Field> => flatEntry(lesson, FIELDS);

const HEADER =
  "# Local doodlebot knowledge\n\n" +
  "Lessons verified on this machine by `doodlebot knowledge add`. Each is a lead to recheck\n" +
  "against the current code, not a fact. Share one that keeps holding with\n" +
  "`doodlebot knowledge share <id>`.\n";

export function parseLessons(markdown: string): Lesson[] {
  return parseEntries(markdown, FIELDS);
}

const readLessons = (file: string): Lesson[] => readEntries(file, FIELDS);
const writeLessons = (file: string, lessons: Lesson[]): void =>
  writeEntries(file, HEADER, lessons, FIELDS);

export function addLesson(
  values: { title: string } & Partial<Record<Field, string>>,
  file = KNOWLEDGE_FILE,
  now = new Date(),
): Lesson {
  const missing = ["title", ...REQUIRED].filter((key) => !values[key as Field | "title"]?.trim());
  if (missing.length > 0)
    throw new ConfigError(
      `knowledge add needs ${missing.map((key) => `--${key}`).join(", ")}. ` +
        "Record only a lesson whose cause you checked, with the Vortex version it was confirmed " +
        "on; keep guesses in the run report.",
    );
  guardValues(
    Object.fromEntries(Object.entries(values).map(([key, value]) => [flagName(key), value])),
    "knowledge",
  );
  const lessons = readLessons(file);
  const title = oneLine(values.title);
  if (lessons.some((lesson) => lesson.title.toLowerCase() === title.toLowerCase()))
    throw new ConfigError(
      `A local lesson titled "${title}" exists; remove it first or choose another title.`,
    );
  const lesson: Lesson = { id: newId("k", now), title, fields: {}, notes: [] };
  for (const key of INPUT) if (values[key]?.trim()) lesson.fields[key] = oneLine(values[key]!);
  lesson.fields.seen = today(now);
  writeLessons(file, [...lessons, lesson]);
  return lesson;
}

const missingLesson = (id: string): string =>
  `No local lesson with id ${id}; see doodlebot knowledge list.`;

export function removeLesson(id: string, file = KNOWLEDGE_FILE): Lesson {
  const lessons = readLessons(file);
  const found = findEntry(lessons, id, missingLesson(id));
  writeLessons(
    file,
    lessons.filter((lesson) => lesson !== found),
  );
  return found;
}

/**
 * Append a dated note, such as "does not hold on 2.9.0 (<report>)". Removing the lesson stays
 * the owner's decision.
 */
export function noteLesson(
  id: string,
  text: string,
  file = KNOWLEDGE_FILE,
  now = new Date(),
): Lesson {
  if (text.trim() === "") throw new ConfigError("knowledge note needs an id and the note's text.");
  guardValues({ note: text }, "knowledge");
  const lessons = readLessons(file);
  const found = findEntry(lessons, id, missingLesson(id));
  found.notes.push(`${today(now)}: ${oneLine(text)}`);
  writeLessons(file, lessons);
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

/**
 * Local lessons whose title (case-insensitive) is also a shared `KNOWLEDGE.md` entry, as an
 * `### ` entry name or its `<area> › <entry>` title: once the maintainer has added a lesson, the
 * local copy is a duplicate the person may remove (design 4.10).
 */
export function duplicateLessons(files: { local?: string; shared?: string } = {}): Lesson[] {
  const shared = new Set(
    sharedSections(files.shared ?? SHARED_KNOWLEDGE_FILE).flatMap((section) => [
      section.title.toLowerCase(),
      (section.title.split(" › ").at(-1) ?? section.title).toLowerCase(),
    ]),
  );
  return readLessons(files.local ?? KNOWLEDGE_FILE).filter((lesson) =>
    shared.has(lesson.title.toLowerCase()),
  );
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
    .map((lesson): Match => ({
      source: "local",
      ...flatLesson(lesson),
      text: renderEntry(lesson, FIELDS).trim(),
    }))
    .filter((match) => holds(match.text));
  const shared = sharedSections(files.shared ?? SHARED_KNOWLEDGE_FILE)
    .map((section): Match => ({ source: "shared", ...section }))
    .filter((match) => holds(match.text));
  return [...local, ...shared];
}

/** The fields a share publishes: everything but the third-party data and the issue link. */
function shareable(lesson: Lesson): [string, string][] {
  return FIELDS.filter(([key]) => key !== "thirdParty" && key !== "issue")
    .filter(([key]) => lesson.fields[key] !== undefined)
    .map(([key, label]) => [label, lesson.fields[key]!]);
}

const USAGE =
  "Use doodlebot knowledge add|search|list|remove|note|share|path (see doodlebot --help).";

export function knowledgeCommand(
  positional: string[],
  flags: Record<string, string | boolean>,
  files: { local?: string; shared?: string } = {},
  deps: ShareDeps = {},
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
          ...Object.fromEntries(INPUT.map((key) => [key, value(flagName(key))])),
        },
        local,
      );
      return json
        ? JSON.stringify(flatLesson(lesson), null, 2)
        : `added ${lesson.id}: ${lesson.title} (${local})`;
    }
    case "list": {
      const lessons = readLessons(local);
      if (json) return JSON.stringify(lessons.map(flatLesson), null, 2);
      return lessons.length === 0
        ? `No local lessons yet (${local}).`
        : lessons.map((lesson) => `${lesson.id}  ${lesson.title}`).join("\n");
    }
    case "remove": {
      if (!rest[0]) throw new ConfigError("knowledge remove needs a lesson id.");
      const lesson = removeLesson(rest[0], local);
      return `removed ${lesson.id}: ${lesson.title}`;
    }
    case "note": {
      const [id, ...words] = rest;
      if (!id) throw new ConfigError("knowledge note needs an id and the note's text.");
      const lesson = noteLesson(id, words.join(" "), local);
      return json
        ? JSON.stringify(flatLesson(lesson), null, 2)
        : `noted ${lesson.id}: ${lesson.notes[lesson.notes.length - 1]!}`;
    }
    case "share": {
      if (!rest[0]) throw new ConfigError("knowledge share needs a lesson id.");
      const lessons = readLessons(local);
      const lesson = findEntry(lessons, rest[0], missingLesson(rest[0]));
      return shareEntry(
        "knowledge",
        {
          id: lesson.id,
          title: lesson.title,
          fields: shareable(lesson),
          notes: lesson.notes,
          thirdParty: lesson.fields.thirdParty,
          issue: lesson.fields.issue,
        },
        flags,
        (url) => {
          lesson.fields.issue = url;
          writeLessons(local, lessons);
        },
        deps,
      );
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
