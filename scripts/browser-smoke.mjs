// E2E del rediseño sobre el servidor local: datos reales y Chromium instalado.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright-core";

const executablePath = [
  process.env.PLAYWRIGHT_BROWSER_PATH,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find(existsSync);
assert.ok(
  executablePath,
  "Define PLAYWRIGHT_BROWSER_PATH con un Chromium instalado",
);
const origin = process.env.FUELSHIFT_URL ?? "http://localhost:3000";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Usa un servidor local",
);
const outputDirectory =
  process.env.FUELSHIFT_SCREENSHOTS ?? ".screenshots/after";
mkdirSync(outputDirectory, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--disable-extensions",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});
const errors = [],
  network = [],
  report = [];
async function newPage(width, extra = {}) {
  const page = await browser.newPage({
    viewport: { width, height: 1000 },
    hasTouch: width < 768,
    ...extra,
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (["error", "warning"].includes(m.type())) errors.push(m.text());
  });
  page.on("response", (r) => {
    if (r.status() >= 400) network.push(`${r.status()} ${r.url()}`);
  });
  page.on("requestfailed", (r) => {
    // Al cambiar el viewport o cerrar una página MapLibre cancela teselas pendientes.
    if (r.failure()?.errorText !== "net::ERR_ABORTED")
      network.push(`${r.failure()?.errorText} ${r.url()}`);
  });
  return page;
}
async function mapReady(page) {
  await page.waitForFunction(
    () => document.body.textContent.includes("estaciones cargadas"),
    null,
    { timeout: 60_000 },
  );
  await page.locator(".maplibregl-canvas").waitFor();
  await page
    .locator('[aria-label="Lista de estaciones"] button')
    .first()
    .waitFor();
}
const radio = (page, name, value) =>
  page.locator(`label:has(input[name="${name}"][value="${value}"])`);
async function noOverflow(page, context) {
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    `Desbordamiento: ${context}`,
  );
}
try {
  // Las rutas públicas en los cinco anchos del encargo, incluidos dispositivos táctiles.
  for (const [slug, route] of [
    ["map", "/"],
    ["comparison", "/comparador/"],
    ["statistics", "/estadisticas/"],
    ["privacy", "/privacidad/"],
  ]) {
    for (const width of [320, 375, 768, 1024, 1440]) {
      const page = await newPage(width);
      await page.goto(`${origin}${route}`, { waitUntil: "networkidle" });
      if (slug === "map") await mapReady(page);
      if (slug === "statistics") await page.locator(".province-map").waitFor();
      await page.waitForTimeout(350);
      await noOverflow(page, `${slug} ${width}`);
      assert.equal(await page.locator("h1").count(), 1);
      await page.screenshot({
        path: `${outputDirectory}/${slug}-${width}.png`,
        fullPage: true,
      });
      await page.screenshot({
        path: `${outputDirectory}/${slug}-${width}-viewport.png`,
      });
      report.push({ route, width, overflow: false });
      await page.close();
    }
  }
  const map = await newPage(1440);
  await map.goto(origin);
  await mapReady(map);
  assert.equal(await map.locator(".maplibregl-ctrl-attrib").count(), 1);
  assert.equal(
    await map.getByText("El mapa base no está disponible.").count(),
    0,
  );
  const mapBox = await map.locator(".maplibregl-map").boundingBox();
  assert.equal(mapBox.x, 460);
  assert.ok(mapBox.height > 500);
  const desktopFilters = map.getByRole("button", { name: /^Filtros/ });
  assert.equal(await desktopFilters.getAttribute("aria-expanded"), "false");
  await desktopFilters.focus();
  await map.keyboard.press("Enter");
  assert.ok(await map.locator("#advanced-filters").isVisible());
  await map.keyboard.press("Enter");
  assert.equal(await desktopFilters.getAttribute("aria-expanded"), "false");
  const dataOrigin = map.locator(".dataset-details summary");
  await dataOrigin.click();
  await map.getByText(/^Descarga:/).waitFor();
  await dataOrigin.click();
  // Clúster de Madrid en la vista inicial: hover estable y ampliación real.
  const canvas = map.locator(".maplibregl-canvas");
  const madridCluster = { x: mapBox.width / 2 + 47, y: mapBox.height / 2 - 81 };
  await canvas.hover({ position: madridCluster });
  const tooltip = map.locator(".fs-tip");
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /estaciones.*ampliar/);
  const popupElement = await tooltip.elementHandle();
  await map.mouse.move(
    mapBox.x + madridCluster.x + 1,
    mapBox.y + madridCluster.y + 1,
  );
  assert.ok(
    await popupElement.evaluate((el) => el.isConnected),
    "El tooltip no se remonta al mover el ratón",
  );
  const initialScale = await map.locator(".maplibregl-ctrl-scale").innerText();
  await canvas.click({ position: madridCluster });
  await map.waitForFunction(
    (previous) =>
      document.querySelector(".maplibregl-ctrl-scale").textContent !== previous,
    initialScale,
  );
  const search = map.locator("#station-search");
  await search.fill("Alcalá");
  const row = map.locator('[aria-label="Lista de estaciones"] button').first();
  await row.click();
  const title = map.locator("#station-detail-title");
  await title.waitFor();
  assert.equal(
    await title.evaluate((el) => el === document.activeElement),
    true,
  );
  const selected = await title.innerText();
  // El worker puede terminar de dibujar la selección después del vuelo.
  // Repetir el movimiento vuelve a evaluar el punto cuando ya está listo.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await canvas.hover({
      position: { x: mapBox.width / 2 + 1, y: mapBox.height / 2 },
    });
    await canvas.hover({
      position: { x: mapBox.width / 2, y: mapBox.height / 2 },
    });
    if (await tooltip.isVisible()) break;
    await map.waitForTimeout(100);
  }
  await tooltip.waitFor();
  assert.match(await tooltip.innerText(), /€/);
  await radio(map, "map-view", "heat").click();
  const legend = map.locator('[aria-labelledby="heat-legend-title"]');
  const legendToggle = legend.getByRole("button", { name: /la leyenda/ });
  assert.equal(await legendToggle.getAttribute("aria-expanded"), "false");
  await legendToggle.click();
  await legend.getByText("Cómo se calcula").waitFor();
  const limits = () =>
    legend.locator("p").filter({ hasText: "barato" }).innerText();
  const gasoline = await limits();
  const scale = map.locator(".maplibregl-ctrl-scale");
  const scaleBefore = await scale.innerText();
  await map.locator(".maplibregl-ctrl-zoom-in").click();
  await map.waitForFunction(
    (previous) =>
      document.querySelector(".maplibregl-ctrl-scale").textContent !== previous,
    scaleBefore,
  );
  await map.screenshot({ path: `${outputDirectory}/map-heat-1440.png` });
  await radio(map, "map-view", "stations").click();
  assert.equal(await title.innerText(), selected);
  await map
    .getByRole("button", { name: "Cerrar ficha de la estación" })
    .click();
  assert.equal(await search.inputValue(), "Alcalá");
  assert.ok(await row.evaluate((el) => el === document.activeElement));
  await radio(map, "map-view", "heat").click();
  await legendToggle.click();
  await search.fill("");
  assert.equal(
    await limits(),
    gasoline,
    "La escala nacional se conserva al filtrar",
  );
  await radio(map, "fuel", "diesel_a").click();
  await map.waitForFunction(
    (previous) =>
      document
        .querySelector('[aria-labelledby="heat-legend-title"]')
        .textContent.includes("Gasóleo A") &&
      !document
        .querySelector('[aria-labelledby="heat-legend-title"]')
        .textContent.includes(previous),
    gasoline,
  );
  assert.notEqual(await limits(), gasoline);
  await radio(map, "fuel", "gasoline_95_e5").click();
  await legend.getByText("Cómo se calcula").waitFor();
  assert.equal(await limits(), gasoline);
  await map.close();

  const phone = await newPage(375, { reducedMotion: "reduce" });
  await phone.goto(origin);
  await mapReady(phone);
  const sheet = phone.locator(".map-sheet");
  assert.equal(
    await phone
      .locator(".maplibregl-ctrl-attrib-button")
      .evaluate((el) => getComputedStyle(el).backgroundRepeat),
    "no-repeat",
    "El icono de atribución no se repite dentro del objetivo táctil",
  );
  assert.equal(await sheet.getAttribute("data-expanded"), "false");
  const box = await phone.locator(".maplibregl-map").boundingBox();
  assert.ok(box.height >= 300, "Mapa protagonista al abrir");
  await phone.locator("#station-search").focus();
  assert.equal(
    await sheet.getAttribute("data-expanded"),
    "true",
    "El foco abre la hoja",
  );
  const filters = phone.getByRole("button", { name: /^Filtros/ });
  await filters.click();
  await phone.locator("#brand").selectOption({ index: 1 });
  await phone.locator("#max-price").fill("9");
  await filters.click();
  assert.match(await filters.innerText(), /2/);
  await filters.click();
  assert.equal(await phone.locator("#max-price").inputValue(), "9");
  await phone.getByRole("button", { name: "Limpiar filtros" }).click();
  await phone.locator("#station-search").fill("Alcalá");
  const phoneRow = phone
    .locator('[aria-label="Lista de estaciones"] button')
    .first();
  await phoneRow.click();
  await phone.locator("#station-detail-title").waitFor();
  await phone.screenshot({ path: `${outputDirectory}/map-detail-375.png` });
  await phone.keyboard.press("Escape");
  assert.ok(await phoneRow.evaluate((el) => el === document.activeElement));
  await phone
    .getByRole("button", { name: "Reducir el panel para ver el mapa" })
    .tap();
  await radio(phone, "map-view", "heat").tap();
  const mobileLegend = phone.locator('[aria-labelledby="heat-legend-title"]');
  const toggle = phone.getByRole("button", { name: /^Leyenda de precios/ });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.tap();
  await mobileLegend.getByText("Cómo se calcula").waitFor();
  await phone.screenshot({ path: `${outputDirectory}/map-heat-375.png` });
  assert.equal(
    await phone
      .locator(".map-sheet")
      .evaluate((el) => getComputedStyle(el).transitionDuration),
    "0s",
  );
  await phone.close();

  // La pastilla y su contenido permanecen fuera de la hoja, el zoom y las
  // atribuciones, también en el iPhone más pequeño y al ampliar los filtros.
  for (const [width, height] of [
    [320, 568],
    [375, 844],
    [430, 932],
  ]) {
    const page = await newPage(width, {
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    await page.goto(origin);
    await mapReady(page);
    const sheetToggle = page.locator("[data-sheet-toggle]");
    const legendToggle = page.getByRole("button", {
      name: /^Leyenda de precios/,
    });
    const content = page.locator(".map-legend-content");
    const overlap = (a, b) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    for (const view of ["stations", "heat"]) {
      await radio(page, "map-view", view).tap();
      assert.equal(await legendToggle.getAttribute("aria-expanded"), "false");
      for (const panelExpanded of [false, true]) {
        if (
          (await sheetToggle.getAttribute("aria-expanded")) !==
          String(panelExpanded)
        )
          await sheetToggle.tap();
        if (panelExpanded) {
          await page.getByRole("button", { name: /^Filtros/ }).click();
          await page.locator("#brand").waitFor();
        }
        for (const legendExpanded of [false, true]) {
          if (
            (await legendToggle.getAttribute("aria-expanded")) !==
            String(legendExpanded)
          )
            await legendToggle.tap();
          assert.equal(await content.isVisible(), legendExpanded);
          const pill = await legendToggle.boundingBox();
          assert.ok(pill.height >= 44 && pill.height <= 48);
          const visibleMap = await page
            .locator(".maplibregl-map")
            .boundingBox();
          const panel = await page.locator(".map-sheet").boundingBox();
          assert.ok(panel.y - visibleMap.y >= 190, "Franja útil de mapa");
          const occupied = legendExpanded
            ? [pill, await content.boundingBox()]
            : [pill];
          for (const selector of [
            ".map-sheet",
            ".maplibregl-ctrl-top-right",
            ".maplibregl-ctrl-bottom-right",
            ".maplibregl-ctrl-bottom-left",
          ]) {
            const box = await page.locator(selector).boundingBox();
            if (box)
              assert.ok(
                occupied.every((rect) => !overlap(rect, box)),
                `${width} ${view}: leyenda sobre ${selector}`,
              );
          }
          if (legendExpanded) {
            assert.ok((await content.innerText()).includes("P5"));
            assert.ok((await content.innerText()).includes("P95"));
          }
          await page.screenshot({
            path: `${outputDirectory}/legend-${width}-${view}-${panelExpanded}-${legendExpanded}.png`,
          });
          if (legendExpanded) {
            await legendToggle.tap();
            assert.equal(
              await legendToggle.getAttribute("aria-expanded"),
              "false",
            );
            await legendToggle.focus();
            await page.keyboard.press("Space");
            await page
              .locator('.mobile-legend-toggle[aria-expanded="true"]')
              .waitFor({ timeout: 3000 });
            assert.equal(
              await legendToggle.getAttribute("aria-expanded"),
              "true",
            );
            await content.evaluate((el) => {
              el.scrollTop = el.scrollHeight;
            });
            await content.focus();
            await page.keyboard.press("Escape");
            assert.equal(
              await legendToggle.getAttribute("aria-expanded"),
              "false",
            );
            assert.ok(
              await legendToggle.evaluate(
                (el) => el === document.activeElement,
              ),
            );
          }
          await noOverflow(page, `leyenda ${width} ${view}`);
        }
        if (panelExpanded)
          await page.getByRole("button", { name: /^Filtros/ }).click();
      }
      if ((await sheetToggle.getAttribute("aria-expanded")) === "true")
        await sheetToggle.tap();
    }
    await page.close();
  }

  const comparison = await newPage(320);
  await comparison.goto(
    `${origin}/comparador/?fuel=gasoline_95_e5&price=1.299&station=123`,
  );
  const km = comparison.getByRole("spinbutton", {
    name: "Kilómetros al año (km)",
    exact: true,
  });
  await km.fill("24000");
  // Con el doble de kilómetros, el consumo eléctrico inicial cuesta 816 €/año.
  assert.match(
    await comparison.locator(".result-row").nth(2).innerText(),
    /816/,
  );
  await comparison
    .getByRole("button", { name: "Personalizado", exact: true })
    .click();
  const years = comparison.getByRole("spinbutton", {
    name: "Proyección (años)",
    exact: true,
  });
  await years.fill("0");
  assert.equal(await years.getAttribute("aria-invalid"), "true");
  assert.equal(await comparison.locator(".result-row").count(), 0);
  await comparison
    .getByRole("button", { name: "Sencillo", exact: true })
    .click();
  assert.equal(await comparison.locator(".result-row").count(), 3);
  await km.fill("123456789123456789");
  await noOverflow(comparison, "número inválido largo");
  await comparison.getByRole("button", { name: "Restablecer ejemplo" }).click();
  assert.equal(await km.inputValue(), "12000");
  await comparison.getByRole("slider").focus();
  await comparison.keyboard.press("ArrowRight");
  assert.equal(await km.inputValue(), "12500");
  await comparison
    .getByRole("button", { name: "Personalizado", exact: true })
    .click();
  for (const [name, value] of [
    ["Kilómetros al año (km)", "150000"],
    ["Proyección (años)", "20"],
    ["Gasolina (€/L)", "10"],
    ["Diésel (€/L)", "10"],
    ["Electricidad (€/kWh)", "5"],
    ["Consumo gasolina (L/100 km)", "60"],
    ["Consumo diésel (L/100 km)", "60"],
    ["Consumo eléctrico (kWh/100 km)", "120"],
  ])
    await comparison.getByRole("spinbutton", { name, exact: true }).fill(value);
  assert.equal(await comparison.locator(".result-row").count(), 3);
  for (const width of [320, 375, 768, 1024, 1440]) {
    await comparison.setViewportSize({ width, height: 1000 });
    await noOverflow(comparison, `valores máximos válidos, ${width}px`);
  }
  await comparison.close();

  const stats = await newPage(375);
  await stats.goto(`${origin}/estadisticas/`, { waitUntil: "networkidle" });
  const mean = await stats.locator("dl dd").first().innerText();
  await radio(stats, "statistics-fuel", "diesel_a").click();
  assert.notEqual(await stats.locator("dl dd").first().innerText(), mean);
  const provinceMap = stats.locator(".province-map");
  await provinceMap.focus();
  await stats.keyboard.press("Home");
  const announcement = provinceMap
    .locator("xpath=../..")
    .locator('[aria-live="polite"]');
  const first = await announcement.innerText();
  await stats.keyboard.press("ArrowRight");
  assert.notEqual(await announcement.innerText(), first);
  await stats.keyboard.press("End");
  assert.match(await announcement.innerText(), /MELILLA/);
  await stats.keyboard.press("Escape");
  assert.equal(await announcement.innerText(), "");
  await provinceMap.locator("circle").first().tap();
  assert.match(await announcement.innerText(), /CEUTA/);
  await stats.getByRole("button", { name: /Ver las 52 provincias/ }).click();
  assert.equal(
    await stats.locator('ol[aria-label="Provincias"] > li').count(),
    52,
  );
  const daily = stats.locator('[aria-labelledby="history-title"]');
  await daily.getByRole("group", { name: /Usa las flechas/ }).focus();
  await stats.keyboard.press("Home");
  assert.match(
    await daily.locator('[aria-live="polite"]').innerText(),
    /estaciones/,
  );
  // La navegación debe funcionar también sirviendo out/ sin un runtime Next.
  for (const [name, path] of [
    ["Comparador", "/comparador/"],
    ["Mapa", "/"],
    ["Estadísticas", "/estadisticas/"],
  ]) {
    await stats
      .locator("nav:visible")
      .getByRole("link", { name, exact: true })
      .click();
    await stats.waitForURL(`${origin}${path}`);
    assert.equal(
      await stats.locator('nav:visible [aria-current="page"]').innerText(),
      name,
    );
    if (path === "/") await mapReady(stats);
  }
  await stats.close();
  assert.deepEqual(errors, [], "Consola y errores JavaScript");
  assert.deepEqual(network, [], "Red");
  console.log(
    JSON.stringify(
      {
        responsive: report,
        interactions:
          "mapa, filtros, selección, foco, calor, zoom, comparador, estadísticas e histórico: PASS",
        consoleErrors: errors,
        networkErrors: network,
      },
      null,
      2,
    ),
  );
} finally {
  writeFileSync(
    `${outputDirectory}/e2e-report.json`,
    JSON.stringify({ responsive: report, errors, network }, null, 2),
  );
  await browser.close();
}
