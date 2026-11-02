import type { ElectronApplication, Page } from "@playwright/test";

interface AppEvent {
  elapsedMs: number;
  event: string;
  details?: unknown;
}

interface ObservedWindow {
  id: number;
  isVisible(): boolean;
  isFocused(): boolean;
  webContents: {
    getURL(): string;
    isLoading(): boolean;
    getOSProcessId(): number;
    isCrashed(): boolean;
  };
}

async function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("App diagnostics did not respond within 3s")),
          3_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Independent process and navigation evidence when the renderer's RPC stops responding. */
export async function observeApp(
  app: ElectronApplication,
  page: Page,
): Promise<() => Promise<unknown>> {
  const started = Date.now();
  const events: AppEvent[] = [];
  const child = app.process();
  const key = `__doodlebotCoreObservation${started}`;
  const record = (event: string, details?: unknown) =>
    events.push({ elapsedMs: Date.now() - started, event, details });
  const onExit = (code: number | null, signal: string | null) =>
    record("main-process-exit", { code, signal });
  const onClose = () => record("page-close");
  const onCrash = () => record("page-crash");
  child.on("exit", onExit);
  page.on("close", onClose);
  page.on("crash", onCrash);
  let setupError: string | undefined;
  try {
    await bounded(
      app.evaluate(({ BrowserWindow }, observationKey) => {
        const observed: AppEvent[] = [];
        const began = Date.now();
        const dispose: Array<() => void> = [];
        for (const win of BrowserWindow.getAllWindows()) {
          const contents = win.webContents;
          const note = (event: string, details?: unknown) => {
            if (observed.length < 100)
              observed.push({ elapsedMs: Date.now() - began, event, details });
          };
          const navigation = (_event: unknown, url: string, inPlace: boolean, mainFrame: boolean) =>
            note("did-start-navigation", { windowId: win.id, url, inPlace, mainFrame });
          const loaded = () => note("did-finish-load", { windowId: win.id });
          const failed = (
            _event: unknown,
            code: number,
            description: string,
            url: string,
            mainFrame: boolean,
          ) => note("did-fail-load", { windowId: win.id, code, description, url, mainFrame });
          const gone = (_event: unknown, details: { reason: string; exitCode: number }) =>
            note("render-process-gone", { windowId: win.id, ...details });
          contents.on("did-start-navigation", navigation);
          contents.on("did-finish-load", loaded);
          contents.on("did-fail-load", failed);
          contents.on("render-process-gone", gone);
          dispose.push(() => {
            contents.off("did-start-navigation", navigation);
            contents.off("did-finish-load", loaded);
            contents.off("did-fail-load", failed);
            contents.off("render-process-gone", gone);
          });
        }
        Reflect.set(globalThis, observationKey, {
          events: observed,
          dispose: () => dispose.forEach((stop) => stop()),
        });
      }, key),
    );
  } catch (error) {
    setupError = error instanceof Error ? error.message : String(error);
  }
  return async () => {
    child.off("exit", onExit);
    page.off("close", onClose);
    page.off("crash", onCrash);
    let main: unknown;
    try {
      main = await bounded(
        app.evaluate(({ BrowserWindow }, observationKey) => {
          const observation = Reflect.get(globalThis, observationKey) as
            | { events: AppEvent[]; dispose: () => void }
            | undefined;
          const windows = BrowserWindow.getAllWindows().map((win: ObservedWindow) => ({
            id: win.id,
            visible: win.isVisible(),
            focused: win.isFocused(),
            url: win.webContents.getURL(),
            loading: win.webContents.isLoading(),
            rendererPid: win.webContents.getOSProcessId(),
            crashed: win.webContents.isCrashed(),
          }));
          observation?.dispose();
          Reflect.deleteProperty(globalThis, observationKey);
          return { events: observation?.events, windows };
        }, key),
      );
    } catch (error) {
      main = { error: error instanceof Error ? error.message : String(error) };
    }
    let renderer: unknown;
    try {
      renderer = await bounded(
        page.evaluate(() => ({
          url: location.href,
          readyState: document.readyState,
          visibility: document.visibilityState,
          text: document.body?.innerText.slice(0, 3_000),
        })),
      );
    } catch (error) {
      renderer = { error: error instanceof Error ? error.message.split("\n")[0] : String(error) };
    }
    return {
      pid: child.pid,
      exitCode: child.exitCode,
      signalCode: child.signalCode,
      setupError,
      events,
      main,
      renderer,
    };
  };
}
