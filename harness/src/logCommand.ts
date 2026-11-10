/**
 * `doodlebot log [--level info|warn|error] [--tail <n>] [--since <ISO time>] [--json]`: the
 * running instance's own Vortex log (`<userDataDir>/vortex.log`), filtered. Each entry keeps the
 * continuation lines (stack frames and the like) that follow its first line.
 */
import fs from "node:fs";
import path from "node:path";

import { ConfigError } from "./errors";
import { parseLogLine, type LogEntry } from "./vortexLog";

export type LogLevel = "info" | "warn" | "error";

export interface LogOptions {
  /** The lowest level kept (default warn). */
  level?: LogLevel;
  /** Keep the last n matches (default 50). */
  tail?: number;
  /** Keep entries at or after this time. */
  since?: string;
}

export interface LogBlock {
  entry: LogEntry;
  /** The raw first line, then its continuation lines. */
  lines: string[];
}

const RANK: Record<string, number> = { silly: 0, debug: 0, verbose: 0, info: 1, warn: 2, error: 3 };

/** debug, silly and verbose < info < warn < error; an unrecognised level counts as info. */
export function levelRank(level: string): number {
  return RANK[level.toLowerCase()] ?? RANK.info!;
}

/** Split a log into entries, each with the lines `parseLogLine` rejects that follow it. */
export function logBlocks(text: string): LogBlock[] {
  const blocks: LogBlock[] = [];
  for (const line of text.split(/\r?\n/)) {
    const entry = parseLogLine(line);
    if (entry !== undefined) blocks.push({ entry, lines: [line.trimEnd()] });
    else if (blocks.length > 0 && line.trim() !== "") blocks.at(-1)!.lines.push(line.trimEnd());
  }
  return blocks;
}

export function filterLog(text: string, options: LogOptions = {}): LogBlock[] {
  const threshold = levelRank(options.level ?? "warn");
  const since = options.since === undefined ? undefined : Date.parse(options.since);
  const tail = options.tail ?? 50;
  const matches = logBlocks(text).filter(
    ({ entry }) =>
      levelRank(entry.level) >= threshold &&
      (since === undefined || Date.parse(entry.time) >= since),
  );
  return tail === 0 ? [] : matches.slice(-tail);
}

/** As `LogEntry[]`, with each entry's continuation lines appended to its message. */
export function blocksAsEntries(blocks: LogBlock[]): LogEntry[] {
  return blocks.map(({ entry, lines }) => ({
    ...entry,
    message: [entry.message, ...lines.slice(1)].join("\n"),
  }));
}

export function logOptionsFrom(flags: Record<string, string | boolean>): LogOptions {
  const options: LogOptions = {};
  if (flags.level !== undefined) {
    const level = typeof flags.level === "string" ? flags.level.toLowerCase() : "";
    if (level !== "info" && level !== "warn" && level !== "error")
      throw new ConfigError("--level must be info, warn or error.");
    options.level = level;
  }
  if (flags.tail !== undefined) {
    const tail = typeof flags.tail === "string" ? Number(flags.tail) : Number.NaN;
    if (!Number.isInteger(tail) || tail < 0)
      throw new ConfigError("--tail must be a whole number of entries.");
    options.tail = tail;
  }
  if (flags.since !== undefined) {
    if (typeof flags.since !== "string" || Number.isNaN(Date.parse(flags.since)))
      throw new ConfigError("--since must be an ISO time, e.g. 2026-11-10T09:30:00Z.");
    options.since = flags.since;
  }
  return options;
}

export function vortexLogFile(userDataDir: string): string {
  return path.join(userDataDir, "vortex.log");
}

/** The text `log` prints for a log file. */
export function logCommand(file: string, flags: Record<string, string | boolean>): string {
  const options = logOptionsFrom(flags);
  if (!fs.existsSync(file)) throw new ConfigError(`No Vortex log at ${file} yet.`);
  const blocks = filterLog(fs.readFileSync(file, "utf8"), options);
  return flags.json === true
    ? JSON.stringify(blocksAsEntries(blocks), null, 2)
    : blocks.map((block) => block.lines.join("\n")).join("\n");
}
