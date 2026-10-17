import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { chromium } from "playwright-core";

const browserCandidates = [
  process.env.PLAYWRIGHT_BROWSER_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) =>
  existsSync(candidate),
);

if (!executablePath) {
  throw new Error(
    "No se encontró Chromium. Define PLAYWRIGHT_BROWSER_PATH para ejecutar esta prueba manual.",
  );
}

const targetUrl = process.env.FUELSHIFT_URL ?? "http://localhost:3000";
const outputDirectory = path.resolve(process.cwd(), ".screenshots");
mkdirSync(outputDirectory, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    "--ignore-certificate-errors",
    "--disable-extensions",
    "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader",
  ],
});

async function waitForDataset(page) {
  await page.waitForFunction(
    () => {
      const body = document.body.textContent ?? "";
      return (
        body.includes("estaciones cargadas") ||
        body.includes("No hay datos oficiales disponibles")
      );
    },
    undefined,
    { timeout: 30_000 },
  );
}

try {
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const browserErrors = [];
  desktop.on("pageerror", (error) => browserErrors.push(error.message));
  desktop.on("response", (response) => {
    const url = new URL(response.url());
    if (
      url.origin === new URL(targetUrl).origin &&
      response.status() >= 400 &&
      url.pathname !== "/favicon.ico"
    ) {
      browserErrors.push(`${response.status()} ${url.pathname}`);
    }
  });

  await desktop.goto(targetUrl, { waitUntil: "domcontentloaded" });
  try {
    await waitForDataset(desktop);
  } catch (error) {
    throw new Error(
      `La aplicación no terminó de cargar. ${error instanceof Error ? error.message : ""}\n${browserErrors.join("\n")}`,
    );
  }
  await desktop.locator("#station-search").fill("Alcalá");
  const firstResult = desktop
    .locator('[aria-label="Lista de estaciones"] button')
    .first();
  await firstResult.waitFor({ state: "visible" });
  await firstResult.click();
  await desktop
    .getByRole("heading", { name: /selecciona una estación/i })
    .waitFor({ state: "detached" });
  await desktop.waitForTimeout(5_000);
  await desktop.screenshot({
    path: path.join(outputDirectory, "map-desktop.png"),
    fullPage: true,
  });

  // Alterna a precios por zona y vuelve: filtros, resultados y selección se
  // conservan, y los controles del mapa siguen respondiendo.
  const mapView = (page, value) =>
    page.locator(`label:has(input[name="map-view"][value="${value}"])`);
  const legendOf = (page) =>
    page.locator('[aria-labelledby="zone-legend-title"]');
  const legendToggle = (page) =>
    legendOf(page).getByRole("button", { name: /la leyenda/ });
  const viewState = async () => ({
    search: await desktop.locator("#station-search").inputValue(),
    results: await desktop
      .locator('[aria-labelledby="results-title"] span')
      .first()
      .innerText(),
    selected: await desktop.locator("#station-detail-title").innerText(),
  });
  const scaleText = () => desktop.locator(".maplibregl-ctrl-scale").innerText();
  const zoneLegend = legendOf(desktop);
  const beforeZones = await viewState();
  await mapView(desktop, "zones").click();
  await zoneLegend
    .getByText("Más cara", { exact: true })
    .waitFor({ state: "visible" });
  const desktopLegendExpanded =
    (await legendToggle(desktop).getAttribute("aria-expanded")) === "true";
  const scaleBefore = await scaleText();
  await desktop.locator(".maplibregl-ctrl-zoom-in").click();
  await desktop.waitForTimeout(1_500);
  const zoomControlWorks = (await scaleText()) !== scaleBefore;
  await desktop.screenshot({
    path: path.join(outputDirectory, "map-zones-desktop.png"),
  });
  const zoneLegendText = await zoneLegend.innerText();
  await mapView(desktop, "stations").click();
  await zoneLegend.waitFor({ state: "detached" });
  const afterZones = await viewState();
  await desktop
    .getByRole("button", { name: "Cerrar ficha de la estación" })
    .click();
  const detailCloses = await desktop
    .getByRole("heading", { name: /selecciona una estación/i })
    .isVisible();

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  mobile.on("pageerror", (error) => browserErrors.push(error.message));
  await mobile.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await waitForDataset(mobile);
  await mobile.waitForTimeout(5_000);
  await mobile.screenshot({
    path: path.join(outputDirectory, "map-mobile.png"),
    fullPage: true,
  });
  await mapView(mobile, "zones").click();
  const mobileLegend = legendOf(mobile);
  await mobileLegend
    .getByRole("list", { name: /^Escala de / })
    .waitFor({ state: "visible" });
  const mobileCollapsed = {
    expanded: await legendToggle(mobile).getAttribute("aria-expanded"),
    height: Math.round((await mobileLegend.boundingBox())?.height ?? 0),
    summaryItems: await mobileLegend
      .getByRole("list", { name: /^Escala de / })
      .getByRole("listitem")
      .count(),
    horizontalScroll: await mobile.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  };
  await mobile
    .locator('[role=region][aria-label^="Mapa"]')
    .scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(1_500);
  await mobile.screenshot({
    path: path.join(outputDirectory, "map-zones-mobile.png"),
  });
  await legendToggle(mobile).click();
  await mobileLegend
    .getByText("Más cara", { exact: true })
    .waitFor({ state: "visible" });
  const mobileExpanded =
    (await legendToggle(mobile).getAttribute("aria-expanded")) === "true";
  await mobile.screenshot({
    path: path.join(outputDirectory, "map-zones-mobile-expanded.png"),
  });

  if (browserErrors.length > 0) {
    throw new Error(`Errores de navegador:\n${browserErrors.join("\n")}`);
  }

  const report = {
    url: targetUrl,
    stations: await desktop
      .locator('[aria-label="Lista de estaciones"] button')
      .count(),
    mapCanvas: await desktop.locator(".maplibregl-canvas").count(),
    mapHeight: Math.round(
      (await desktop.locator(".maplibregl-map").boundingBox())?.height ?? 0,
    ),
    attribution: await desktop.locator(".maplibregl-ctrl-attrib").count(),
    providerError: await desktop
      .getByText("El mapa base no está disponible.")
      .count(),
    zoneLegend: ["Más barata", "Intermedia", "Más cara"].every((label) =>
      zoneLegendText.includes(label),
    ),
    viewKeepsState: JSON.stringify(beforeZones) === JSON.stringify(afterZones),
    desktopLegendExpanded,
    zoomControlWorks,
    detailCloses,
    mobileLegend: { ...mobileCollapsed, expandable: mobileExpanded },
    screenshots: [
      ".screenshots/map-desktop.png",
      ".screenshots/map-zones-desktop.png",
      ".screenshots/map-mobile.png",
      ".screenshots/map-zones-mobile.png",
      ".screenshots/map-zones-mobile-expanded.png",
    ],
  };
  if (
    report.mapCanvas !== 1 ||
    report.mapHeight < 200 ||
    report.attribution !== 1 ||
    report.providerError !== 0 ||
    !report.zoneLegend ||
    !report.viewKeepsState ||
    !report.desktopLegendExpanded ||
    !report.zoomControlWorks ||
    !report.detailCloses ||
    report.mobileLegend.expanded !== "false" ||
    report.mobileLegend.summaryItems !== 3 ||
    report.mobileLegend.height > 110 ||
    report.mobileLegend.horizontalScroll ||
    !report.mobileLegend.expandable
  ) {
    throw new Error(
      `El mapa no superó la comprobación visual: ${JSON.stringify(report)}`,
    );
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
