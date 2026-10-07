import fs from "node:fs";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Decode the whole PNG in Chromium, then check its native dimensions and visible content. */
export async function expectScreenshot(
  file: string,
  page: Page,
  expected?: { width: number; height: number },
): Promise<void> {
  const decoded = await page.evaluate(
    async ({ base64, expected }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${base64}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d")!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const colours = new Set<string>();
      for (let y = 0; y < canvas.height; y += Math.max(1, Math.floor(canvas.height / 80))) {
        for (let x = 0; x < canvas.width; x += Math.max(1, Math.floor(canvas.width / 80))) {
          const offset = (y * canvas.width + x) * 4;
          colours.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
        }
      }
      return {
        width: canvas.width,
        height: canvas.height,
        colours: colours.size,
        expectedWidth: expected?.width ?? Math.round(window.innerWidth * window.devicePixelRatio),
        expectedHeight:
          expected?.height ?? Math.round(window.innerHeight * window.devicePixelRatio),
      };
    },
    { base64: fs.readFileSync(file).toString("base64"), expected },
  );
  expect(Math.abs(decoded.width - decoded.expectedWidth)).toBeLessThanOrEqual(2);
  expect(Math.abs(decoded.height - decoded.expectedHeight)).toBeLessThanOrEqual(2);
  expect(decoded.colours).toBeGreaterThan(10);
}
