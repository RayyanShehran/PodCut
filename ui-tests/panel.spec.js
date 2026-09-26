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
      const content = document.querySelector("#app");
      const footer = document.querySelector(".action-bar").getBoundingClientRect();
      const developer = document.querySelector(".developer-section").getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollable: content.scrollHeight > content.clientHeight,
        footerGap: footer.top - developer.bottom,
        scrollbarCount: [document.documentElement, document.body, content, document.querySelector(".content-scroll")].filter((node) => node.scrollHeight > node.clientHeight).length
      };
    });
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.scrollable).toBe(true);
    expect(layout.footerGap).toBeGreaterThanOrEqual(16);
    expect(layout.footerGap).toBeLessThanOrEqual(20);
    expect(layout.scrollbarCount).toBe(1);
    expect(errors).toEqual([]);
    await page.locator("#app").evaluate((content) => { content.scrollTop = 0; });
    const scrollBox = await page.locator("#app").boundingBox();
    await page.mouse.move(scrollBox.x + Math.min(80, scrollBox.width / 2), scrollBox.y + Math.min(80, scrollBox.height / 2));
    await page.mouse.wheel(0, 240);
    await expect.poll(() => page.locator("#app").evaluate((content) => content.scrollTop)).toBeGreaterThan(0);
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
  await expect(page.locator("#refreshSequence img")).toHaveJSProperty("naturalWidth", 32);
  await expect(page.locator("#analyze")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#analyze")).toHaveAttribute("tabindex", "-1");

  const styles = await page.evaluate(() => {
    const css = (selector) => getComputedStyle(document.querySelector(selector));
    const card = document.querySelector(".sequence-card").getBoundingClientRect();
    const content = document.querySelector("#app").getBoundingClientRect();
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
      progressAnimation: css("#progressFill").animationName,
      summaryDisplay: css(".summary-grid").display,
      controlTag: document.querySelector("#developerToggle").tagName
    };
  });
  expect(styles.cardPadding).toBe("12px");
  expect(styles.dotWidth).toBe("6px");
  expect(styles.dotMarginRight).toBe("8px");
  expect(styles.rowDisplay).toBe("flex");
  expect(styles.scrollbarClearance).toBeGreaterThanOrEqual(10);
  expect(styles.refreshSize).toEqual(["32px", "32px"]);
  expect(styles.analyze).toEqual(["32px", "6px", "rgb(0, 0, 0)", "rgb(110, 114, 122)", "1", '"Segoe UI", Arial, sans-serif', "13px", "500"]);
  expect(styles.developer).toEqual(["32px", "rgb(0, 0, 0)", '"Segoe UI", Arial, sans-serif', "12px", "400"]);
  expect(styles.progressAnimation).toBe("none");
  expect(styles.summaryDisplay).toBe("flex");
  expect(styles.controlTag).toBe("DIV");

  await page.locator("#developerToggle").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#developerToggle")).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator("#developerPanel")).toBeVisible();
  await page.keyboard.press("Space");
  await expect(page.locator("#developerToggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("#developerPanel")).toBeHidden();

  await page.evaluate(() => {
    window.refreshCalls = 0;
    const activeSequence = PodCutPremiere.activeSequence;
    PodCutPremiere.activeSequence = async () => { window.refreshCalls += 1; return activeSequence(); };
  });
  await page.locator("#refreshSequence").click();
  await expect.poll(() => page.evaluate(() => window.refreshCalls)).toBe(1);

  await page.locator("#analyze").evaluate((button) => { button.setAttribute("aria-disabled", "false"); });
  await expect(page.locator("#analyze")).toHaveCSS("color", "rgb(255, 255, 255)");
  await expect(page.locator("#analyze")).toHaveCSS("border-color", "rgb(110, 114, 122)");
});

test("settings survive reload and reset without restoring results", async ({ page }) => {
  await page.goto(panelUrl);
  await page.locator("#preset").selectOption("tight");
  await page.locator("#advancedToggle").click();
  await page.locator("#developerToggle").click();
  await page.locator("#testAudio").click();
  await expect(page.locator("#review")).toBeVisible();
  await page.reload();
  await expect(page.locator("#preset")).toHaveValue("tight");
  await expect(page.locator("#advancedSettings")).toBeVisible();
  await expect(page.locator("#developerPanel")).toBeVisible();
  await expect(page.locator("#review")).toBeHidden();
  await page.locator("#resetSettings").click();
  await expect(page.locator("#preset")).toHaveValue("natural");
  await expect(page.locator("#advancedSettings")).toBeHidden();
  await page.reload();
  await expect(page.locator("#preset")).toHaveValue("natural");
});

test("review filters and bulk actions update counts without replacing rows", async ({ page }) => {
  await page.goto(panelUrl);
  await page.locator("#developerToggle").click();
  await page.locator("#testAudio").click();
  await expect(page.locator("#review")).toBeVisible();
  const rows = page.locator(".decision");
  const total = await rows.count();
  expect(total).toBeGreaterThan(0);
  await page.locator("#disableVisible").click();
  await expect(page.locator("#summary div").nth(1).locator("strong")).toHaveText(`0 / ${total}`);
  await page.locator('[data-filter="disabled"]').click();
  await expect(rows.filter({ visible: true })).toHaveCount(total);
  await page.locator("#enableVisible").click();
  await expect(page.locator("#summary div").nth(1).locator("strong")).toHaveText(`${total} / ${total}`);
  await expect(rows.filter({ visible: true })).toHaveCount(0);
  await page.locator('[data-filter="all"]').click();
  await expect(rows.filter({ visible: true })).toHaveCount(total);
  await expect(page.locator(".locate").first()).toHaveAttribute("aria-disabled", "true");
});

test("show is repeatable; stale sequence blocks review and locate", async ({ page }) => {
  await page.addInitScript(() => {
    window.require = (id) => id === "uxp" ? { entrypoints: { setup: (hooks) => { window.panelHooks = hooks.panels.podcutPanel; } } } : null;
  });
  await page.goto(panelUrl);
  await page.evaluate(() => {
    window.info = { state: "ready", projectId: "p", projectPath: "project.prproj", sequenceId: "s", name: "Test", durationSeconds: 8.2,
      videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    window.moves = [];
    PodCutPremiere.activeSequence = async () => window.info;
    PodCutPremiere.sequenceAudio = async () => new ArrayBuffer(0);
    PodCutPremiere.setPlayerPosition = async (sequence, seconds) => { window.moves.push(seconds); };
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(8200).fill(0))] });
    for (let i = 0; i < 3; i++) window.panelHooks.show(document.body);
  });
  await expect(page.locator("#app")).toHaveCount(1);
  await expect(page.locator("#preset option")).toHaveCount(4);
  await expect(page.locator("#sequenceName")).toHaveText("Test");
  await page.locator("#analyze").click();
  await expect(page.locator("#review")).toBeVisible();
  await page.locator(".locate").first().click();
  expect(await page.evaluate(() => window.moves.length)).toBe(1);
  await page.evaluate(() => { window.info = { ...window.info, audioClips: 2 }; });
  await page.locator("#refreshSequence").click();
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#message")).toContainText("Analyze again");
});

test("show during export leaves one job running and keeps its progress", async ({ page }) => {
  await page.addInitScript(() => {
    window.require = (id) => id === "uxp" ? { entrypoints: { setup: (hooks) => { window.panelHooks = hooks.panels.podcutPanel; } } } : null;
  });
  await page.goto(panelUrl);
  await page.evaluate(() => {
    window.info = { state: "ready", projectId: "p", projectPath: "project.prproj", sequenceId: "s", name: "Test", durationSeconds: 8,
      videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    window.exports = 0;
    PodCutPremiere.activeSequence = async () => window.info;
    PodCutPremiere.sequenceAudio = () => { window.exports += 1; return new Promise((resolveExport) => { window.finishExport = resolveExport; }); };
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(8000).fill(0))] });
    window.panelHooks.show(document.body);
  });
  await expect(page.locator("#sequenceName")).toHaveText("Test");
  await page.locator("#analyze").click();
  await expect(page.locator("#progressStage")).toHaveText("Preparing");
  await page.evaluate(() => { for (let i = 0; i < 3; i++) window.panelHooks.show(document.body); });
  expect(await page.evaluate(() => window.exports)).toBe(1);
  await expect(page.locator("#analyze")).toHaveText("Stop waiting");
  await page.evaluate(() => window.finishExport(new ArrayBuffer(0)));
  await expect(page.locator("#progressStage")).toHaveText("Ready");
  expect(await page.evaluate(() => window.exports)).toBe(1);
});
