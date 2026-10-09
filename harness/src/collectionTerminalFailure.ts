import type { DriverState, DialogCollection, SessionSummary } from "../../src/collectionState";

export interface CollectionInstallObservation {
  driver?: DriverState;
  session: SessionSummary | null;
  dialogs?: (DialogCollection & { step?: string | null; text?: string })[];
}

/** Read-only: native review failures end an attempt; historical warnings do not. */
export function collectionTerminalFailure(
  native: CollectionInstallObservation,
  gameId: string,
  collectionModId: string,
  optionalMods: "skip" | "install",
  optionalIncomplete: boolean,
): string | undefined {
  if (
    native.driver?.found !== true ||
    native.driver.collectionId !== collectionModId ||
    native.driver.step !== "review"
  )
    return;
  const session = native.session;
  if (session && (session.collectionId !== collectionModId || session.gameId !== gameId)) return;
  if (
    native.dialogs?.some(
      (dialog) =>
        dialog.collectionId === collectionModId &&
        (dialog.via === "driver" || dialog.via === "collection-prop") &&
        dialog.step === "review" &&
        /^collection installation incomplete/i.test(dialog.text ?? ""),
    )
  )
    return "Vortex reports Collection installation incomplete";

  const terminal = new Set(["installed", "failed", "ignored"]);
  if (
    optionalMods === "install" &&
    optionalIncomplete &&
    session &&
    Object.entries(session.statusCounts).every(
      ([status, count]) => count === 0 || terminal.has(status),
    ) &&
    session.outstanding?.some(
      (member) => member.type === "recommends" && member.status === "failed",
    )
  )
    return "Vortex finished review with failed selected optional members";
}
