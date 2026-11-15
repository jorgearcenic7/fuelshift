// Verificación local en Chromium instalado. No consulta la API oficial.
import assert from "node:assert/strict";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const executablePath = [
  process.env.PLAYWRIGHT_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find(existsSync);
assert.ok(executablePath, "Es necesario un Chromium instalado");
const origin = process.env.FUELSHIFT_URL ?? "http://localhost:3000";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Usa un servidor local",
);
mkdirSync(".screenshots", { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const errors = [],
  results = [];
function panel(page) {
  return page.locator('[aria-labelledby="monthly-history-title"]');
}
async function ready(page) {
  await panel(page)
    .getByRole("img", { name: /instantáneas del día 1/ })
    .waitFor();
}
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({
      viewport: { width, height: 1000 },
      hasTouch: width <= 390,
    });
    page.on("pageerror", (error) => errors.push(error.message));
    const responses = [];
    page.on("response", (r) => {
      if (r.url().includes("/data/historico-miteco/") && r.status() >= 400)
        responses.push(r.status());
    });
    await page.goto(`${origin}/estadisticas/`);
    await ready(page);
    const section = panel(page);
    assert.equal(await section.locator("#monthly-scope option").count(), 53);
    assert.equal(
      await section
        .locator('input[name="monthly-period"][value="20"]')
        .isDisabled(),
      true,
    );
    const initial = await section.locator("dl").innerText();
    await section.locator("#monthly-scope").selectOption("28");
    await ready(page);
    assert.notEqual(await section.locator("dl").innerText(), initial);
    for (const fuel of ["gasoline_98_e5", "diesel_a", "gasoline_95_e5"]) {
      await section
        .locator(`label:has(input[name="monthly-fuel"][value="${fuel}"])`)
        .click();
      await ready(page);
    }
    await section
      .locator('label:has(input[name="monthly-period"][value="1"])')
      .click();
    await ready(page);
    assert.ok(
      (await section.getByRole("img").getAttribute("aria-label")).includes(
        "13 muestras",
      ),
    );
    const chart = section.getByRole("group", { name: /Usa las flechas/ });
    await chart.focus();
    await page.keyboard.press("Home");
    assert.match(
      await section.locator('[aria-live="polite"]').innerText(),
      /Muestra del/,
    );
    await page.keyboard.press("End");
    const svg = section.getByRole("img");
    if (width <= 390) await svg.tap({ position: { x: 80, y: 100 } });
    else await svg.hover({ position: { x: 80, y: 100 } });
    assert.ok(
      await section.locator("div.pointer-events-none").isVisible(),
      "Tooltip visible",
    );
    assert.ok(
      (await section.locator("div.pointer-events-none").innerText()).includes(
        "estaciones",
      ),
    );
    await section
      .locator('label:has(input[name="monthly-period"][value="all"])')
      .click();
    const geometry = await page.evaluate(() => ({
      width: innerWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(
      geometry.scroll <= geometry.width + 1,
      `Desbordamiento a ${width}px: ${geometry.scroll}`,
    );
    await section.screenshot({
      path: path.join(".screenshots", `monthly-history-${width}.png`),
    });
    assert.deepEqual(responses, []);
    results.push({
      width,
      selectors: "ok",
      tooltip: "ok",
      keyboard: "ok",
      overflow: false,
    });
    await page.close();
  }
  for (const state of ["empty", "gaps", "corrupt", "http-error", "missing"]) {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
    });
    page.on("pageerror", (error) => errors.push(error.message));
    if (state === "missing")
      await page.route("**/data/historico-miteco/manifest.json", (route) =>
        route.fulfill({ status: 404, body: "" }),
      );
    else
      await page.route(
        "**/data/historico-miteco/sets/**/ES/gasoline_95_e5.json",
        async (route) => {
          if (state === "http-error")
            return route.fulfill({ status: 503, body: "" });
          const response = await route.fetch();
          const json = await response.json();
          if (state === "corrupt") json.frequency = "daily";
          if (state === "empty")
            json.observations = json.observations.map(([day]) => [
              day,
              null,
              0,
            ]);
          if (state === "gaps")
            json.observations[1] = [json.observations[1][0], null, 0];
          await route.fulfill({ response, json });
        },
      );
    await page.goto(`${origin}/estadisticas/`);
    if (state === "empty")
      await panel(page)
        .getByText(/No hay al menos dos observaciones/)
        .waitFor();
    else if (state === "missing")
      await panel(page)
        .getByText(/todavía no está publicado/)
        .waitFor();
    else if (state === "gaps") {
      await ready(page);
      assert.equal(await panel(page).locator("svg path").count(), 2);
      await panel(page).getByText("Meses sin datos", { exact: true }).click();
      assert.ok((await panel(page).innerText()).includes("feb 2007"));
    } else await panel(page).getByRole("alert").waitFor();
    assert.equal(
      await page
        .getByRole("heading", { name: "Precios en España", exact: true })
        .count(),
      1,
    );
    results.push({ state, result: "ok" });
    await page.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ results, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
