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

test("host-safe controls keep explicit geometry, typography, and icons", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 520 });
  await page.goto(panelUrl);
  await expect(page.locator("#refreshSequence")).toBeEnabled();
  await expect(page.locator("#refreshSequence img")).toHaveJSProperty("naturalWidth", 16);

  const styles = await page.evaluate(() => {
    const css = (selector) => getComputedStyle(document.querySelector(selector));
    const card = document.querySelector(".sequence-card").getBoundingClientRect();
    const content = document.querySelector(".content-scroll").getBoundingClientRect();
    const refresh = css("#refreshSequence");
    const analyze = css("#analyze");
    const developer = css("#developerToggle");
    const dot = css("#sequenceDot");
    return {
      cardPadding: css(".sequence-card").padding,
      dotWidth: dot.width,
      dotMarginRight: dot.marginRight,
      rowDisplay: css(".sequence-status-row").display,
      scrollbarClearance: Math.round(content.right - card.right),
      refreshSize: [refresh.width, refresh.height],
      analyze: [analyze.height, analyze.borderRadius, analyze.backgroundColor, analyze.color, analyze.opacity, analyze.fontFamily, analyze.fontSize, analyze.fontWeight],
      developer: [developer.height, developer.backgroundColor, developer.fontFamily, developer.fontSize, developer.fontWeight],
      progressAnimation: css("#progressFill").animationName
    };
  });
  expect(styles.cardPadding).toBe("16px");
  expect(styles.dotWidth).toBe("6px");
  expect(styles.dotMarginRight).toBe("8px");
  expect(styles.rowDisplay).toBe("flex");
  expect(styles.scrollbarClearance).toBeGreaterThanOrEqual(10);
  expect(styles.refreshSize).toEqual(["32px", "32px"]);
  expect(styles.analyze).toEqual(["36px", "6px", "rgb(0, 0, 0)", "rgb(110, 114, 122)", "1", '"Segoe UI", Arial, sans-serif', "13px", "500"]);
  expect(styles.developer).toEqual(["32px", "rgb(0, 0, 0)", '"Segoe UI", Arial, sans-serif', "12px", "400"]);
  expect(styles.progressAnimation).toBe("none");

  await page.locator("#developerToggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#developerToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#developerPanel")).toBeVisible();

  await page.evaluate(() => {
    window.refreshCalls = 0;
    const activeSequence = PodCutPremiere.activeSequence;
    PodCutPremiere.activeSequence = async () => { window.refreshCalls += 1; return activeSequence(); };
  });
  await page.locator("#refreshSequence").click();
  await expect.poll(() => page.evaluate(() => window.refreshCalls)).toBe(1);

  await page.locator("#analyze").evaluate((button) => { button.disabled = false; });
  await expect(page.locator("#analyze")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator("#analyze")).toHaveCSS("border-color", "rgb(110, 114, 122)");
});
