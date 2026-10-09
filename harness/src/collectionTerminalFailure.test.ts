import { expect, it } from "vitest";
import {
  collectionTerminalFailure,
  type CollectionInstallObservation,
} from "./collectionTerminalFailure";

const observation = (): CollectionInstallObservation => ({
  driver: {
    found: true,
    collectionId: "pinned",
    step: "review",
    installDone: false,
    postprocessing: false,
  },
  session: {
    collectionId: "pinned",
    gameId: "skyrimse",
    statusCounts: { installed: 1850, failed: 7, ignored: 119 },
    typeCounts: { requires: 1857, recommends: 119 },
    outstanding: [],
    fields: { stalled: true },
  },
  dialogs: [
    {
      collectionId: "pinned",
      collectionName: "Gate To Sovngarde",
      via: "driver",
      step: "review",
      text: "Collection installation incomplete 7 mod could not be installed",
    },
  ],
});
const detect = (state: CollectionInstallObservation, optionals: "skip" | "install" = "skip") =>
  collectionTerminalFailure(state, "skyrimse", "pinned", optionals, true);

it("detects the native GTS review without requiring installDone or dismissing it", () => {
  const state = observation();
  expect(detect(state)).toMatch(/installation incomplete/);
  state.driver!.postprocessing = true;
  expect(detect(state)).toMatch(/installation incomplete/);
});

it.each([
  "foreign-driver",
  "last-only",
  "missing-driver",
  "foreign-dialog",
  "text-attribution",
  "foreign-game",
  "foreign-session",
  "installing",
])("does not attribute terminal failure from %s", (mode) => {
  const state = observation();
  if (mode === "foreign-driver") state.driver!.collectionId = "other";
  if (mode === "last-only") {
    delete state.driver!.collectionId;
    state.driver!.lastCollectionId = "pinned";
  }
  if (mode === "missing-driver") state.driver!.found = false;
  if (mode === "foreign-dialog") state.dialogs![0]!.collectionId = "other";
  if (mode === "text-attribution") state.dialogs![0]!.via = "text";
  if (mode === "foreign-game") state.session!.gameId = "other";
  if (mode === "foreign-session") state.session!.collectionId = "other";
  if (mode === "installing") state.driver!.step = "installing";
  expect(detect(state)).toBeUndefined();
});

it("does not confuse review before postprocessing with a terminal failure", () => {
  const state = observation();
  state.dialogs = [];
  state.session!.statusCounts = { installed: 1857, ignored: 119 };
  expect(detect(state)).toBeUndefined();
  state.driver!.postprocessing = true;
  expect(detect(state)).toBeUndefined();
});

it.each([
  "Collection installation complete\nCollection installation incomplete - a mod title",
  "Collection installation complete\nA message mentions collection installation incomplete",
])("does not treat text below a complete review heading as failure: %s", (text) => {
  const state = observation();
  state.dialogs![0]!.text = text;
  state.session!.statusCounts = { installed: 1857, ignored: 119 };
  expect(detect(state)).toBeUndefined();
});

it("detects the incomplete heading when DOM text joins it directly to the body", () => {
  const state = observation();
  state.dialogs![0]!.text = "Collection installation incomplete1 mod could not be installed";
  expect(detect(state)).toMatch(/installation incomplete/);
});

it("detects failed selected optionals even when required review says complete", () => {
  const state = observation();
  state.dialogs![0]!.text = "Collection installation complete";
  state.session!.outstanding = [{ id: "optional", status: "failed", type: "recommends" }];
  expect(detect(state, "install")).toMatch(/selected optional/);
  expect(detect(state, "skip")).toBeUndefined();
  for (const status of ["pending", "downloading", "installing", "downloaded", "unknown"]) {
    state.session!.statusCounts[status] = 1;
    expect(detect(state, "install")).toBeUndefined();
    delete state.session!.statusCounts[status];
  }
});
