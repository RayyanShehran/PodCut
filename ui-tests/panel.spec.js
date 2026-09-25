const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");

const panelUrl = pathToFileURL(resolve(__dirname, "..", "index.html")).href;

for (const viewport of [{ width: 320, height: 520 }, { width: 900, height: 700 }]) {
  test(`panel stays usable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto(panelUrl);
    await page.evaluate(() => {
      document.querySelector("#sequenceDot").classList.add("ready");
      document.querySelector("#sequenceName").textContent = "Podcast Test";
      document.querySelector("#sequenceMeta").textContent = "0m 35s · 1V / 1A · 2 clips";
      document.querySelector("#review").hidden = false;
      document.querySelector("#decisions").innerHTML = Array.from({ length: 16 }, (_, index) =>
        `<label><input type="checkbox" checked><span><b>Silence</b><small>00:00:${String(index).padStart(2, "0")}.000</small></span><strong>Remove 1s</strong></label>`
      ).join("");
      document.querySelector("#progress").hidden = false;
      document.querySelector("#progressStage").textContent = "Ready";
      document.querySelector("#progressValue").textContent = "100%";
      document.querySelector("#progressFill").style.width = "100%";
      document.querySelector("#message").hidden = false;
      document.querySelector("#message").textContent = "Sequence audio analysis complete.";
      document.querySelector("#analyze").disabled = false;
    });

    const layout = await page.evaluate(() => {
      const content = document.querySelector(".content-scroll");
      const footer = document.querySelector(".action-bar");
      const analyze = document.querySelector("#analyze").getBoundingClientRect();
      const testAudio = document.querySelector("#testAudio").getBoundingClientRect();
      return {
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        scrollable: content.scrollHeight > content.clientHeight,
        footerDirection: getComputedStyle(footer).flexDirection,
        stacked: testAudio.top >= analyze.bottom,
        footerBottom: footer.getBoundingClientRect().bottom
      };
    });
    expect(layout.horizontalOverflow).toBe(false);
    expect(layout.scrollable).toBe(true);
    expect(layout.footerDirection).toBe("column");
    expect(layout.stacked).toBe(true);
    expect(layout.footerBottom).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({ path: testInfo.outputPath(`podcut-${viewport.width}x${viewport.height}.png`), fullPage: true });
  });
}
