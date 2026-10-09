import type { BenchmarkSession } from "./session";
import { BenchmarkBlocked, type PhaseEvent, type Exclusion } from "./types";

interface Entry {
  seq: number;
  receivedAt: number;
  args: unknown[];
}
interface Listener {
  kind: string;
  id: string;
  since: number;
}
type RecordItem = {
  state?: string;
  type?: string;
  localPath?: string;
  modInfo?: { nexus?: { ids?: { collectionId?: number } } };
  collectionId?: number | null;
};
const dictionary = (value: unknown): Record<string, RecordItem> =>
  value !== null && typeof value === "object" ? (value as Record<string, RecordItem>) : {};

export class CollectionDownloadFailed extends Error {}

/** Record Vortex's timestamped transitions, independently of the host's polling interval. */
export class CollectionRecorder {
  readonly phases: PhaseEvent[] = [];
  readonly exclusions: Exclusion[] = [];
  readonly seenDownloads = new Set<string>();
  readonly seenInstalls = new Set<string>();
  private completedDownloads = new Set<string>();
  private failedDownloads = new Set<string>();
  private completedInstalls = new Set<string>();
  private listeners: Listener[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight: Promise<unknown> = Promise.resolve();
  private stopped = false;
  private problem: unknown;
  private waits = new Map<string, { reason: Exclusion["reason"]; start: number }>();
  constructor(
    private readonly session: BenchmarkSession,
    private readonly warm: boolean,
    private readonly options: {
      warningsAsErrors: boolean;
      onWarning: (warning: import("../src/collections").CollectionWarning) => void;
    } = { warningsAsErrors: true, onWarning: () => undefined },
  ) {}
  async start(): Promise<void> {
    const gameId = this.session.gameId;
    for (const [kind, path] of [
      ["downloads", ["persistent", "downloads", "files"]],
      ["mods", ["persistent", "mods", gameId]],
      ["dialogs", ["session", "notifications", "dialogs"]],
    ] as const) {
      const { listenerId } = await this.session.call<{ listenerId: string }>(
        "watch_state_changes",
        {
          path,
          fields:
            kind === "downloads"
              ? { state: ["state"], collectionId: ["modInfo", "nexus", "ids", "collectionId"] }
              : kind === "mods"
                ? { state: ["state"], type: ["type"] }
                : { id: ["id"] },
        },
      );
      const { lastSeq } = await this.session.call<{ lastSeq: number }>("poll_listener", {
        listenerId,
      });
      this.listeners.push({ kind, id: listenerId, since: lastSeq });
    }
    for (const name of ["will-deploy", "did-deploy", "collection-postprocess-complete"]) {
      const { listenerId } = await this.session.call<{ listenerId: string }>("vortex_dispatch", {
        action: "onEvent",
        args: [name, "__CALLBACK__"],
      });
      const { lastSeq } = await this.session.call<{ lastSeq: number }>("poll_listener", {
        listenerId,
      });
      this.listeners.push({ kind: name, id: listenerId, since: lastSeq });
    }
    this.schedule();
  }
  markAdd(): void {
    this.edge("add", "start", Date.now(), "Add collection request (includes metadata resolution)");
  }
  private edge(
    phase: PhaseEvent["phase"],
    edge: PhaseEvent["edge"],
    at: number,
    source: string,
  ): void {
    const found = this.phases.find((e) => e.phase === phase && e.edge === edge);
    if (!found) this.phases.push({ phase, edge, at, source });
    else if (edge === "end" && at > found.at) {
      found.at = at;
      found.source = source;
    }
  }
  private wait(id: string, reason: Exclusion["reason"], active: boolean, at: number): void {
    if (active && !this.waits.has(id)) this.waits.set(id, { reason, start: at });
    if (!active) {
      const interval = this.waits.get(id);
      if (interval) {
        this.exclusions.push({ ...interval, end: at });
        this.waits.delete(id);
      }
    }
  }
  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.inFlight = this.poll()
        .catch((error) => {
          this.problem = error;
          this.stopped = true;
        })
        .finally(() => this.schedule());
    }, 100);
  }
  assertHealthy(): void {
    if (this.problem) throw this.problem;
  }
  private async poll(): Promise<boolean> {
    let received = false;
    for (const listener of this.listeners) {
      // Drain a burst before visiting other listeners. Keep response and work sizes
      // bounded, while consuming up to the ring's full capacity in one cycle.
      for (let page = 0; page < 4; page++) {
        const { entries, lastSeq } = await this.session.call<{ entries: Entry[]; lastSeq: number }>(
          "poll_listener",
          { listenerId: listener.id, since: listener.since, limit: 128 },
        );
        if (entries[0] && entries[0].seq !== listener.since + 1)
          throw new BenchmarkBlocked(
            `Timing events lost from ${listener.kind}; listener overflow, rerun without timing claims`,
          );
        listener.since = lastSeq;
        received ||= entries.length > 0;
        for (const entry of entries) this.consume(listener.kind, entry);
        if (entries.length < 128) break;
      }
    }
    return received;
  }
  private consume(kind: string, entry: Entry): void {
    const at = entry.receivedAt;
    if (kind === "will-deploy") this.edge("deploy", "start", at, "will-deploy event");
    else if (kind === "did-deploy") this.edge("deploy", "end", at, "did-deploy event");
    else if (kind === "collection-postprocess-complete")
      this.session.evidence.push({ event: kind, at });
    else if (kind === "dialogs") {
      const previous = Object.values(dictionary(entry.args[0])).filter(Boolean) as unknown as {
        id: string;
      }[];
      const current = Object.values(dictionary(entry.args[1])).filter(Boolean) as unknown as {
        id: string;
      }[];
      for (const item of current) this.wait(`dialog:${item.id}`, "user-wait", true, at);
      for (const item of previous)
        if (!current.some((d) => d.id === item.id))
          this.wait(`dialog:${item.id}`, "user-wait", false, at);
    } else {
      const previous = dictionary(entry.args[0]);
      const current = dictionary(entry.args[1]);
      for (const [id, item] of Object.entries(current)) {
        if (!item) {
          this.wait(`download:${id}`, "pause", false, at);
          continue;
        }
        const before = previous[id];
        if (kind === "downloads" && !item.collectionId && !item.modInfo?.nexus?.ids?.collectionId) {
          if (item.state === "started" && before?.state !== "started") {
            this.seenDownloads.add(id);
            this.completedDownloads.delete(id);
            this.edge("download", "start", at, "first member download entered started state");
          }
          if (item.state === "failed" && before?.state !== "failed" && this.seenDownloads.has(id)) {
            this.failedDownloads.add(id);
            this.session.evidence.push({ event: "member download failed", downloadId: id, at });
            this.options.onWarning({
              source: "download",
              id,
              at,
              originalSeverity: "error",
              message: "Observed failed collection member download " + id,
            });
          }
          this.wait(`download:${id}`, "pause", item.state === "paused", at);
          if (
            item.state === "finished" &&
            before?.state !== "finished" &&
            this.seenDownloads.has(id)
          ) {
            this.completedDownloads.add(id);
            this.edge(
              "download",
              "end",
              at,
              "last observed member download entered finished state",
            );
          }
        }
        if (kind === "mods") {
          if (
            item.type === "collection" &&
            item.state === "installed" &&
            before?.state !== "installed"
          )
            this.edge("add", "end", at, "collection manifest installed");
          if (
            item.type !== "collection" &&
            item.state === "installing" &&
            before?.state !== "installing"
          ) {
            this.seenInstalls.add(id);
            this.completedInstalls.delete(id);
            this.edge("install", "start", at, "first member entered installing state");
          }
          if (
            item.type !== "collection" &&
            item.state === "installed" &&
            before?.state !== "installed" &&
            this.seenInstalls.has(id)
          ) {
            this.completedInstalls.add(id);
            this.edge("install", "end", at, "last observed member entered installed state");
          }
        }
      }
    }
  }
  async stop(verifiedComplete = false): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.inFlight;
    this.assertHealthy();
    while (await this.poll()) {
      /* Drain all pages before validating phase boundaries. */
    }
    const at = Date.now();
    for (const [id, item] of this.waits) this.wait(id, item.reason, false, at);
    if (this.problem) throw this.problem;
    if (this.failedDownloads.size > 0 && (this.options.warningsAsErrors || !verifiedComplete))
      throw new CollectionDownloadFailed(
        "Collection member download failed; failed transfers remain in the benchmark evidence",
      );
    if (
      [...this.seenDownloads].some(
        (id) =>
          !this.completedDownloads.has(id) &&
          !(verifiedComplete && !this.options.warningsAsErrors && this.failedDownloads.has(id)),
      ) ||
      [...this.seenInstalls].some((id) => !this.completedInstalls.has(id))
    )
      throw new BenchmarkBlocked(
        "Observed collection member download/install remains incomplete; no final phase timing can be published",
      );
    for (const phase of [
      "add",
      "install",
      "deploy",
      ...(this.warm ? [] : ["download"]),
    ] as PhaseEvent["phase"][]) {
      const start = this.phases.find((e) => e.phase === phase && e.edge === "start");
      const end = this.phases.find((e) => e.phase === phase && e.edge === "end");
      if (!start || !end || end.at < start.at)
        throw new BenchmarkBlocked(
          `Missing valid ${phase} phase events in released Vortex; no guessed phase timing is published`,
        );
    }
    if (this.warm && this.seenDownloads.size > 0)
      throw new BenchmarkBlocked(
        "Warm run downloaded member archives: warm-cache precondition was not met",
      );
  }
}
