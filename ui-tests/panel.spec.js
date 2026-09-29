const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const { resolve } = require("node:path");
const { readFileSync } = require("node:fs");

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

test('short narrow panel exposes availability without review and long handoff controls fit', async ({page}) => {
  await page.setViewportSize({width:250,height:210}); await page.goto(panelUrl);
  await expect(page.locator('#review')).toBeHidden();
  await expect(page.locator('#availability')).toContainText('Experimental assisted drafts require opt-in');
  const notice = await page.locator('#availability p').first().boundingBox();
  expect(notice.y).toBeGreaterThanOrEqual(0); expect(notice.y + notice.height).toBeLessThanOrEqual(210);
  await page.evaluate(()=>{
    document.getElementById('assistedHandoff').hidden=false;
    document.getElementById('assistedIdentity').textContent='C:\\Projects\\'+'VeryLongProjectName'.repeat(15)+'.prproj';
  });
  await page.locator('#confirmManualLink').scrollIntoViewIfNeeded();
  const overflow = await page.evaluate(()=>{
    const e=document.getElementById('confirmManualLink'),p=document.getElementById('assistedIdentity'),app=document.getElementById('app');
    return {button:e.scrollHeight-e.clientHeight,path:p.scrollWidth-p.clientWidth,app:app.scrollWidth-app.clientWidth,height:e.getBoundingClientRect().height};
  });
  expect(overflow.button).toBeLessThanOrEqual(1); expect(overflow.path).toBeLessThanOrEqual(1);
  expect(overflow.app).toBeLessThanOrEqual(1); expect(overflow.height).toBeGreaterThan(32);
  await page.locator('#analyze').scrollIntoViewIfNeeded(); await expect(page.locator('#analyze')).toBeVisible();
});

test('automatic Apply and assisted opt-in guard survive removed button disabled attributes', async ({page}) => {
  await page.goto(panelUrl);
  const outcomes=await page.evaluate(async()=>{
    document.getElementById('apply').setAttribute('aria-disabled','false');
    document.getElementById('prepareAssisted').setAttribute('aria-disabled','false');
    const adapter=new Proxy({}, {get(){throw Error('Unexpected host access');}}),errors=[];
    for(const call of [()=>PodCutApply.apply(adapter,{confirmed:true}),
      ()=>PodCutAssisted(adapter,{},PodCutApply,{experimental:true}).prepare({confirmed:true})]) {
      try{await call();errors.push('Unexpected acceptance');}catch(e){errors.push(e.message);}
    }
    return errors;
  });
  expect(outcomes[0]).toContain('unavailable pending validation');
  expect(outcomes[1]).toContain('confirmation is required');
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
  // Even identical metadata is not proof that hidden-panel audio stayed unchanged.
  await page.evaluate(() => window.panelHooks.show(document.body));
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#message")).toContainText("establish a fresh review");
  await expect(page.locator("#workRecovery")).toBeHidden();
  await page.locator("#analyze").click();
  await expect(page.locator("#review")).toBeVisible();
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

test("Premiere project activation clears the old review and refreshes the source", async ({ page }) => {
  await page.addInitScript(() => {
    window.hostEvents = {};
    window.hostCaptures = {};
    window.require = (id) => {
      if (id === "uxp") return { entrypoints: { setup: (hooks) => { window.panelHooks = hooks.panels.podcutPanel; } } };
      if (id === "premierepro") return {
        Constants: { ProjectEvent: { ACTIVATED: "project-activated", OPENED: "project-opened", CLOSED: "project-closed" }, SequenceEvent: { ACTIVATED: "sequence-activated" } },
        EventManager: { addGlobalEventListener: (name, handler, capture) => { window.hostEvents[name] = handler; window.hostCaptures[name] = capture; } },
        Project: { getActiveProject: async () => null }
      };
      return null;
    };
  });
  await page.goto(panelUrl);
  expect(await page.evaluate(() => window.hostCaptures["project-activated"])).toBe(true);
  await page.evaluate(() => {
    window.info = { state: "ready", projectId: "p1", projectPath: "one.prproj", sequenceId: "s1", name: "First", durationSeconds: 8,
      videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    PodCutPremiere.activeSequence = async () => window.info;
    PodCutPremiere.sequenceAudio = async () => new ArrayBuffer(0);
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(8000).fill(0))] });
    window.panelHooks.show(document.body);
  });
  await expect(page.locator("#sequenceName")).toHaveText("First");
  await page.locator("#analyze").click();
  await expect(page.locator("#progressStage")).toHaveText("Ready");
  await page.evaluate(() => {
    window.info = { ...window.info, projectId: "p2", projectPath: "two.prproj", sequenceId: "s2", name: "Second" };
    window.hostEvents["project-activated"]();
  });
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#progress")).toBeHidden();
  await expect(page.locator("#sequenceName")).toHaveText("Second");
  await expect(page.locator("#analyze")).toHaveAttribute("aria-disabled", "false");
});

test("track invalidation discards an in-flight export result; reopening never duplicates listeners or restarts it", async ({ page }) => {
  await page.addInitScript(() => {
    window.hostEvents = {};
    window.trackEvents = [];
    window.require = id => {
      if (id === "uxp") return { entrypoints: { setup: hooks => {
        if (typeof hooks.plugin?.create !== "function") throw Error("create method is not defined for plugin");
        window.hooks = hooks;
      } } };
      if (id === "premierepro") return {
        Constants: { ProjectEvent: { ACTIVATED: "project", OPENED: "open", CLOSED: "close" },
          SequenceEvent: { ACTIVATED: "sequence", CLOSED: "sequenceClose" },
          VideoTrackEvent: { INFO_CHANGED: "info" }, AudioTrackEvent: { INFO_CHANGED: "info" } },
        EventManager: {
          addGlobalEventListener: (name, handler) => { window.hostEvents[name] = handler; },
          removeGlobalEventListener: name => { delete window.hostEvents[name]; },
          addEventListener: (target, name, handler) => { window.trackEvents.push({ target, name, handler }); },
          removeEventListener: (target, name, handler) => {
            window.trackEvents = window.trackEvents.filter(x => x.target !== target || x.name !== name || x.handler !== handler);
          }
        },
        Project: { getActiveProject: async () => window.watchSequence ? { getActiveSequence: async () => window.watchSequence } : null }
      };
      return null;
    };
  });
  await page.goto(panelUrl);
  await page.evaluate(async () => {
    window.watchSequence = { getVideoTrackCount: async () => 1, getAudioTrackCount: async () => 1,
      getVideoTrack: async () => "v1", getAudioTrack: async () => "a1" };
    window.info = { state: "ready", projectId: "p", sequenceId: "s", name: "Track test", durationSeconds: 8,
      videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    PodCutPremiere.activeSequence = async () => window.info;
    PodCutPremiere.sequenceAudio = () => {
      window.exportCount = (window.exportCount || 0) + 1;
      return new Promise(resolveExport => { window.finishExport = resolveExport; });
    };
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(8000).fill(0))] });
    window.hostEvents.sequence();
    await PodCutPremiere.readySourceWatch();
  });
  await expect(page.locator("#sequenceName")).toHaveText("Track test");
  await page.locator("#analyze").click();
  await expect.poll(() => page.evaluate(() => window.exportCount)).toBe(1);
  await page.evaluate(() => {
    window.trackEvents.find(x => x.target === "a1").handler();
    for (let i = 0; i < 3; i++) window.hooks.panels.podcutPanel.show(document.body);
  });
  await expect(page.locator("#review")).toBeHidden();
  expect(await page.evaluate(() => window.exportCount)).toBe(1);
  expect(await page.evaluate(() => window.trackEvents.length)).toBe(2);
  await page.evaluate(() => window.finishExport(new ArrayBuffer(0)));
  await expect(page.locator("#analyze")).toHaveText("Analyze Sequence");
  await expect(page.locator("#review")).toBeHidden();
  await expect(page.locator("#message")).toContainText("changed during analysis");
  await expect(page.locator("#analyze")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#analyze").click();
  await expect.poll(() => page.evaluate(() => window.exportCount)).toBe(2);
  await page.evaluate(() => window.finishExport(new ArrayBuffer(0)));
  await expect(page.locator("#review")).toBeVisible();
  await page.evaluate(() => window.trackEvents.find(x => x.target === "a1").handler());
  await expect(page.locator("#review")).toBeHidden();
  await page.evaluate(() => window.hooks.plugin.destroy());
  expect(await page.evaluate(() => window.trackEvents.length)).toBe(0);
  expect(await page.evaluate(() => Object.keys(window.hostEvents).length)).toBe(0);
});

test("public Apply stays locked for property safety; review, zero-cut and transition checks remain usable", async ({ page }) => {
  await page.goto(panelUrl);
  await page.evaluate(() => {
    const item = { projectItemId: "media", start: 0, end: 36, inPoint: 0, outPoint: 36, trackIndex: 0, speed: 1, disabled: false, reversed: false };
    const source = { projectId: "p", projectPath: "test.prproj", sequenceId: "s", name: "Interview", durationSeconds: 36,
      fps: 30, videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0,
      otherItems: 0, videoItems: [{ ...item }], audioItems: [{ ...item }], videoMuted: false, audioMuted: false,
      mediaPath: "interview.mov", offline: false, nested: false, multicam: false, merged: false, unsupportedEffects: [] };
    const info = { state: "ready", projectId: "p", projectPath: "test.prproj", sequenceId: "s", name: "Interview",
      durationSeconds: 36, videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    PodCutPremiere.activeSequence = async () => info;
    PodCutPremiere.sequenceAudio = async () => new ArrayBuffer(0);
    PodCutPremiere.applyAdapter = () => ({ inspect: async () => ({ key: PodCutCore.sequenceKey(info), source }) });
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(36000).fill(0.2))] });
    PodCutCore.analyzeAudioAsync = async () => ({ durationSeconds: 36, silenceCount: 1, longPauseCount: 0,
      decisions: [{ id: "cut", type: "silence", enabled: true, cutStart: 10.25, cutEnd: 11.8, removeSeconds: 1.55 }] });
    window.applySubmissions = 0;
    PodCutApply.apply = async () => { window.applySubmissions++; throw new Error("Public safety hold bypassed"); };
  });
  await page.locator("#refreshSequence").click();
  await page.locator("#analyze").click();
  await expect(page.locator("#applyStatus")).toContainText("remove 46 frames (1.533s)");
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#applyStatus")).toContainText("native gain preservation and audio freshness are not verified");
  await page.evaluate(() => document.querySelector("#apply").click());
  await expect(page.locator("#applyConfirmation")).toBeHidden();
  await page.evaluate(() => document.querySelector("#confirmApply").click());
  expect(await page.evaluate(() => window.applySubmissions)).toBe(0);
  // Model native gain changes invisible to the metadata snapshot, before and after analysis.
  await page.evaluate(() => {
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(36000).fill(0.1))] });
  });
  await page.locator("#analyze").click();
  await expect(page.locator("#applyStatus")).toContainText("native gain preservation and audio freshness are not verified");
  await page.evaluate(() => {
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(36000).fill(0.05))] });
    document.querySelector("#apply").click();
    document.querySelector("#confirmApply").click();
  });
  expect(await page.evaluate(() => window.applySubmissions)).toBe(0);
  await page.locator("#decisions input").uncheck();
  await expect(page.locator("#applyStatus")).toContainText("at least one cut");
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "true");
  await page.evaluate(() => {
    const previous = PodCutPremiere.applyAdapter;
    PodCutPremiere.applyAdapter = () => ({ inspect: async () => {
      const current = await previous().inspect();
      return { ...current, source: { ...current.source, videoTransitions: 1 } };
    } });
  });
  await page.locator("#analyze").click();
  await expect(page.locator("#applyStatus")).toContainText("Transitions are not supported");
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "true");
});

test("isolated panel Apply honors enabled cuts, locks double clicks, and reports the separate output", async ({ page }) => {
  const service = readFileSync(resolve(__dirname, '..', 'src', 'apply.js'), 'utf8');
  await page.route('**/src/apply.js', route => route.fulfill({contentType:'text/javascript',
    body:service.replace('const MUTATION_ENABLED = false;', 'const MUTATION_ENABLED = true;')}));
  const script = readFileSync(resolve(__dirname, "..", "src", "main.js"), "utf8");
  expect(script).toContain("const PUBLIC_APPLY_ENABLED = false;");
  // Non-shipping browser handler regression only; production source/build remain locked.
  await page.route("**/src/main.js", route => route.fulfill({ contentType: "text/javascript",
    body: script.replace("const PUBLIC_APPLY_ENABLED = false;", "const PUBLIC_APPLY_ENABLED = true;") }));
  await page.goto(panelUrl);
  await page.evaluate(() => {
    const item = { projectItemId: "media", start: 0, end: 36, inPoint: 0, outPoint: 36, trackIndex: 0, speed: 1, disabled: false, reversed: false };
    window.source = { projectId: "p", sequenceId: "s", name: "Interview", durationSeconds: 36, fps: 30,
      videoTracks: 1, audioTracks: 1, captionTracks: 0, videoTransitions: 0, audioTransitions: 0, otherItems: 0,
      videoItems: [{ ...item }], audioItems: [{ ...item }], mediaPath: "fixture.mov", offline: false,
      nested: false, multicam: false, merged: false, videoMuted: false, audioMuted: false, unsupportedEffects: [] };
    window.info = { state: "ready", projectId: "p", sequenceId: "s", name: "Interview", durationSeconds: 36,
      videoTracks: 1, audioTracks: 1, videoClips: 1, audioClips: 1, sequence: {} };
    window.calls = [];
    PodCutPremiere.activeSequence = async () => window.info;
    PodCutPremiere.sequenceAudio = async () => new ArrayBuffer(0);
    PodCutPremiere.applyAdapter = () => ({
      inspect: async () => ({ key: PodCutCore.sequenceKey(window.info), source: window.source }),
      createCandidate: async (operation) => { window.submittedPlan = operation.plan; window.calls.push("candidate"); return new Promise(resolveCandidate => { window.resolveCandidate = resolveCandidate; }); },
      createSubclip: async () => { window.calls.push("subclip"); return "subclip"; },
      editCandidate: async () => { window.calls.push("edit"); if (window.failEdit) { window.failEdit = false; throw Error("injected edit failure"); } return true; },
      verifyCandidate: async () => { window.calls.push("verify"); return true; },
      nameCandidate: async (_, name) => { window.calls.push(name.startsWith("PodCut FAILED") ? "failed-label" : "final-label"); return true; },
      presentCandidate: async () => true,
      reconcile: async () => {}, restoreOriginal: async () => {}
    });
    PodCutAudio.decodeWavAsync = async () => ({ sampleRate: 1000, channels: [Float32Array.from(Array(36000).fill(0.2))] });
    PodCutCore.analyzeAudioAsync = async () => ({ durationSeconds: 36, silenceCount: 2, longPauseCount: 0,
      decisions: [{ id: "one", type: "silence", enabled: true, cutStart: 10.25, cutEnd: 11.8, removeSeconds: 1.55 },
        { id: "two", type: "silence", enabled: true, cutStart: 22.55, cutEnd: 25.45, removeSeconds: 2.9 }] });
  });
  await page.locator("#refreshSequence").click();
  await page.locator("#analyze").click();
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#decisions input").last().uncheck();
  await expect(page.locator("#applyStatus")).toContainText("1 cuts; remove 46 frames");
  await page.locator("#apply").click();
  await expect(page.locator("#applyConfirmationText")).toContainText("Interview — PodCut");
  await expect(page.locator("#applyConfirmationText")).toContainText("Do not use adjusted Audio Gain or modified built-in effects");
  await expect(page.locator(".safety")).toContainText("Automatic Apply remains disabled");
  await page.locator("#confirmApply").click();
  await page.evaluate(() => document.querySelector("#confirmApply").click());
  await expect(page.locator("#preset")).toBeDisabled();
  expect(await page.evaluate(() => window.calls)).toEqual(["candidate"]);
  expect(await page.evaluate(() => window.submittedPlan.segments.map(s => [s.sourceStartFrame, s.sourceEndFrame])))
    .toEqual([[0, 308], [354, 1080]]);
  await page.evaluate(() => window.resolveCandidate("candidate-id"));
  await expect(page.locator("#applyStatus")).toContainText("Completed: Interview — PodCut (candidate-id)");
  await expect(page.locator("#message")).toContainText("first Undo reverses output naming");
  expect(await page.evaluate(() => window.calls)).toEqual(["candidate", "subclip", "edit", "verify", "final-label"]);
  await page.evaluate(() => { window.info = { ...window.info, sequenceId: "other" }; });
  await page.locator("#refreshSequence").click();
  await expect(page.locator("#review")).toBeHidden();
  expect(await page.evaluate(() => window.calls.filter(x => x === "candidate").length)).toBe(1);
  await page.evaluate(() => { window.info = { ...window.info, sequenceId: "s" }; });
  await page.locator("#refreshSequence").click();
  await page.locator("#analyze").click();
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "false");
  await page.locator("#decisions input").evaluateAll(inputs => inputs.forEach(input => { input.checked = false; input.dispatchEvent(new Event("change", { bubbles: true })); }));
  await expect(page.locator("#applyStatus")).toContainText("at least one cut");
  await page.locator("#decisions input").first().check();
  await expect(page.locator("#apply")).toHaveAttribute("aria-disabled", "false");
  await page.evaluate(() => { window.failEdit = true; });
  await page.locator("#apply").click();
  await page.locator("#confirmApply").click();
  await page.evaluate(() => window.resolveCandidate("failed-id"));
  await expect(page.locator("#applyStatus")).toContainText("Partial candidate: failed-id");
  await expect(page.locator("#message")).toContainText("retry creates a fresh candidate");
  expect(await page.evaluate(() => window.calls.includes("failed-label"))).toBe(true);
  await page.locator("#apply").click();
  await page.locator("#confirmApply").click();
  await page.evaluate(() => window.resolveCandidate("retry-id"));
  await expect(page.locator("#applyStatus")).toContainText("Completed: Interview — PodCut (retry-id)");
  expect(await page.evaluate(() => window.calls.filter(x => x === "candidate").length)).toBe(3);
});

async function wireAssistedPanel(page) {
  await page.evaluate(() => {
    window.require = id => id === 'premierepro' ? {} : null;
    const item = { projectItemId:'media', start:0,end:36,inPoint:0,outPoint:36,trackIndex:0,speed:1 };
    window.assistedSource = { projectId:'p',projectPath:'test.prproj',sequenceId:'s',name:'Interview',durationSeconds:36,
      fps:30,videoTracks:1,audioTracks:1,captionTracks:0,videoTransitions:0,audioTransitions:0,
      videoItems:[{...item}],audioItems:[{...item}],mediaPath:'interview.mov',unsupportedEffects:[] };
    window.assistedInfo = { ...assistedSource,state:'ready',videoClips:1,audioClips:1,sequence:{} };
    window.assistedSubmissions = 0;
    PodCutPremiere.activeSequence = async () => assistedInfo;
    PodCutPremiere.sourceRevision = () => 1;
    window.assistedExports = 0;
    window.assistedWav = () => {
      const b = new ArrayBuffer(48), v = new DataView(b);
      const text = (offset, s) => [...s].forEach((c,i)=>v.setUint8(offset+i,c.charCodeAt(0)));
      text(0,'RIFF');v.setUint32(4,40,true);text(8,'WAVE');text(12,'fmt ');v.setUint32(16,16,true);
      v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
      text(36,'data');v.setUint32(40,4,true);v.setInt16(44,window.changedSample || 1000,true);
      return b;
    };
    PodCutPremiere.sequenceAudio = async () => { assistedExports++; return assistedWav(); };
    PodCutAudio.decodeWavAsync = async () => ({sampleRate:1000,channels:[new Float32Array(36000)]});
    PodCutCore.analyzeAudioAsync = async () => ({durationSeconds:36,silenceCount:2,longPauseCount:0,
      decisions:[{id:'one',type:'silence',enabled:true,cutStart:9.07,cutEnd:11.8,removeSeconds:2.73},
        {id:'two',type:'silence',enabled:true,cutStart:22.49,cutEnd:25.61,removeSeconds:3.12}]});
    window.draftInspection = record => {
      if (assistedInfo.projectPath !== record.projectPath) throw Error('Open the exact project that owns this assisted draft.');
      const parts = record.plan.segments.map(s => ({...item,start:s.outputStartFrame/30,end:s.outputEndFrame/30,
        inPoint:s.sourceStartFrame/30,outPoint:s.sourceEndFrame/30}));
      return {original:assistedSource,candidate:{...assistedSource,sequenceId:record.candidateSequenceId,
        durationSeconds:record.plan.outputFrames/30,videoItems:parts,audioItems:structuredClone(parts)}};
    };
    PodCutPremiere.applyAdapter = () => ({sourceRevision:()=>1,
      inspect:async()=>({key:PodCutCore.sequenceKey(assistedInfo),source:assistedSource}),inspectDraft:async r=>draftInspection(r)});
    // Panel-state mock only; actual adapter construction has unit and separate native proof.
    PodCutAssisted = () => ({prepare:async (review,stage) => {
      assistedSubmissions++;
      const cuts = review.decisions.filter(d=>d.enabled).map(d=>({cutStart:d.cutStart,cutEnd:d.cutEnd}));
      const op = {id:'operation',projectId:'p',originalSequenceId:'s',candidateSequenceId:'draft-id',
        outputName:'PodCut ASSISTED DRAFT — linking required',sourceSnapshot:assistedSource,
        plan:PodCutCore.planSimpleEdit({durationSeconds:36,sourceInSeconds:0,fps:30,cuts}),status:'preparing',errors:[]};
      stage('creating candidate',op);
      await new Promise(resolve=>{window.finishAssisted=resolve;});
      op.status = window.failAssisted ? 'failed' : 'awaiting-manual-linking';
      if (window.failAssisted) op.errors=['Injected failure; partial draft isolated'];
      else assistedInfo={...assistedInfo,sequenceId:'draft-id',videoClips:2,audioClips:2,durationSeconds:op.plan.outputFrames/30};
      return op;
    }});
    window.hooks.panels.podcutPanel.show(document.body);
  });
  await expect(page.locator('#sequenceName')).toHaveText('Interview');
}

async function assistedHooks(page) {
  await page.addInitScript(() => { window.require = id => id==='uxp' ? {entrypoints:{setup:h=>{window.hooks=h;}}} : null; });
}

test('normal assisted panel cannot create drafts without explicit experimental opt-in', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.locator('#analyze').click();
  await page.locator('#decisions input').last().uncheck();
  await expect(page.locator('#assistedEligibility')).toContainText('Experimental');
  await expect(page.locator('#prepareAssisted')).toHaveAttribute('aria-disabled','true');
  await page.evaluate(()=>{document.querySelector('#prepareAssisted').click();document.querySelector('#confirmAssisted').click();});
  await expect(page.locator('#assistedConfirmation')).toBeHidden();
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  expect(await page.evaluate(()=>localStorage.getItem(PodCutAssistedState.workKey))).toBeNull();
});

test('distinct experimental panel flow enforces opt-in/one cut, duplicate lock and reconciled handoff after reload', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.locator('#analyze').click();
  await expect(page.locator('#assistedEligibility')).toContainText('exactly one enabled');
  await page.locator('#assistedOptIn').check();
  await expect(page.locator('#prepareAssisted')).toHaveAttribute('aria-disabled','true');
  await page.locator('#decisions input').last().uncheck();
  await expect(page.locator('#prepareAssisted')).toHaveAttribute('aria-disabled','false');
  await expect(page.locator('#apply')).toHaveAttribute('aria-disabled','true');
  await page.locator('#prepareAssisted').click();
  await expect(page.locator('#assistedConfirmationText')).toContainText('original stays unchanged');
  await expect(page.locator('#assistedConfirmationText')).toContainText('Undo is not one-step');
  await page.locator('#confirmAssisted').click();
  await expect.poll(()=>page.evaluate(()=>assistedSubmissions)).toBe(1);
  expect(await page.evaluate(()=>assistedExports)).toBe(3); // Analysis + both boundaries; no reopen callback needed.
  await page.evaluate(()=>{document.querySelector('#confirmAssisted').click();hooks.panels.podcutPanel.show(document.body);});
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(1);
  await expect(page.locator('#preset')).toBeDisabled();
  await page.evaluate(()=>finishAssisted());
  await expect(page.locator('#assistedIdentity')).toContainText('draft-id');
  await expect(page.locator('#assistedReconciliation')).toContainText('Recorded ranges match');
  await expect(page.locator('#assistedPairs')).toContainText('00:00:09.100');
  await expect(page.locator('#assistedPairs')).toContainText('Cloned tail: native linking required');
  await page.locator('#confirmManualLink').click();
  await expect(page.locator('#assistedPlayback')).toContainText('User-reported linking only');
  await page.reload(); await wireAssistedPanel(page);
  await expect(page.locator('#assistedIdentity')).toContainText('draft-id');
  await expect(page.locator('#review')).toBeHidden();
  await expect(page.locator('#assistedOptIn')).not.toBeChecked();
  await expect(page.locator('#assistedPlayback')).toContainText('checked again after plugin reload');
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  await page.evaluate(()=>{assistedInfo.projectPath='other.prproj';hooks.panels.podcutPanel.show(document.body);});
  await expect(page.locator('#assistedReconciliation')).toContainText('exact project');
  await expect(page.locator('#confirmManualLink')).toHaveAttribute('aria-disabled','true');
});

test('missing reopen hook cannot authorize changed audio; both action boundaries re-export', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.locator('#analyze').click(); await page.locator('#decisions input').last().uncheck();
  await page.locator('#assistedOptIn').check();
  // No show/hide callback or event revision change: native gain exposed this exact metadata hole.
  await page.evaluate(()=>{window.changedSample=500;});
  await page.locator('#prepareAssisted').click();
  await expect(page.locator('#message')).toContainText('audio differs');
  await expect(page.locator('#review')).toBeHidden();
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  await page.locator('#analyze').click(); await page.locator('#decisions input').last().uncheck();
  await page.locator('#prepareAssisted').click();
  await expect(page.locator('#assistedConfirmation')).toBeVisible();
  await page.evaluate(()=>{window.changedSample=250;});
  await page.locator('#confirmAssisted').click();
  await expect(page.locator('#message')).toContainText('audio differs');
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  expect(await page.evaluate(()=>assistedExports)).toBe(5);
});

test('missing reopen hook still requires current project and rejects invalidated verification', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.locator('#analyze').click(); await page.locator('#decisions input').last().uncheck();
  await page.locator('#assistedOptIn').check();
  await page.evaluate(()=>{assistedInfo={...assistedInfo,projectPath:'other.prproj'};});
  await page.locator('#prepareAssisted').click();
  await expect(page.locator('#message')).toContainText('project or sequence changed');
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  await page.evaluate(()=>{assistedInfo={...assistedInfo,projectPath:'test.prproj'};});
  await page.locator('#refreshSequence').click(); await page.locator('#analyze').click();
  await page.locator('#decisions input').last().uncheck();
  await page.evaluate(()=>{PodCutPremiere.sequenceAudio=(_,cb)=>{
    cb({stage:'exporting'});return new Promise(resolve=>{window.releaseVerification=()=>resolve(assistedWav());});
  };});
  await page.locator('#prepareAssisted').click();
  await expect.poll(()=>page.evaluate(()=>typeof releaseVerification)).toBe('function');
  // Destroy invalidates the old runtime even if its native export completes later.
  await page.evaluate(()=>{hooks.plugin.destroy();releaseVerification();});
  await expect(page.locator('#assistedConfirmation')).toBeHidden();
  expect(await page.evaluate(()=>assistedSubmissions)).toBe(0);
  expect(await page.evaluate(()=>PodCutAssistedState.pending(localStorage)?.kind)).toBe('export');
});

test('reload during pending export blocks new jobs until explicit recovery and discards old review', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.evaluate(()=>{PodCutPremiere.sequenceAudio=(_,cb)=>{
    cb({stage:'exporting',detail:{},elapsedMs:0,diagnostics:[]});return new Promise(()=>{});
  };});
  await page.locator('#analyze').click();
  await expect(page.locator('#analyze')).toHaveText('Stop waiting');
  await page.reload(); await wireAssistedPanel(page);
  await expect(page.locator('#workRecovery')).toBeVisible();
  await expect(page.locator('#analyze')).toHaveAttribute('aria-disabled','true');
  await page.locator('#refreshSequence').click();
  await expect(page.locator('#analyze')).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('#review')).toBeHidden();
  await page.locator('#recoverWork').click();
  await expect(page.locator('#workRecovery')).toBeHidden();
  await expect(page.locator('#analyze')).toHaveAttribute('aria-disabled','false');
});

test('failed assisted panel draft never becomes a completed or linking-approved result', async ({page}) => {
  await assistedHooks(page); await page.goto(panelUrl); await wireAssistedPanel(page);
  await page.locator('#analyze').click(); await page.locator('#decisions input').last().uncheck();
  await page.locator('#assistedOptIn').check();
  await expect(page.locator('#prepareAssisted')).toHaveAttribute('aria-disabled','false');
  await page.locator('#prepareAssisted').click(); await page.locator('#confirmAssisted').click();
  await expect.poll(()=>page.evaluate(()=>assistedSubmissions)).toBe(1);
  await page.evaluate(()=>{window.failAssisted=true;finishAssisted();});
  await expect(page.locator('#message')).toContainText('Assisted draft failed');
  await expect(page.locator('#assistedReconciliation')).toContainText('Interrupted/failed draft');
  await expect(page.locator('#confirmManualLink')).toHaveAttribute('aria-disabled','true');
  expect(await page.evaluate(()=>localStorage.getItem(PodCutAssistedState.workKey))).toBeNull();
});
