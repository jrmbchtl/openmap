import { test, expect } from "@playwright/test";
test("native raster reprojects and aligns in desktop/mobile canvas", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/tests/browser/probe.html");
  await page.waitForFunction(() => window.probe?.map);
  const native = await page.evaluate(() => window.probe.native);
  expect(Math.abs(native[0] - 514073.7)).toBeLessThan(1);
  expect(Math.abs(native[1] - 5415467.8)).toBeLessThan(1);
  for (const zoom of [10, 14, 18]) {
    await page.evaluate(z => window.probe.map.getView().setZoom(z), zoom);
    await expect.poll(() => page.evaluate(() => {
      const canvas = document.querySelector("canvas"); if (!canvas) return 0;
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(Math.floor(canvas.width / 2) - 4, Math.floor(canvas.height / 2) - 4, 8, 8).data;
      return [...data].filter((_, i) => i % 4 === 3 && data[i] > 50).length;
    })).toBeGreaterThan(0);
  }
  expect(errors).toEqual([]);
  await page.evaluate(() => window.probe.map.dispose());
  await expect(page.locator("canvas")).toHaveCount(0);
});
