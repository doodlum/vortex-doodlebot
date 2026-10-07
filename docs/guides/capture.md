# Screenshots, video and layout

Capture a bug as it happens, compare a visual change, or check whether a dialog still fits
in a shorter window. These commands use your running app session.

## Screenshots

```powershell
pnpm run ai -- screenshot --label before
# Perform the scoped interaction.
pnpm run ai -- screenshot --label after --full-page
```

The command prints the PNG path. Label captures by scenario and state so you can compare
them later. For comparisons, save the runtime, fixture and viewport with the images.
Screenshots capture appearance at one moment; file or state checks establish whether the
whole workflow completed.

## Width and height changes

```powershell
pnpm run ai -- responsive --viewports '1024x720,1280x720,1280x1080,1920x1080' --screenshots --strict
```

`responsive` persists JSON evidence and optional screenshots. `--strict` returns nonzero for
viewport-dependent findings or overflow. Check both width and height: split panels, bottom
buttons and modal footers can fail at a short height even when they look fine at the same width.

Tools such as `ui_get_viewport`, `ui_set_viewport`, `ui_detect_layout_issues` and
`ui_responsive_sweep` provide lower-level control. Automated overlap/overflow diagnostics
need a visual check: they can flag harmless overlap and miss issues in states you have not measured.
Restore window size and modified DOM state in `finally` blocks when writing tests.

## Video

```powershell
pnpm run ai -- record --seconds 15 --label reproduction --ffmpeg 'C:\tools\ffmpeg.exe'
```

FFmpeg must be installed. Recording saves WebM; `--seconds` supports 1–60 seconds. Keep the
app visible when measuring user-facing layout or interaction. Hidden/headless behavior and
capture can differ from the visible window.

## Keyboard and accessibility checks

Snapshots expose roles, labels and values. A fuller accessibility check also covers
tab order, focus after opening/closing dialogs, keyboard activation, disabled controls,
readable text and the affected viewport states. Use independent Playwright locators and actual
keyboard input where those behaviors matter.

## Renderer diagnostics

`eval --expr '<JavaScript>'` or `eval file.js` executes diagnostics through CDP, only against
an identified harness profile. Promises are awaited. Use it to inspect a computed style or
an unknown component condition. If the diagnostic becomes a reusable workflow or test,
move it into a reviewed tool or helper. Logs and captured content can contain private
data; review them before attaching a report.
