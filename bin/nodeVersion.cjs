// The Node version check the `doodlebot` command runs before anything else: below the minimum in
// package.json's `engines.node` (20.19 when it names none) the CLI would fail later with a
// TypeError that says nothing about Node. Plain CommonJS that any old Node can run.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_MINIMUM = "20.19";

/** The `major.minor.patch` numbers of a version such as `v20.19.1` or `>=20.19`. */
function parts(version) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(version));
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : undefined;
}

/** The minimum Node version package.json's `engines.node` names, or 20.19. */
function minimumNode(root) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const engines = pkg && pkg.engines && pkg.engines.node;
    const found = typeof engines === "string" ? /(\d+(?:\.\d+){0,2})/.exec(engines) : null;
    return found ? found[1] : DEFAULT_MINIMUM;
  } catch {
    return DEFAULT_MINIMUM;
  }
}

/** The message to exit with when `version` is below `minimum`, or undefined. */
function nodeVersionProblem(version, minimum) {
  const have = parts(version);
  const need = parts(minimum);
  if (have === undefined || need === undefined) return undefined;
  for (let i = 0; i < 3; i++) {
    if (have[i] > need[i]) return undefined;
    if (have[i] < need[i]) return `doodlebot needs Node ${minimum} or newer; this is ${version}`;
  }
  return undefined;
}

module.exports = { DEFAULT_MINIMUM, minimumNode, nodeVersionProblem };
