import os from "node:os";
import path from "node:path";
import type { RunManifest } from "../harness/benchmarks/index";
import type { Configuration } from "./types";
import { downloadsInBackground, downloadsWorkload } from "./workloads";

// Formal conditions are deliberately undecided. Do not silently approve targets.
export const localManifest: RunManifest = {
  profile: {
    hardware: "TBD: agreed CPU, RAM and GPU profile",
    storage: "TBD: drive class and whether game and Vortex share a drive",
    bandwidth: "n/a: local synthetic data",
    account: "anonymous",
    osSecurity: "TBD: Windows version and security scanning settings",
    vortexBuild: "TBD: released installer version",
  },
  synthetic: { count: 150, filesPerMod: 3 },
};

export const configuration: Configuration = {
  localManifest,
  realProfile: {
    ...localManifest.profile,
    account: "premium",
    bandwidth: "TBD: agreed connection or throttle",
  },
  // Configure C1, C2 (base), C2-AE (paid content), C3 and C5 (see README).
  // Absence is a prerequisite, not a synthetic collection or an approval.
  collections: {},
  // Configure each table through realGameTable(bindings) from workloads.ts.
  gameTables: {},
  downloads: downloadsWorkload,
  background: { workloads: [downloadsInBackground] },
};

/** Actual host metadata for a convenience run; no agreed budgets or profile. */
export function exploratoryManifest(): RunManifest {
  const temporary = os.tmpdir();
  return {
    profile: {
      hardware: `${os.cpus()[0]?.model ?? "CPU model unavailable"}; ${os.cpus().length} logical CPUs; ${Math.round(os.totalmem() / 2 ** 30)} GiB RAM; exploratory machine`,
      storage: `Temporary workspace: ${temporary}; volume ${path.parse(temporary).root}; drive class not audited`,
      bandwidth: "n/a: local synthetic data",
      account: "anonymous",
      osSecurity: `${os.type()} ${os.release()} ${os.arch()}; security settings not audited for exploratory smoke`,
      vortexBuild:
        "Auto-located released Vortex; runtime version and executable hash recorded in evidence",
    },
    synthetic: { count: 150, filesPerMod: 3 },
  };
}
