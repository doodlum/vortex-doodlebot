import { buildCatalog } from "./catalog";
import { configuration, exploratoryManifest } from "./config";
import { runSuite } from "./runner";

const groups = buildCatalog({ ...configuration, localManifest: exploratoryManifest() })
  .map((group) => ({
    ...group,
    cases: group.cases.filter((item) => item.id === "T1-scroll-150"),
  }))
  .filter((group) => group.cases.length > 0);
const passed = await runSuite({
  groups,
  repeats: 1,
  outputDir: "harness/.artifacts/proposal-smoke",
  label: "Exploratory smoke; actual host metadata; no approved baseline or timing budgets",
});
if (!passed) process.exitCode = 1;
