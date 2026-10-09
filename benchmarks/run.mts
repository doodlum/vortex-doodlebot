import { allCases, catalog } from "./catalog";
import { runSuite } from "./runner";

let list = false;
let repeats = 3;
let selection: string[] | undefined;
let outputDir = `harness/.artifacts/proposal-benchmarks/${new Date().toISOString().replace(/[:.]/g, "-")}`;
const args = process.argv.slice(2).filter((arg) => arg !== "--");
for (let index = 0; index < args.length; index++) {
  const arg = args[index]!;
  if (arg === "--list") {
    list = true;
    continue;
  }
  const equals = arg.indexOf("=");
  const flag = equals === -1 ? arg : arg.slice(0, equals);
  if (!["--select", "--repeats", "--output"].includes(flag))
    throw new Error(`Unknown argument: ${arg}`);
  const value = equals === -1 ? args[++index] : arg.slice(equals + 1);
  if (!value || value.startsWith("--")) throw new Error(`Missing value for ${flag}`);
  if (flag === "--select") {
    selection = value.split(",").map((id) => id.trim());
    if (selection.some((id) => !id)) throw new Error("Selection contains an empty ID");
  } else if (flag === "--repeats") {
    repeats = Number(value);
    if (!Number.isInteger(repeats) || repeats < 1)
      throw new Error("Repeats must be a positive integer");
  } else outputDir = value;
}
if (selection) {
  const known = new Set(allCases.map((item) => item.id));
  const unknown = selection.filter((id) => !known.has(id));
  if (unknown.length) throw new Error(`Unknown case IDs: ${unknown.join(", ")}`);
}
const selected = selection ? new Set(selection) : undefined;
const groups = catalog
  .map((group) => ({
    ...group,
    cases: group.cases.filter((item) => !selected || selected.has(item.id)),
  }))
  .filter((group) => group.cases.length > 0);
if (list) {
  for (const item of groups.flatMap((group) => group.cases))
    console.log(`${item.id}\t${item.dataset}\t${item.name}`);
} else {
  const passed = await runSuite({
    groups,
    repeats,
    outputDir,
    label: "Proposal benchmark run; conditions and budgets require agreement",
  });
  if (!passed) process.exitCode = 1;
}
