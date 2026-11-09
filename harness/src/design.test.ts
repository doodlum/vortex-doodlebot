import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkDesign,
  designContentSha256,
  designTemplate,
  inBoundary,
  outsideBoundary,
  parseDesign,
  relativeInside,
} from "./design";
import { REPO_ROOT } from "./paths";

/** A minimal complete design; `parts` overrides sections or header lines. */
function design(
  parts: {
    header?: string;
    acceptance?: string;
    contracts?: string;
    questions?: string;
    scope?: string;
    plan?: string;
    body?: string;
  } = {},
): string {
  return `# Title

${parts.header ?? "- **Status:** In Review\n- **Target:** doodlebot\n- **Date:** 2026-01-01"}

## Overview

Text.${parts.body ?? ""}

## The Problem

## Goals

## Non-Goals

## Open Questions

${parts.questions ?? "None."}

## Acceptance Criteria

${parts.acceptance ?? "- `works`: It works."}

## Affected Contracts

${parts.contracts ?? "- None: nothing."}

## Technical Plan (Architecture)

## Alternatives Considered

## Detailed Implementation Plan

### Target Scope & File Boundary

${parts.scope ?? "- `src/a.ts`"}

### Target Files to Create/Modify

${parts.plan ?? ""}

### Verification Plan
`;
}

function approve(markdown: string, digest = designContentSha256(markdown)): string {
  return markdown.replace(
    "- **Status:** In Review",
    `- **Status:** Approved\n- **Approved:** Person; content ${digest}; https://example.test/approval`,
  );
}

describe("design template", () => {
  it("reports exactly the sections an author must still fill", () => {
    expect(checkDesign(parseDesign(designTemplate("T", "vortex", "2026-01-01")))).toEqual([
      "no acceptance criteria",
      "no affected contracts declared",
      "empty file boundary",
    ]);
    expect(checkDesign(parseDesign(designTemplate("T", "doodlebot", "2026-01-01")))).toEqual([
      "no acceptance criteria",
      "no affected contracts declared",
    ]);
  });
});

describe("parseDesign", () => {
  it("reads the header from bullets before the first section, first match winning", () => {
    const parsed = parseDesign(
      design({
        header:
          "- **Status:** In Review\n- **Status:** Approved\n- **Target:** `vortex`\n- **Author:** A",
        body: "\n\nThe header uses `**Status:**` and\n- **Target:** doodlebot in prose.\n\n```text\n- **Status:** Draft\n```",
      }),
    );
    expect(parsed.status).toBe("In Review");
    expect(parsed.target).toBe("vortex");
    expect(parsed.author).toBe("A");
    expect(parsed.title).toBe("Title");
  });

  it("joins continuation lines, even unindented ones, and code spans across lines", () => {
    const parsed = parseDesign(
      design({
        acceptance: "- `a`: First\npart `inline\ncode` end.\n- `b`: Second.",
        scope: "- `x/one.ts`, `x/two.ts` and\n`x/three.ts`\n- `generated/**` (generated)",
      }),
    );
    expect(parsed.acceptance).toEqual([
      { id: "a", criterion: "First part `inline code` end." },
      { id: "b", criterion: "Second." },
    ]);
    expect(parsed.boundary).toEqual([
      { entry: "x/one.ts", generated: false },
      { entry: "x/two.ts", generated: false },
      { entry: "x/three.ts", generated: false },
      { entry: "generated/**", generated: true },
    ]);
  });

  it("reads contracts, ignoring backticks on a None bullet", () => {
    expect(parseDesign(design({ contracts: "- None: `inferredContracts` agrees." }))).toMatchObject(
      { contracts: [], noContracts: true },
    );
    expect(
      parseDesign(design({ contracts: "- `runtime`: launch.\n- `ui`: pages.\n- prose" })),
    ).toMatchObject({ contracts: ["runtime", "ui"], noContracts: false });
  });

  it("counts open questions except a None bullet in any case", () => {
    expect(parseDesign(design({ questions: "- none." })).openQuestions).toEqual([]);
    expect(parseDesign(design({ questions: "- None" })).openQuestions).toEqual([]);
    expect(parseDesign(design({ questions: "- Which port?" })).openQuestions).toEqual([
      "Which port?",
    ]);
  });

  it("adds numbered plan headings to the boundary and reports unparsed ones", () => {
    const parsed = parseDesign(
      design({
        plan: "#### 1. `src/b.ts` (Create)\n\n#### 2a. `src/c.ts` (Delete)\n\n#### 3. Several files (Modify)\n\n#### Notes",
      }),
    );
    expect(parsed.boundary.map((b) => b.entry)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(parsed.unparsedBoundaryHeadings).toEqual(["3. Several files (Modify)"]);
  });

  it("finds an undecided marker only outside code", () => {
    expect(parseDesign(design({ body: " Use `TBD` here." })).tbd).toBe(false);
    expect(parseDesign(design({ body: "\n\n```\nTBD\n```" })).tbd).toBe(false);
    expect(parseDesign(design({ body: " Port TBD." })).tbd).toBe(true);
  });
});

describe("content digest", () => {
  it("ignores approval edits, line endings and a BOM, and changes with the body", () => {
    const base = design();
    const digest = designContentSha256(base);
    expect(designContentSha256(approve(base))).toBe(digest);
    expect(designContentSha256(base.replace("2026-01-01", "2026-02-02"))).toBe(digest);
    expect(designContentSha256(`﻿${base.replace(/\n/g, "\r\n")}`)).toBe(digest);
    expect(designContentSha256(base.replace("Text.", "Other text."))).not.toBe(digest);
  });

  it("ends the header where parseDesign does, ignoring fenced lines", () => {
    // A fenced "## " line does not end the header; a fenced Date bullet stays in the digest.
    const fencedHeading = design().replace("# Title\n", "# Title\n\n```\n## not a section\n```\n");
    expect(designContentSha256(approve(fencedHeading))).toBe(designContentSha256(fencedHeading));
    const fencedDate = design().replace("# Title\n", "# Title\n\n```\n- **Date:** 1999\n```\n");
    expect(designContentSha256(fencedDate.replace("1999", "2000"))).not.toBe(
      designContentSha256(fencedDate),
    );
  });
});

describe("checkDesign", () => {
  it("accepts a complete in-review design and a correctly approved one", () => {
    expect(checkDesign(parseDesign(design()))).toEqual([]);
    expect(checkDesign(parseDesign(approve(design())))).toEqual([]);
  });

  it("reports structural problems in order", () => {
    const broken = design({
      header: "- **Status:** Finished\n- **Target:** game",
      acceptance: "- `a`: One.\n- `a`: Two.",
      contracts: "- `speed`: fast.",
      scope: "- `src/`\n- `lib/**`",
      plan: "#### 1. Lots (Modify)",
    }).replace("## Goals\n", "");
    expect(checkDesign(parseDesign(broken))).toEqual([
      "unknown status Finished",
      "unknown target game",
      "missing section Goals",
      "duplicate acceptance id a",
      "unknown contract speed",
      "broad boundary entry src/",
      "broad boundary entry lib/**",
      "unparsed boundary heading 1. Lots (Modify)",
    ]);
    expect(checkDesign(parseDesign("# Only a title\n"))).toContain("missing status");
    const untitled = design({ header: "- **Status:** In Review" }).replace("# Title\n", "");
    expect(checkDesign(parseDesign(untitled))).toEqual(["missing title", "missing target"]);
  });

  it("does not call a generated boundary entry broad", () => {
    expect(checkDesign(parseDesign(design({ scope: "- `generated/**` (generated)" })))).toEqual([]);
  });

  it("parses a backticked Approved value and requires Verification Plan at level 3", () => {
    const base = design();
    const quoted = base.replace(
      "- **Status:** In Review",
      `- **Status:** Approved\n- **Approved:** \`Person; content ${designContentSha256(base)}; https://example.test/ok\``,
    );
    expect(checkDesign(parseDesign(quoted))).toEqual([]);
    expect(
      checkDesign(parseDesign(base.replace("### Verification Plan", "## Verification Plan"))),
    ).toEqual(["missing section Verification Plan"]);
  });

  it("treats a backslash directory entry as broad, as the boundary match does", () => {
    expect(checkDesign(parseDesign(design({ scope: "- `harness\\`" })))).toEqual([
      "broad boundary entry harness\\",
    ]);
    expect(inBoundary("harness/src/a.ts", ["harness\\"])).toBe(true);
  });

  it("reports approval problems", () => {
    const base = design();
    expect(checkDesign(parseDesign(base.replace("In Review", "Approved")))).toEqual([
      "approved without an Approved line",
    ]);
    expect(
      checkDesign(
        parseDesign(base.replace("In Review", "Approved\n- **Approved:** someone said yes")),
      ),
    ).toEqual(["malformed Approved line"]);
    const stale = approve(base).replace("Text.", "Edited after approval.");
    expect(checkDesign(parseDesign(stale))[0]).toMatch(
      /^approval digest [a-f0-9]{64} does not match content/,
    );
    expect(
      checkDesign(
        parseDesign(base.replace("In Review", "In Review\n- **Approved:** x; content y; z")),
      ),
    ).toEqual(["Approved line on an unapproved design"]);
  });

  it("checks open questions and undecided markers when approved or ready", () => {
    const open = design({ questions: "- Which port?", body: " Port TBD." });
    expect(checkDesign(parseDesign(open))).toEqual([]);
    expect(checkDesign(parseDesign(open), { ready: true })).toEqual([
      "open questions remain",
      "TBD remains",
    ]);
    expect(checkDesign(parseDesign(approve(open)))).toEqual([
      "open questions remain",
      "TBD remains",
    ]);
  });

  it("accepts this repository's own approved design", () => {
    const own = fs.readFileSync(path.join(REPO_ROOT, "designs", "egm-workflow.md"), "utf8");
    expect(checkDesign(parseDesign(own))).toEqual([]);
  });
});

describe("file boundary", () => {
  it.each([
    ["src/a.ts", ["src/a.ts"], true],
    ["src/a.ts", ["./src/a.ts"], true],
    ["src\\a.ts", ["src/a.ts"], true],
    ["src/deep/a.ts", ["src/"], true],
    ["src/a.ts", ["src/*.ts"], true],
    ["src/deep/a.ts", ["src/*.ts"], false],
    ["src/deep/a.ts", ["src/**"], true],
    ["src", ["src/**"], false],
    ["srcXa.ts", ["src.a.ts"], false],
    ["src/a?.ts", ["src/a?.ts"], true],
    ["src/ab.ts", ["src/a?.ts"], false],
    ["src/[x].ts", ["src/[x].ts"], true],
    ["src/x.ts", ["src/[x].ts"], false],
    ["SRC/a.ts", ["src/a.ts"], false],
    ["src/a.b.ts", ["src/*.b.ts"], true],
    ["src/aXb.ts", ["src/a.*"], false],
    ["src/x?b", ["src/*?b"], true],
    ["src/xyb", ["src/*?b"], false],
    ["src/a[x].ts", ["src/*[x].ts"], true],
    ["src/ax.ts", ["src/*[x].ts"], false],
  ])("%s in %j is %s", (file, boundary, expected) => {
    expect(inBoundary(file, boundary)).toBe(expected);
  });

  it("exempts the design file and keeps input order", () => {
    expect(
      outsideBoundary(["z.ts", "designs/d.md", "a.ts", "in.ts"], ["in.ts"], "designs/d.md"),
    ).toEqual(["z.ts", "a.ts"]);
  });

  it("makes a path relative to a root only when inside it", () => {
    const root = path.resolve("/repo");
    expect(relativeInside(root, path.join(root, "designs", "d.md"))).toBe("designs/d.md");
    expect(relativeInside(root, path.resolve("/elsewhere/d.md"))).toBeUndefined();
    expect(relativeInside(root, root)).toBeUndefined();
    // A child folder whose name starts with two dots is inside.
    expect(relativeInside(root, path.join(root, "..drafts", "d.md"))).toBe("..drafts/d.md");
    expect(relativeInside(root, path.join(root, ".."))).toBeUndefined();
  });
});
