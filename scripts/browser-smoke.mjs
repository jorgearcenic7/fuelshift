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
    page.locator('[aria-labelledby="heat-legend-title"]');
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
  const heatLegend = legendOf(desktop);
  const beforeHeat = await viewState();
  await mapView(desktop, "heat").click();
  await heatLegend.getByText("Cómo se calcula").waitFor({ state: "visible" });
  const desktopLegendExpanded =
    (await legendToggle(desktop).getAttribute("aria-expanded")) === "true";
  const scaleBefore = await scaleText();
  await desktop.locator(".maplibregl-ctrl-zoom-in").click();
  await desktop.waitForTimeout(1_500);
  const zoomControlWorks = (await scaleText()) !== scaleBefore;
  await desktop.screenshot({
    path: path.join(outputDirectory, "map-heat-desktop.png"),
  });
  const heatLegendText = await heatLegend.innerText();
  // Límites P5–P95: estables al quitar el filtro de búsqueda.
  const scaleLimits = () =>
    heatLegend.locator("p").filter({ hasText: "barato" }).first().innerText();
  const limitsFiltered = await scaleLimits();
  await desktop.locator("#station-search").fill("");
  await desktop.waitForTimeout(1_000);
  const limitsUnfiltered = await scaleLimits();
  await desktop.locator("#station-search").fill("Alcalá");
  await desktop.waitForTimeout(1_000);
  await mapView(desktop, "stations").click();
  await heatLegend.waitFor({ state: "detached" });
  const afterHeat = await viewState();
  await desktop
    .getByRole("button", { name: "Cerrar ficha de la estación" })
    .click();
  const detailCloses = await desktop
    .getByRole("heading", { name: /selecciona una estación/i })
    .isVisible();
  // La escala cambia con el combustible y vuelve al mismo valor al regresar.
  const fuelOption = (code) =>
    desktop.locator(`label:has(input[name="fuel"][value="${code}"])`);
  await mapView(desktop, "heat").click();
  await heatLegend.getByText("Cómo se calcula").waitFor({ state: "visible" });
  const limitsGasoline = await scaleLimits();
  await fuelOption("diesel_a").click();
  await desktop.waitForTimeout(1_000);
  const limitsDiesel = await scaleLimits();
  await fuelOption("gasoline_95_e5").click();
  await desktop.waitForTimeout(1_000);
  const limitsGasolineAgain = await scaleLimits();
  await mapView(desktop, "stations").click();

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
  await mapView(mobile, "heat").click();
  const mobileLegend = legendOf(mobile);
  await mobileLegend
    .getByText("caro", { exact: true })
    .waitFor({ state: "visible" });
  const mobileCollapsed = {
    expanded: await legendToggle(mobile).getAttribute("aria-expanded"),
    height: Math.round((await mobileLegend.boundingBox())?.height ?? 0),
    scaleEnds:
      (await mobileLegend.getByText("barato", { exact: true }).isVisible()) &&
      (await mobileLegend.getByText("caro", { exact: true }).isVisible()),
    horizontalScroll: await mobile.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
  };
  await mobile
    .locator('[role=region][aria-label^="Mapa"]')
    .scrollIntoViewIfNeeded();
  await mobile.waitForTimeout(1_500);
  await mobile.screenshot({
    path: path.join(outputDirectory, "map-heat-mobile.png"),
  });
  await legendToggle(mobile).click();
  await mobileLegend.getByText("Cómo se calcula").waitFor({ state: "visible" });
  const mobileExpanded =
    (await legendToggle(mobile).getAttribute("aria-expanded")) === "true";
  await mobile.screenshot({
    path: path.join(outputDirectory, "map-heat-mobile-expanded.png"),
  });

  // Móvil: el mapa se ve al abrir, los filtros avanzados se pliegan sin
  // perder valores, el mapa responde a ellos y una estación elegida en la lista
  // muestra su ficha junto al mapa.
  const phoneHeight = 844;
  const phone = await browser.newPage({
    viewport: { width: 390, height: phoneHeight },
  });
  phone.on("pageerror", (error) => browserErrors.push(error.message));
  phone.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      browserErrors.push(message.text());
    }
  });
  await phone.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await waitForDataset(phone);
  const phoneMap = phone.locator(".maplibregl-map");
  const openBox = await phoneMap.boundingBox();
  const mapVisibleOnOpen = Math.round(
    Math.max(0, Math.min(phoneHeight, openBox.y + openBox.height) - openBox.y),
  );
  await phone.waitForTimeout(3_000);
  await phone.screenshot({
    path: path.join(outputDirectory, "map-mobile-open.png"),
  });

  const filtersButton = phone.getByRole("button", { name: /^Filtros/ });
  const advancedFilters = phone.locator("#advanced-filters");
  const filtersState = async () => ({
    expanded: await filtersButton.getAttribute("aria-expanded"),
    visible: await advancedFilters.isVisible(),
  });
  const resultsCount = () =>
    phone.locator('[aria-labelledby="results-title"] span').first().innerText();
  const legendStations = () =>
    legendOf(phone)
      .getByText(/^Representa las/)
      .innerText();
  const closedOnOpen = await filtersState();
  const unfilteredCount = await resultsCount();
  await mapView(phone, "heat").click();
  await legendToggle(phone).click();
  const legendUnfiltered = await legendStations();
  await legendToggle(phone).click();

  await filtersButton.click();
  const opened = await filtersState();
  await phone.screenshot({
    path: path.join(outputDirectory, "map-mobile-filters.png"),
  });
  const brandValue = await phone
    .locator("#brand option")
    .nth(1)
    .getAttribute("value");
  await phone.locator("#brand").selectOption(brandValue);
  await phone.locator("#max-price").fill("9");
  await filtersButton.click();
  const closed = await filtersState();
  const badgeAnnounced =
    (await phone.getByRole("button", { name: /2 activos/ }).count()) === 1;
  await phone.waitForTimeout(1_000);
  const filteredCount = await resultsCount();
  await legendToggle(phone).click();
  const legendFiltered = await legendStations();
  await legendToggle(phone).click();
  await filtersButton.click();
  const keepsValues =
    (await phone.locator("#brand").inputValue()) === brandValue &&
    (await phone.locator("#max-price").inputValue()) === "9";
  await filtersButton.click();
  await phone.getByRole("button", { name: "Limpiar filtros" }).click();
  await mapView(phone, "stations").click();

  const phoneResult = phone
    .locator('[aria-label="Lista de estaciones"] button')
    .first();
  await phoneResult.scrollIntoViewIfNeeded();
  await phoneResult.click();
  await phone
    .getByRole("heading", { name: /selecciona una estación/i })
    .waitFor({ state: "detached" });
  await phone.waitForTimeout(2_000);
  const selectedMapBox = await phoneMap.boundingBox();
  const detailBox = await phone
    .locator('aside[aria-labelledby="station-detail-title"]')
    .boundingBox();
  await phone.screenshot({
    path: path.join(outputDirectory, "map-mobile-station.png"),
  });

  // Teclado: desde la búsqueda se llega a «Filtros», se abre y se cierra con
  // Intro, y dos tabulaciones después (combustible) el foco entra en el mapa,
  // cuyo lienzo es lo primero que se enfoca.
  await phone.evaluate(() => window.scrollTo(0, 0));
  await phone.locator("#station-search").focus();
  await phone.keyboard.press("Tab");
  const focusOnFilters = await phone.evaluate(
    () =>
      document.activeElement?.getAttribute("aria-controls") ===
        "advanced-filters" &&
      getComputedStyle(document.activeElement).outlineStyle !== "none",
  );
  await phone.keyboard.press("Enter");
  const keyboardOpens = (await filtersState()).expanded === "true";
  await phone.keyboard.press("Enter");
  const keyboardCloses = (await filtersState()).expanded === "false";
  let tabsToMap = 0;
  while (tabsToMap < 10) {
    await phone.keyboard.press("Tab");
    tabsToMap += 1;
    const inMap = await phone.evaluate(() =>
      Boolean(document.activeElement?.closest(".maplibregl-map")),
    );
    if (inMap) break;
  }

  const horizontalScroll = {};
  for (const width of [320, 360, 390, 430, 768, 1024, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    await waitForDataset(page);
    horizontalScroll[width] = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    await page.close();
  }

  // Estadísticas: indicadores por combustible y estados del histórico. Usa
  // pestañas propias para que el informe final siga midiendo el mapa.
  const statisticsUrl = new URL("/estadisticas/", targetUrl).href;
  const statsDesktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const statsMobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  for (const page of [statsDesktop, statsMobile]) {
    page.on("pageerror", (error) => browserErrors.push(error.message));
  }
  const nationalMean = (page) => page.locator("dl dd").first().innerText();
  const rankingHeading = (page) =>
    page.getByRole("heading", { name: "Precio medio por provincia" });

  await statsDesktop.goto(statisticsUrl, { waitUntil: "domcontentloaded" });
  await rankingHeading(statsDesktop).waitFor({ state: "visible" });
  const statisticsActiveNav = await statsDesktop
    .locator('nav a[aria-current="page"]')
    .innerText();
  const meanGasoline = await nationalMean(statsDesktop);
  // El HTML estático muestra el selector antes de que React lo hidrate, y un
  // clic previo se pierde. React enlaza en cada nodo hidratado una propiedad
  // "__reactProps$…" con sus manejadores: se espera a que el selector la tenga
  // y se pulsa una sola vez. Si React cambiara ese detalle interno, la espera
  // fallaría con un error explícito, nunca con un falso positivo.
  await statsDesktop
    .waitForFunction(
      () => {
        const input = document.querySelector(
          'input[name="statistics-fuel"][value="diesel_a"]',
        );
        return (
          input !== null &&
          Object.keys(input).some((key) => key.startsWith("__reactProps$"))
        );
      },
      undefined,
      { timeout: 30_000 },
    )
    .catch(() => {
      throw new Error(
        "El selector de combustible de /estadisticas no llegó a hidratarse.",
      );
    });
  await statsDesktop
    .locator('label:has(input[name="statistics-fuel"][value="diesel_a"])')
    .click();
  const fuelChangesMean = await statsDesktop
    .waitForFunction(
      (previous) => document.querySelector("dl dd")?.textContent !== previous,
      meanGasoline,
      { timeout: 5_000 },
    )
    .then(
      () => true,
      () => false,
    );
  // El histórico se descarga después de hidratar: se espera a que el panel
  // deje de indicar la carga antes de leerlo o capturarlo.
  const historyLoaded = (page) =>
    page
      .waitForFunction(
        () => {
          const text =
            document.querySelector("#history-title")?.parentElement
              ?.textContent ?? "";
          return text !== "" && !text.includes("Cargando el histórico");
        },
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
  await historyLoaded(statsDesktop);
  const historyState = await statsDesktop
    .locator("#history-title")
    .locator("xpath=..")
    .innerText();
  await statsDesktop.screenshot({
    path: path.join(outputDirectory, "statistics-desktop.png"),
    fullPage: true,
  });

  await statsMobile.goto(statisticsUrl, { waitUntil: "domcontentloaded" });
  await rankingHeading(statsMobile).waitFor({ state: "visible" });
  await historyLoaded(statsMobile);
  const statisticsMobileScroll = await statsMobile.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  await statsMobile.screenshot({
    path: path.join(outputDirectory, "statistics-mobile.png"),
    fullPage: true,
  });

  if (browserErrors.length > 0) {
    throw new Error(`Errores de navegador:\n${browserErrors.join("\n")}`);
  }

  // En desarrollo, compilar /estadisticas por primera vez puede recargar las
  // pestañas del mapa. Antes de medirlo se espera a que MapLibre vuelva a
  // montar un lienzo visible y su atribución; si no ocurre en el plazo, la
  // prueba falla con `mapReady: false` además de las comprobaciones de abajo.
  const mapReady = await desktop
    .waitForFunction(
      () => {
        const canvas = document.querySelector(".maplibregl-canvas");
        const box = canvas?.getBoundingClientRect();
        return Boolean(
          box &&
            box.width > 0 &&
            box.height > 0 &&
            getComputedStyle(canvas).visibility !== "hidden" &&
            document.querySelector(".maplibregl-ctrl-attrib"),
        );
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(
      () => true,
      () => false,
    );

  // Escritorio sin cambios: panel lateral de 25rem con todos los filtros a la
  // vista y el mapa fijo a su derecha aunque se desplace la columna.
  const desktopLayout = await desktop.evaluate(() => {
    const mapBox = () =>
      document.querySelector(".maplibregl-map").getBoundingClientRect();
    const column = document
      .querySelector("#map-title")
      .closest("section").parentElement;
    const before = mapBox();
    column.scrollTop = 600;
    const scrolled = mapBox();
    column.scrollTop = 0;
    const filtersButton = document.querySelector(
      '[aria-controls="advanced-filters"]',
    );
    return {
      mapLeft: Math.round(before.left),
      mapTop: Math.round(before.top),
      mapWidth: Math.round(before.width),
      columnScrolls: column.scrollHeight > column.clientHeight,
      mapStaysOnScroll:
        before.top === scrolled.top && before.left === scrolled.left,
      filtersButtonHidden: getComputedStyle(filtersButton).display === "none",
      advancedVisible:
        document.querySelector("#advanced-filters").offsetParent !== null,
    };
  });

  const report = {
    url: targetUrl,
    mapReady,
    desktopLayout,
    mobileMap: {
      mapVisibleOnOpen,
      closedOnOpen,
      opened,
      closed,
      badgeAnnounced,
      keepsValues,
      resultsFollowFilters: filteredCount !== unfilteredCount,
      heatmapFollowsFilters: legendFiltered !== legendUnfiltered,
      stationFromList: {
        mapTop: Math.round(selectedMapBox?.y ?? -1),
        detailTop: Math.round(detailBox?.y ?? -1),
      },
      keyboard: { focusOnFilters, keyboardOpens, keyboardCloses, tabsToMap },
      horizontalScroll,
    },
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
    heatLegend: ["barato", "caro", "Escala nacional", "Precios reales"].every(
      (label) => heatLegendText.includes(label),
    ),
    viewKeepsState: JSON.stringify(beforeHeat) === JSON.stringify(afterHeat),
    desktopLegendExpanded,
    scaleStableWithFilters: limitsFiltered === limitsUnfiltered,
    scaleFollowsFuel:
      limitsDiesel !== limitsGasoline && limitsGasolineAgain === limitsGasoline,
    zoomControlWorks,
    detailCloses,
    mobileLegend: { ...mobileCollapsed, expandable: mobileExpanded },
    statistics: {
      activeNav: statisticsActiveNav,
      fuelChangesMean,
      historyShown:
        /Todavía no hay histórico|Observaciones diarias reales/.test(
          historyState,
        ),
      mobileScroll: statisticsMobileScroll,
    },
    screenshots: [
      ".screenshots/map-desktop.png",
      ".screenshots/map-heat-desktop.png",
      ".screenshots/map-mobile.png",
      ".screenshots/map-heat-mobile.png",
      ".screenshots/map-heat-mobile-expanded.png",
      ".screenshots/map-mobile-open.png",
      ".screenshots/map-mobile-filters.png",
      ".screenshots/map-mobile-station.png",
      ".screenshots/statistics-desktop.png",
      ".screenshots/statistics-mobile.png",
    ],
  };
  if (
    !report.mapReady ||
    report.mapCanvas !== 1 ||
    report.mapHeight < 200 ||
    report.attribution !== 1 ||
    report.providerError !== 0 ||
    !report.heatLegend ||
    !report.viewKeepsState ||
    !report.desktopLegendExpanded ||
    !report.scaleStableWithFilters ||
    !report.scaleFollowsFuel ||
    !report.zoomControlWorks ||
    !report.detailCloses ||
    report.mobileLegend.expanded !== "false" ||
    !report.mobileLegend.scaleEnds ||
    report.mobileLegend.height > 110 ||
    report.mobileLegend.horizontalScroll ||
    !report.mobileLegend.expandable ||
    report.desktopLayout.mapLeft !== 400 ||
    report.desktopLayout.mapTop !== 56 ||
    report.desktopLayout.mapWidth !== 1040 ||
    !report.desktopLayout.columnScrolls ||
    !report.desktopLayout.mapStaysOnScroll ||
    !report.desktopLayout.filtersButtonHidden ||
    !report.desktopLayout.advancedVisible ||
    report.mobileMap.mapVisibleOnOpen < 300 ||
    report.mobileMap.closedOnOpen.expanded !== "false" ||
    report.mobileMap.closedOnOpen.visible ||
    report.mobileMap.opened.expanded !== "true" ||
    !report.mobileMap.opened.visible ||
    report.mobileMap.closed.expanded !== "false" ||
    report.mobileMap.closed.visible ||
    !report.mobileMap.badgeAnnounced ||
    !report.mobileMap.keepsValues ||
    !report.mobileMap.resultsFollowFilters ||
    !report.mobileMap.heatmapFollowsFilters ||
    Math.abs(report.mobileMap.stationFromList.mapTop) > 16 ||
    report.mobileMap.stationFromList.detailTop < 0 ||
    report.mobileMap.stationFromList.detailTop > phoneHeight - 150 ||
    !report.mobileMap.keyboard.focusOnFilters ||
    !report.mobileMap.keyboard.keyboardOpens ||
    !report.mobileMap.keyboard.keyboardCloses ||
    report.mobileMap.keyboard.tabsToMap > 2 ||
    Object.values(report.mobileMap.horizontalScroll).some(Boolean) ||
    report.statistics.activeNav !== "Estadísticas" ||
    !report.statistics.fuelChangesMean ||
    !report.statistics.historyShown ||
    report.statistics.mobileScroll
  ) {
    throw new Error(
      `El mapa no superó la comprobación visual: ${JSON.stringify(report)}`,
    );
  }

  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
