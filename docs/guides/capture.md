# Save a screenshot or recording

Screenshots help explain a UI failure and show what was visible when a test stopped.

```typescript title="screenshot.mts"
import { withVortex } from "./harness/benchmarks/index";
import { captureScreenshot } from "./harness/src/kit";

await withVortex({ outputDir: "harness/.artifacts/screenshots" }, async (vortex) => {
  await vortex.seedMods(150);
  await vortex.openPage("Mods");
  const file = await captureScreenshot(vortex.config, { label: "mods-list" });
  console.log(file);
});
```

Run `pnpm exec tsx screenshot.mts`. The helper writes a timestamped PNG under your output directory. `fullPage: true` captures the scrollable page rather than the viewport.

## Record an interaction

Video requires an installed encoder such as FFmpeg. Supply its executable explicitly. Inside your `withVortex()` callback:

```typescript
const video = await recording.startRecording(vortex.config, {
  encoder: "C:/tools/ffmpeg/bin/ffmpeg.exe",
  label: "search-interaction",
});
try {
  await vortex.page.locator("#table-mods .header-name input").fill("texture");
} finally {
  console.log(await video.stop());
}
```

Import `recording` from `./harness/src/kit`. `stop()` writes a WebM recording. Keep capture out of timed runs unless it is part of the measurement: it adds renderer work.

For layout checks, the lower-level responsive helper can resize through a set of viewports and save a screenshot at each size. Inspect the pictures alongside reported overflow; an intentionally scrollable panel may be valid.
