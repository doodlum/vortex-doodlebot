/**
 * EGM design documents as doodlebot reads them: structure, approval and file boundary.
 * Pure functions; callers read files. The format is specified in designs/egm-workflow.md.
 */
import { createHash } from "node:crypto";
import path from "node:path";

export const designStatuses = ["Draft", "Proposed", "In Review", "Approved"] as const;
export const contractNames = [
  "runtime",
  "ui",
  "persistent-data",
  "public-api",
  "performance",
] as const;
/** Required level-2 sections, then the level-3 Verification Plan. */
export const requiredSections = [
  "Overview",
  "The Problem",
  "Goals",
  "Non-Goals",
  "Open Questions",
  "Acceptance Criteria",
  "Affected Contracts",
  "Technical Plan (Architecture)",
  "Alternatives Considered",
  "Detailed Implementation Plan",
  "Verification Plan",
] as const;

export interface DesignDocument {
  title?: string;
  author?: string;
  status?: string;
  target?: string;
  approvedLine?: string;
  approval?: { by: string; contentSha256: string; reference: string };
  acceptance: { id: string; criterion: string }[];
  contracts: string[];
  noContracts: boolean;
  boundary: { entry: string; generated: boolean }[];
  unparsedBoundaryHeadings: string[];
  /** Every level-2 and level-3 heading name. */
  sections: string[];
  headings: { level: number; name: string }[];
  openQuestions: string[];
  tbd: boolean;
  contentSha256: string;
}

const HEADER = /^\s*[-*]\s+\*\*(Author|Status|Target|Date|Approved):\*\*\s*(.+?)\s*$/;
const DIGEST_EXCLUDED = /^\s*[-*]\s+\*\*(Status|Date|Approved):\*\*/;
const APPROVED = /^(.+?);\s*content\s+([a-f0-9]{64});\s*(.+)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const BOUNDARY_HEADING = /^\d+[a-z]?\.\s/;
const BOUNDARY_ENTRY = /^\d+[a-z]?\.\s+`([^`]+)`\s+\((Create|Modify|Delete)\)\s*$/;

function normalize(markdown: string): string {
  return markdown.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

/**
 * SHA-256 of the body: BOM removed, CRLF as LF, and the header block's Status, Date and
 * Approved bullets deleted, so approving a design does not change its digest.
 */
export function designContentSha256(markdown: string): string {
  const kept: string[] = [];
  let inHeader = true;
  let fenced = false;
  for (const line of normalize(markdown).split("\n")) {
    if (FENCE.test(line)) fenced = !fenced;
    else if (!fenced) {
      // The header ends where parseDesign's does: the first level-2 heading outside a fence.
      if (HEADING.exec(line)?.[1]?.length === 2) inHeader = false;
      if (inHeader && DIGEST_EXCLUDED.test(line)) continue;
    }
    kept.push(line);
  }
  return createHash("sha256").update(kept.join("\n")).digest("hex");
}

interface Line {
  text: string;
  fenced: boolean;
}

/** Bullets in a line range, each with its continuation lines joined by single spaces. */
function bullets(lines: Line[], from: number, to: number): string[] {
  const found: string[] = [];
  let current: string | undefined;
  const flush = (): void => {
    if (current !== undefined) found.push(current.replace(/\s+/g, " ").trim());
    current = undefined;
  };
  for (let i = from; i < to; i++) {
    const { text, fenced } = lines[i]!;
    if (fenced || FENCE.test(text) || HEADING.test(text) || text.trim() === "") {
      flush();
      continue;
    }
    const bullet = BULLET.exec(text);
    if (bullet !== null) {
      flush();
      current = bullet[1]!;
    } else if (current !== undefined) current += ` ${text.trim()}`;
  }
  flush();
  return found;
}

export function parseDesign(markdown: string): DesignDocument {
  const text = normalize(markdown);
  const lines: Line[] = [];
  let fenced = false;
  for (const raw of text.split("\n")) {
    if (FENCE.test(raw)) {
      lines.push({ text: raw, fenced: true });
      fenced = !fenced;
      continue;
    }
    lines.push({ text: raw, fenced });
  }
  const headings: { level: number; name: string; index: number }[] = [];
  lines.forEach(({ text: line, fenced: inFence }, index) => {
    const match = inFence ? null : HEADING.exec(line);
    if (match !== null) headings.push({ level: match[1]!.length, name: match[2]!, index });
  });
  /** The line range of a section: to the next heading of the same or a higher level. */
  const section = (name: string, level: number): [number, number] | undefined => {
    const start = headings.findIndex((h) => h.level === level && h.name === name);
    if (start === -1) return undefined;
    const end = headings.slice(start + 1).find((h) => h.level <= level);
    return [headings[start]!.index + 1, end?.index ?? lines.length];
  };

  const design: DesignDocument = {
    acceptance: [],
    contracts: [],
    noContracts: false,
    boundary: [],
    unparsedBoundaryHeadings: [],
    sections: headings.filter((h) => h.level === 2 || h.level === 3).map((h) => h.name),
    headings: headings.map(({ level, name }) => ({ level, name })),
    openQuestions: [],
    tbd: false,
    contentSha256: designContentSha256(markdown),
  };
  design.title = headings.find((h) => h.level === 1)?.name;

  const firstLevel2 = headings.find((h) => h.level === 2)?.index ?? lines.length;
  for (let i = 0; i < firstLevel2; i++) {
    if (lines[i]!.fenced) continue;
    const match = HEADER.exec(lines[i]!.text);
    if (match === null) continue;
    const value = match[2]!;
    const unquoted = value.replace(/`/g, "").trim();
    if (match[1] === "Author") design.author ??= unquoted;
    if (match[1] === "Status") design.status ??= unquoted;
    if (match[1] === "Target") design.target ??= unquoted;
    if (match[1] === "Approved" && design.approvedLine === undefined) {
      design.approvedLine = value;
      const approval = APPROVED.exec(unquoted);
      if (approval !== null)
        design.approval = {
          by: approval[1]!.trim(),
          contentSha256: approval[2]!,
          reference: approval[3]!.trim(),
        };
    }
  }

  const acceptance = section("Acceptance Criteria", 2);
  if (acceptance !== undefined)
    for (const bullet of bullets(lines, ...acceptance)) {
      const match = /^`([a-z0-9][a-z0-9-]*)`:\s*(.*)$/.exec(bullet);
      if (match !== null) design.acceptance.push({ id: match[1]!, criterion: match[2]!.trim() });
    }

  const contracts = section("Affected Contracts", 2);
  if (contracts !== undefined)
    for (const bullet of bullets(lines, ...contracts)) {
      if (/^none\b/i.test(bullet)) design.noContracts = true;
      else {
        const match = /^`([^`]+)`/.exec(bullet);
        if (match !== null) design.contracts.push(match[1]!);
      }
    }

  const scope = section("Target Scope & File Boundary", 3);
  if (scope !== undefined)
    for (const bullet of bullets(lines, ...scope)) {
      const generated = /\bgenerated\b/i.test(bullet.replace(/`[^`]*`/g, ""));
      for (const match of bullet.matchAll(/`([^`]+)`/g))
        design.boundary.push({ entry: match[1]!.trim(), generated });
    }
  const plan = section("Detailed Implementation Plan", 2);
  if (plan !== undefined)
    for (const heading of headings)
      if (heading.level === 4 && heading.index >= plan[0] && heading.index < plan[1]) {
        if (!BOUNDARY_HEADING.test(heading.name)) continue;
        const match = BOUNDARY_ENTRY.exec(heading.name);
        if (match === null) design.unparsedBoundaryHeadings.push(heading.name);
        else design.boundary.push({ entry: match[1]!.trim(), generated: false });
      }

  const questions = section("Open Questions", 2);
  if (questions !== undefined)
    design.openQuestions = bullets(lines, ...questions).filter(
      (q) => q.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase() !== "none",
    );

  design.tbd = lines.some(
    ({ text: line, fenced: inFence }) => !inFence && /\bTBD\b/.test(line.replace(/`[^`]*`/g, "")),
  );
  return design;
}

export function checkDesign(design: DesignDocument, options: { ready?: boolean } = {}): string[] {
  const issues: string[] = [];
  if (design.title === undefined) issues.push("missing title");
  if (design.status === undefined) issues.push("missing status");
  else if (!(designStatuses as readonly string[]).includes(design.status))
    issues.push(`unknown status ${design.status}`);
  if (design.target === undefined) issues.push("missing target");
  else if (design.target !== "vortex" && design.target !== "doodlebot")
    issues.push(`unknown target ${design.target}`);
  const level2 = new Set(design.headings.filter((h) => h.level === 2).map((h) => h.name));
  for (const name of requiredSections) {
    const present =
      name === "Verification Plan"
        ? design.headings.some((h) => h.level === 3 && h.name === name)
        : level2.has(name);
    if (!present) issues.push(`missing section ${name}`);
  }
  if (design.acceptance.length === 0) issues.push("no acceptance criteria");
  const seen = new Set<string>();
  for (const { id } of design.acceptance) {
    if (seen.has(id)) issues.push(`duplicate acceptance id ${id}`);
    seen.add(id);
  }
  for (const contract of design.contracts)
    if (!(contractNames as readonly string[]).includes(contract))
      issues.push(`unknown contract ${contract}`);
  if (design.contracts.length === 0 && !design.noContracts)
    issues.push("no affected contracts declared");
  if (design.boundary.length === 0) issues.push("empty file boundary");
  for (const { entry, generated } of design.boundary) {
    const normalized = slashed(entry);
    if (!generated && (normalized.endsWith("/") || normalized.includes("**")))
      issues.push(`broad boundary entry ${entry}`);
  }
  for (const heading of design.unparsedBoundaryHeadings)
    issues.push(`unparsed boundary heading ${heading}`);
  const approved = design.status === "Approved";
  if (!approved && design.approvedLine !== undefined)
    issues.push("Approved line on an unapproved design");
  if (approved) {
    if (design.approvedLine === undefined) issues.push("approved without an Approved line");
    else if (design.approval === undefined) issues.push("malformed Approved line");
    else if (design.approval.contentSha256 !== design.contentSha256)
      issues.push(
        `approval digest ${design.approval.contentSha256} does not match content ${design.contentSha256}`,
      );
  }
  if (approved || options.ready === true) {
    if (design.openQuestions.length > 0) issues.push("open questions remain");
    if (design.tbd) issues.push("TBD remains");
  }
  return issues;
}

/** Issues that concern only the Approved line, as opposed to the design's content. */
export function isApprovalIssue(issue: string): boolean {
  return (
    issue === "approved without an Approved line" ||
    issue === "malformed Approved line" ||
    issue.startsWith("approval digest ")
  );
}

function slashed(file: string): string {
  return file.replace(/\\/g, "/").replace(/^\.\//, "");
}

function globRegExp(entry: string): RegExp {
  let source = "";
  for (let i = 0; i < entry.length; i++) {
    if (entry.startsWith("**", i)) {
      source += ".*";
      i++;
    } else if (entry[i] === "*") source += "[^/]*";
    else source += entry[i]!.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Exact path, directory ending in `/`, or glob (`*` within a segment, `**` across). */
export function inBoundary(file: string, boundary: string[]): boolean {
  const target = slashed(file);
  return boundary.some((raw) => {
    const entry = slashed(raw);
    if (entry.endsWith("/")) return target.startsWith(entry);
    return entry.includes("*") ? globRegExp(entry).test(target) : entry === target;
  });
}

export function outsideBoundary(
  changed: string[],
  boundary: string[],
  designFile?: string,
): string[] {
  const exempt = designFile === undefined ? undefined : slashed(designFile);
  return changed.filter((file) => slashed(file) !== exempt && !inBoundary(file, boundary));
}

/** `file` relative to `root` with forward slashes, or undefined when it lies outside. */
export function relativeInside(root: string, file: string): string | undefined {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (
    relative === "" ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return undefined;
  return relative.replace(/\\/g, "/");
}

export function designTemplate(
  title: string,
  target: "vortex" | "doodlebot",
  date: string,
): string {
  const scope = target === "doodlebot" ? "- `designs/SITEMAP.md`\n\n" : "";
  return `# ${title}

- **Author:** <name>
- **Status:** Draft
- **Target:** ${target}
- **Date:** ${date}

---

## Overview

## The Problem

## Goals

## Non-Goals

## Open Questions

None.

## Acceptance Criteria

## Affected Contracts

## Critical User Journeys (CUJs)

## Technical Plan (Architecture)

## Alternatives Considered

## Non-Functional Requirements

## Detailed Implementation Plan

### Target Scope & File Boundary

${scope}### Target Files to Create/Modify

### Verification Plan
`;
}
