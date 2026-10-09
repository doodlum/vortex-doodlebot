import type { Page } from "@playwright/test";
import { BenchmarkBlocked } from "./types";

export interface CollectionCompletionSnapshot {
  collectionModId: string;
  viewVisible: boolean;
  driver: {
    step: string | null;
    installDone: boolean | null;
    postprocessing: boolean | null;
  } | null;
  progress: { visible: boolean; statuses: Record<string, number> };
}

/** Read the stock collection view's driver and progress panel without changing either. */
export async function inspectCollectionCompletion(
  page: Page,
  collectionModId: string,
): Promise<CollectionCompletionSnapshot> {
  return page.evaluate((id) => {
    const result: CollectionCompletionSnapshot = {
      collectionModId: id,
      viewVisible: false,
      driver: null,
      progress: { visible: false, statuses: {} },
    };
    const seenDrivers = new Set<object>();
    const seenRows = new Set<object>();
    const visible = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      if (!element.isConnected || bounds.width <= 0 || bounds.height <= 0) return false;
      for (let node: Element | null = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          style.display === "none" ||
          style.opacity === "0"
        )
          return false;
      }
      return true;
    };
    for (const element of document.querySelectorAll(
      ".collection-mods-panel, .collection-overview-panel, .collection-progress-flex",
    )) {
      const key = Object.keys(element).find(
        (name) => name.startsWith("__reactFiber") || name.startsWith("__reactInternalInstance"),
      );
      type Fiber = {
        memoizedProps?: {
          collection?: { id?: string };
          driver?: {
            collection?: { id?: string };
            lastCollection?: { id?: string };
            step?: unknown;
            installDone?: unknown;
            postprocessing?: unknown;
          };
          mods?: Record<string, { status?: string }>;
          onResume?: unknown;
          onPause?: unknown;
        };
        return?: Fiber;
      };
      let fiber = key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
      let driver: CollectionCompletionSnapshot["driver"] = null;
      let rows: Record<string, { status?: string }> | undefined;
      for (let depth = 0; fiber && depth < 50; depth++, fiber = fiber.return) {
        const props = fiber.memoizedProps;
        const candidate = props?.driver;
        // An active different collection must not be mistaken for the last completed one.
        if (
          candidate &&
          props?.collection?.id === id &&
          (candidate.collection?.id ?? candidate.lastCollection?.id) === id &&
          !seenDrivers.has(candidate)
        ) {
          seenDrivers.add(candidate);
          driver = {
            step: typeof candidate.step === "string" ? candidate.step : null,
            installDone: typeof candidate.installDone === "boolean" ? candidate.installDone : null,
            postprocessing:
              typeof candidate.postprocessing === "boolean" ? candidate.postprocessing : null,
          };
          result.driver = driver;
        } else if (
          candidate &&
          props?.collection?.id === id &&
          (candidate.collection?.id ?? candidate.lastCollection?.id) === id
        ) {
          driver = result.driver;
        }
        if (
          element.matches(".collection-progress-flex") &&
          !rows &&
          props?.mods &&
          ("onResume" in props || "onPause" in props)
        )
          rows = props.mods;
      }
      if (driver && visible(element)) result.viewVisible = true;
      if (driver && element.matches(".collection-progress-flex") && visible(element)) {
        result.progress.visible = true;
        if (rows && !seenRows.has(rows)) {
          seenRows.add(rows);
          for (const row of Object.values(rows)) {
            const status = row.status ?? "unknown";
            result.progress.statuses[status] = (result.progress.statuses[status] ?? 0) + 1;
          }
        }
      }
    }
    return result;
  }, collectionModId);
}

/** Required-member counts alone cannot certify the user-facing completion boundary. */
export async function waitForCollectionCompletion(
  page: Page,
  collectionModId: string,
  options: {
    timeoutMs: number;
    /** Grace for the completed driver's final render, within the overall timeout. */
    uiSettleMs?: number;
    onObservation: (snapshot: CollectionCompletionSnapshot) => void;
  },
): Promise<void> {
  const uiSettleMs = options.uiSettleMs ?? 30_000;
  if (
    !Number.isFinite(options.timeoutMs) ||
    options.timeoutMs <= 0 ||
    !Number.isFinite(uiSettleMs) ||
    uiSettleMs <= 0
  )
    throw new Error("Collection completion timeouts must be positive finite milliseconds");
  const until = Date.now() + options.timeoutMs;
  let contradictorySince: number | undefined;
  let last: CollectionCompletionSnapshot | undefined;
  const contradiction = (snapshot: CollectionCompletionSnapshot) =>
    new Error(
      "Collection driver finished but its UI still shows unfinished installation: " +
        JSON.stringify(snapshot.progress.statuses) +
        ". Retain this as a Vortex UI failure; do not resume skipped optional mods or hide the panel to obtain a pass.",
    );
  while (Date.now() < until) {
    const snapshot = await inspectCollectionCompletion(page, collectionModId);
    last = snapshot;
    options.onObservation(snapshot);
    if (
      !snapshot.viewVisible ||
      !snapshot.driver ||
      snapshot.driver.step === null ||
      snapshot.driver.installDone === null ||
      snapshot.driver.postprocessing === null
    )
      throw new BenchmarkBlocked(
        "Collection completion is unobservable: keep the pinned collection page open; this stock Vortex view must expose its install driver",
      );
    const terminal =
      snapshot.driver.installDone === true &&
      snapshot.driver.step === "review" &&
      snapshot.driver.postprocessing === false;
    if (terminal && !snapshot.progress.visible) return;
    if (terminal && snapshot.progress.visible) {
      contradictorySince ??= Date.now();
      if (Date.now() - contradictorySince >= uiSettleMs) throw contradiction(snapshot);
    } else contradictorySince = undefined;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (last && contradictorySince !== undefined) throw contradiction(last);
  throw new Error(
    "Collection install driver/UI did not reach a verified completion boundary before timeout",
  );
}
