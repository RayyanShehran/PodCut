const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const panelUrl = pathToFileURL(resolve(__dirname, "..", "index.html")).href;
const viewports = [
  { width: 280, height: 400 },
  { width: 320, height: 520 },
  { width: 420, height: 700 },
  { width: 900, height: 700 }
];

for (const viewport of viewports) {
  test(`generated review stays usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await page.goto(panelUrl);

    await page.locator("#advancedToggle").click();
    await expect(page.locator("#advancedSettings")).toBeVisible();
    await page.locator("#preset").selectOption("tight");
    await page.locator("#developerToggle").click();
    await page.evaluate(() => {
      const analyze = PodCutCore.analyzeAudioAsync;
      PodCutCore.analyzeAudioAsync = async (...args) => {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 120));
        return analyze(...args);
      };
    });
    await page.locator("#testAudio").click();
    await expect(page.locator("#progressStage")).toHaveText("Analyzing");
    await expect(page.locator("#testAudio")).toBeDisabled();
    await expect(page.locator("#refreshSequence")).toBeDisabled();
    await expect(page.locator("#progressStage")).toHaveText("Ready");
    await expect(page.locator("#review")).toBeVisible();

    const decisions = page.locator("#decisions input");
    expect(await decisions.count()).toBeGreaterThan(0);
    const removedBefore = await page.locator("#summary div").nth(3).locator("strong").textContent();
    await decisions.first().uncheck();
    await expect(page.locator("#summary div").nth(3).locator("strong")).not.toHaveText(removedBefore);

    const finalDecision = page.locator("#decisions label").last();
    await finalDecision.scrollIntoViewIfNeeded();
    await expect(finalDecision).toBeVisible();
    const layout = await page.evaluate(() => {
      const content = document.querySelector(".content-scroll");
      const footer = document.querySelector(".action-bar").getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollable: content.scrollHeight > content.clientHeight,
        footerBottom: footer.bottom,
        scrollbarCount: [document.documentElement, document.body, content].filter((node) => node.scrollHeight > node.clientHeight).length
      };
    });
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.scrollable).toBe(true);
    expect(layout.footerBottom).toBeLessThanOrEqual(viewport.height);
    expect(layout.scrollbarCount).toBe(1);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`podcut-${viewport.width}x${viewport.height}.png`) });
  });
}

test("recipe changes invalidate review and long text wraps", async ({ page }) => {
  await page.setViewportSize({ width: 280, height: 400 });
  await page.goto(panelUrl);
  await page.locator("#developerToggle").click();
  await page.locator("#testAudio").click();
  await expect(page.locator("#progressStage")).toHaveText("Ready");
  await page.locator("#preset").selectOption("tight");
  await expect(page.locator("#review")).toBeHidden();

  await page.evaluate(() => {
    document.querySelector("#sequenceName").textContent = "A very long podcast sequence name that must wrap safely without making the Premiere panel wider than its viewport";
    const message = document.querySelector("#message");
    message.hidden = false;
    message.className = "message error";
    message.textContent = "Premiere could not read a deliberately long diagnostic path and this actionable error must wrap without clipping controls or creating horizontal overflow.";
    const progress = document.querySelector("#progress");
    progress.hidden = false;
    document.querySelector("#progressStage").textContent = "Exporting audio";
    document.querySelector("#progressDetail").textContent = "Promise pending; event pending; output C:\\A\\very\\long\\temporary\\path\\podcut.wav";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(280);
  await expect(page.locator("#analyze")).toBeVisible();
});
