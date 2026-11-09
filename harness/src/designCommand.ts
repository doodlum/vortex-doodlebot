/** `doodlebot design new|check|scope`: create, validate and enforce EGM design documents. */
import fs from "node:fs";
import path from "node:path";
import { ConfigError } from "./errors";
import { captureCheckoutIdentity } from "./evidence";
import {
  checkDesign,
  designTemplate,
  isApprovalIssue,
  outsideBoundary,
  parseDesign,
  relativeInside,
} from "./design";

export interface DesignCommandResult {
  code: number;
  stdout: string;
}

type Flags = Record<string, string | boolean>;

function text(flags: Flags, name: string): string | undefined {
  return typeof flags[name] === "string" ? flags[name] : undefined;
}

function readDesign(file: string | undefined, command: string): string {
  if (file === undefined) throw new ConfigError(`design ${command} needs a design file.`);
  if (!fs.existsSync(file)) throw new ConfigError(`${file} does not exist.`);
  return fs.readFileSync(file, "utf8");
}

export function designCommand(
  positional: string[],
  flags: Flags,
  today: () => string,
): DesignCommandResult {
  const [subcommand, file] = positional;
  const json = flags.json === true;

  if (subcommand === "new") {
    if (file === undefined) throw new ConfigError("design new needs a design file.");
    const title = text(flags, "title");
    if (title === undefined) throw new ConfigError("design new needs --title.");
    const target = text(flags, "target");
    if (target !== "vortex" && target !== "doodlebot")
      throw new ConfigError("design new needs --target vortex or doodlebot.");
    if (fs.existsSync(file)) throw new ConfigError(`${file} already exists.`);
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.writeFileSync(file, designTemplate(title, target, today()));
    return { code: 0, stdout: `Wrote ${file}` };
  }

  if (subcommand === "check") {
    const design = parseDesign(readDesign(file, "check"));
    const issues = checkDesign(design, { ready: flags.ready === true });
    const stdout = json
      ? JSON.stringify({ file, contentSha256: design.contentSha256, issues, design }, null, 2)
      : [
          `${issues.length === 0 ? "OK" : "ISSUES"} ${file}`,
          ...issues,
          `content sha256: ${design.contentSha256}`,
        ].join("\n");
    return { code: issues.length === 0 ? 0 : 1, stdout };
  }

  if (subcommand === "scope") {
    const checkout = text(flags, "checkout");
    const base = text(flags, "base");
    if (checkout === undefined || base === undefined)
      throw new ConfigError("design scope needs --checkout and --base.");
    const design = parseDesign(readDesign(file, "scope"));
    const identity = captureCheckoutIdentity(checkout, base);
    const designFile = relativeInside(identity.checkout, fs.realpathSync.native(file!));
    const boundary = design.boundary.map((b) => b.entry);
    const outside = outsideBoundary(identity.changedFiles, boundary, designFile);
    const approved =
      design.status === "Approved" && !checkDesign(design).some((issue) => isApprovalIssue(issue));
    const stdout = json
      ? JSON.stringify(
          {
            file,
            checkout: identity.checkout,
            base,
            approved,
            changedFiles: identity.changedFiles,
            boundary,
            outside,
          },
          null,
          2,
        )
      : [
          ...(outside.length === 0 ? ["IN SCOPE"] : outside.map((f) => `outside: ${f}`)),
          ...(approved ? [] : ["warning: design is not approved"]),
        ].join("\n");
    return { code: outside.length === 0 ? 0 : 1, stdout };
  }

  throw new ConfigError("Use design new, check or scope.");
}
