# Vortex Change Standard

This standard defines what a design of a Vortex change, or a doodlebot change, must say so that
the change can be **proved** on a real Vortex with doodlebot. It extends EGM's feature-spec and
implementation-readiness standards: use those for the design's soundness, structure and
actionability, and this one for runtime proof.

## Core Principle

A design passes if a fresh agent with doodlebot and the stated authorizations can implement it
inside the listed files and then prove every acceptance criterion on a real Vortex, without
choosing a build, content or a check itself.

## Requirements

- **Acceptance criteria with ids**: each criterion has a short unique id, so QA reports and the
  pull request can name it.
- **Proof for each criterion**: the doodlebot command or test that proves it (`/doodlebot:try`,
  `/doodlebot:qa --design`, a `doodlebot test` check, a Vortex unit test), the observation that
  settles it (UI state, deployed files, Vortex state, a game process; a tool returning success is
  not an observation), and:
  - **the build** it runs on: a released Vortex version (doodlebot fetches official releases
    from GitHub), the source base, or the change;
  - **the content** it needs, as needs rather than names: the sandbox, a game copy of a given
    kind, an offline collection, a Nexus login. Doodlebot chooses the content from what the
    machine has, and an unmet need is "not tested".
- **A negative control for each criterion**: the base or an unfixed build shows the old
  behaviour, so the check could fail. A bug fix needs an assertion that fails without the fix; a
  feature needs absent-behaviour evidence; a refactor needs its invariants and consumers.
- **Reproduction** (behaviour changes reported by someone): their scenario on their version, the
  symptom on the base, and the observation that will show it gone.
- **QA catalogue**: the entries of `harness/qa/catalog.json` that guard the touched Vortex
  areas and will be run, and any entry the change should add, with its pass criterion and needs.
- **Prerequisites and authorizations**: Nexus login, Premium, a purchased game, a real
  collection, someone's own data, building someone else's code, push and PR, stated as the person
  granted them. A logout spends the real login and needs the person's go-ahead.
- **Affected contracts**: `runtime`, `ui`, `persistent-data`, `public-api` or `performance`, or
  "none".
- **File boundary**: every source file, test, document and regenerated reference the change
  touches.
- **Compatibility** (doodlebot changes): the extension keeps working against stock, released
  Vortex; main-process work is in the harness over CDP. Every check runs on a released Vortex.
- **UI and performance**: a state and window-size matrix for UI changes; production builds, a
  comparable baseline and at least three runs per side for performance claims.
