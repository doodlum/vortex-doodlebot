# Collection and table performance plan

The 7 October 2026 proposal defines baseline performance coverage for collections and large tables. Its timings, data, hardware, bandwidth, and acceptable slowdown are still decisions to make. Keep unresolved values as **TBD**; a runnable example does not approve a target.

The suite includes **five** timed benchmarks, B1–B5, plus four table areas, T1–T4. Collections whose names are undecided are excluded. B1–B5 run against the four named collections, giving **20 collection cases** in the original matrix. GTS now runs twice: base Skyrim with optionals skipped, and paid Anniversary content with optionals installed. That adds five cases, for **25 collection cases** before repeats. Hardware conditions and performance budgets remain undecided until agreed.

## Collection benchmarks

| ID  | Measure                     | Starting condition                                            | Finish                                                       |
| --- | --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------ |
| B1  | Cold collection install     | Empty downloads; no installed collection                      | Collection deployed and game-specific readiness check passes |
| B2  | Warm collection install     | All required archives already cached; no installed collection | Same as B1                                                   |
| B3  | Full deploy                 | Collection installed; deployed files purged                   | Deployment complete                                          |
| B4  | Deploy with nothing changed | Collection installed and already deployed                     | Redeployment complete                                        |
| B5  | Vortex startup              | Large collection installed                                    | Fresh app launch reaches a usable Mods page                  |

For B1 and B2, start the overall clock at **Add collection**. Record phase start/end events for Add, Download, Install, and Deploy. These phases overlap: Vortex can extract one mod while another downloads. Do not sum phase durations to obtain total time.

Exclude known user waits and pauses from active elapsed time, and keep their intervals in the report. Pre-answer installer choices where possible. If a required phase or readiness event cannot be observed, explain the gap and block that measurement rather than substitute a guessed time.

Game launch is outside the timed window. A deployment check should establish the agreed game readiness without measuring game startup, script compilation, or load time.

## Real collection matrix

These revisions were resolved from Nexus on 8 October 2026 and remain fixed when a curator publishes an update. The counts describe listed members, including any optional members. Installation still needs a compatible game, private login, and the curator's prerequisites.

| Code  | Candidate                                                                                                                               | Engine / game                | Size                        | B1  | B2  | B3  | B4  | B5  |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | --------------------------- | --- | --- | --- | --- | --- |
| C1    | [Immersive & Adult](https://www.nexusmods.com/games/skyrimspecialedition/collections/xxsqm4/revisions/104)                              | Creation / Skyrim SE         | Revision 104; 566 members   | Yes | Yes | Yes | Yes | Yes |
| C2    | [Gate to Sovngarde — base, skip optionals](https://www.nexusmods.com/games/skyrimspecialedition/collections/qdurkx/revisions/118)       | Creation / Skyrim SE         | Revision 118; 1,976 members | Yes | Yes | Yes | Yes | Yes |
| C2-AE | [Gate to Sovngarde — paid AE, install optionals](https://www.nexusmods.com/games/skyrimspecialedition/collections/qdurkx/revisions/118) | Creation / Skyrim SE         | Revision 118; 1,976 members | Yes | Yes | Yes | Yes | Yes |
| C3    | [Constellations](https://www.nexusmods.com/games/skyrimspecialedition/collections/9zfscf/revisions/121)                                 | Creation / Skyrim SE         | Revision 121; 2,444 members | Yes | Yes | Yes | Yes | Yes |
| C5    | [Night City: Femme Fatale PLUS](https://www.nexusmods.com/games/cyberpunk2077/collections/p0qfwm/revisions/94)                          | REDengine 4 / Cyberpunk 2077 | Revision 94; 2,896 members  | Yes | Yes | Yes | Yes | Yes |

The proposal marks C1's agreement as uncertain and the other named entries as proposed. These pins make test data repeatable; they do not approve a release baseline. Skyrim and Cyberpunk essentials, both Unreal collections, and the Stardew collection are excluded until actual collections are chosen.

## Table responsiveness

| ID  | Area                   | Actions to check                                                          |
| --- | ---------------------- | ------------------------------------------------------------------------- |
| T1  | Mods                   | Scroll, sort, group, ungroup, search, filter, enable, disable, select all |
| T2  | Load order and Plugins | Scroll, drag to reorder, sort, enable, disable                            |
| T3  | Downloads              | Scroll, sort, filter with thousands of archives                           |
| T4  | Background cost        | Operate other pages while a large Mods list remains installed             |

Candidate counts are **150**, **570**, **1,594**, and **2,685**. These are local test sizes, not agreed release criteria.

Check the actual consequence of each action: changed row order, group display, matching rows, enabled state, selection, or reorder state. Report input delay, blocked time, settling time, and worst frame where the measurement supports them. Opening a page or dispatching a state update alone does not prove that its control works.

Plugins and Load Order are game-specific pages. Supply their real game data and control mapping; missing pages are blocked coverage. Generating arbitrary Mods rows does not exercise a Bethesda plugin parser, a game-specific load-order extension, or a real Nexus download.

## Real and synthetic data answer different questions

Every app test drives the real released Vortex. That alone does not make its mods or downloads real. Choose the data for the question you want to answer:

| Test form                        | What Vortex handles                                                                             | Network during timing                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Synthetic table test             | Generated mod files or ZIP archives and their table records                                     | No Nexus downloads                                                                                    |
| Offline collection fixture       | A generated collection with small bundled test members, installed by Vortex's collection driver | No Nexus downloads; this is still synthetic data                                                      |
| Local archive with game support  | A local test archive installed using a particular game's extension or plugin parser             | No Nexus downloads; generated contents remain synthetic                                               |
| B1: cold real collection         | Actual members of a pinned Nexus collection revision                                            | Genuine member downloads from Nexus and any required external sources                                 |
| B2: warm real collection         | The same genuine member archives, downloaded during preparation and reused for installation     | No member downloads should occur; metadata requests may still need the network                        |
| B3–B5: installed real collection | Actual installed members from that pinned revision                                              | Installation preparation may download; the measured deploy or startup does not measure download speed |

**Cached does not mean synthetic.** B2 uses genuine collection archives. Likewise, a generated ZIP shown in Vortex's real Downloads page was never downloaded from Nexus. A generated plugin parsed by a real game extension remains a test fixture.

The proposal's B cases use actual Nexus collections. Offline collection fixtures help test driver behavior quickly; they cannot replace those benchmarks. T1, T3, and T4 use generated data. The supplied T2 recipe installs real collection data before operating the game's Plugins or Load Order page; it does not substitute arbitrary Mods records.

Real collections exercise Nexus metadata, download access, installers, rules, and engine-specific deployment. Synthetic local libraries quickly reproduce table and file-count costs. They can complement the real runs but must be labeled synthetic.

Synthetic archives in the Downloads table test local row handling. They do not measure internet throughput. Keep local timings separate from B1/B2 and from the engine coverage matrix.

## Conditions to agree

Fix and record the following before comparing runs:

- Hardware, storage, and whether game and Vortex share a drive.
- Network speed or throttling for cold downloads.
- Nexus account profile and download entitlement.
- Windows version and security scanning settings.
- Released Vortex installer version.
- Starting game, profile, installed-mod state, and cold/warm cache state.
- Window size, Windows display scaling, and Vortex UI zoom for table tests.
- Repeat count; the proposal suggests three runs and their median.
- Absolute targets or allowed slowdown from baseline.

The SDK can record supplied conditions and apply supplied budgets. It does not choose these values for the group. An exploratory local run can describe the machine actually used, but should not be called an approved baseline.

The proposal's discussion limits—input delay under 200 ms, settling under 0.5 s, worst frame under 50 ms, and blocked time close to zero—are **proposed**, not approved. Do not silently turn them into default pass/fail budgets.

## Optional additions

Collection update, purge, profile/game switching, and memory growth are suggested extensions. Add them as separate cases if needed; mark them optional until they are accepted into the plan. Switching and updates need suitable fixtures and verification, and memory work needs a clearly defined sampling interval.

Next: [run a benchmark](benchmarks.md), [add a case](adding-benchmarks.md), or [read results](results.md).
