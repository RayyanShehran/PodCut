const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "ui-tests",
  outputDir: "test-results",
  reporter: "line",
  use: { browserName: "chromium" }
});
