import { expect, test } from "@playwright/test";

test("configures an external provider without offering local downloads", async ({ page }) => {
  await page.route("**/api/teacher/config", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        json: { configured: { openai: true, gemini: false } }
      });
      return;
    }
    await route.fulfill({
      json: { configured: { openai: false, gemini: false } }
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Configurar modelo|Configure model/ })).toBeVisible();
  await page.getByRole("button", { name: /Configurar modelo|Configure model/ }).click();

  const settings = page.getByRole("dialog", { name: /Preferencias|Preferences/ });
  const providerSelect = settings.getByLabel(/Proveedor|Provider/);
  const modelSelect = settings.getByRole("combobox", { name: "Modelo", exact: true });
  const keyInput = settings.getByLabel("API key");
  await expect(providerSelect).toHaveValue("openai");
  await expect(modelSelect).toBeVisible();
  await expect(modelSelect.locator("option")).toHaveCount(2);
  await expect(keyInput).toHaveAttribute("type", "password");
  await providerSelect.selectOption("gemini");
  await expect(modelSelect.locator("option")).toHaveCount(2);
  await expect(modelSelect.locator("option").first()).toContainText("Gemini");
  await expect(settings).not.toContainText(/descargar|download/i);
});

test("offers only assisted and unassisted games without requiring an API key", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "QuietMove" })).toBeVisible();
  await expect(page.locator(".engine-indicator.ready")).toBeVisible({ timeout: 15_000 });
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: /Profesor|Teacher/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sin ayuda|No help/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Posición|Position/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Revisión|Review/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Cálculo|Calculation/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Tal$/ })).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: /Configurar modelo|Configure model/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /El profesor|The teacher/ })).toHaveCount(0);
  await expect(page.getByPlaceholder(/Escribe tu pregunta|Write your question/)).toBeHidden();
  await expect(page.locator(".quiet-board")).toBeVisible();
  if (testInfo.project.name === "chromium-desktop") {
    expect(
      await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)
    ).toBe(true);
  }
});

test("keeps the chosen theme and omits retired storage controls", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Compatibilidad|Compatibility/ })).toHaveCount(0);
  await expect(page.locator(".evaluation-bar")).toHaveCount(1);

  await page.getByRole("button", { name: /Preferencias|Preferences/ }).click();
  const settings = page.getByRole("dialog", { name: /Preferencias|Preferences/ });
  await expect(settings).not.toContainText(/Guardar partidas|Save games/);
  await expect(settings).not.toContainText(/Web Workers|WebAssembly|Almacenamiento local|Local storage/);
  await expect(settings).not.toContainText(/Exportar mis datos|Export my data|Borrar datos|Delete saved data/);
  await expect(settings.getByRole("heading", { name: /Ayudas en el tablero|Board assistance/ })).toBeVisible();
  const botLevel = settings.getByLabel(/Nivel estimado|Estimated level/);
  await expect(botLevel).toHaveAttribute("min", "0");
  await expect(botLevel).toHaveAttribute("max", "3000");

  const evaluation = settings.getByRole("switch", { name: /Mostrar barra|Show evaluation bar/ });
  const classifications = settings.getByRole("switch", { name: /Mostrar clasif|Show move classifications/ });
  await expect(settings.getByRole("switch", { name: /cambiar jugadas anteriores|changing earlier moves/ })).toHaveAttribute("aria-checked", "false");
  await evaluation.click();
  await classifications.click();
  await expect(page.locator(".evaluation-bar")).toHaveCount(0);
  await expect(page.locator(".board-and-eval")).toHaveClass(/without-evaluation/);

  const darkMode = settings.getByRole("switch", { name: /Modo oscuro|Dark mode/ });
  await darkMode.click();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator(".app-shell")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator(".evaluation-bar")).toHaveCount(0);
  await page.getByRole("button", { name: /Preferencias|Preferences/ }).click();
  await expect(page.getByRole("switch", { name: /Mostrar barra|Show evaluation bar/ })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByRole("switch", { name: /Mostrar clasif|Show move classifications/ })).toHaveAttribute("aria-checked", "false");
});

test("sends only one teacher request after repeated activation", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  let teacherRequests = 0;
  await page.route("**/api/teacher/config", async (route) => {
    await route.fulfill({
      json: { configured: { openai: false, gemini: true } }
    });
  });
  await page.route("**/api/teacher/respond", async (route) => {
    teacherRequests += 1;
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.fulfill({
      json: { summary: "Respuesta comprobada.", sources: [] }
    });
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({
        language: "es",
        aiProvider: "gemini",
        aiModel: "gemini-3.5-flash"
      })
    );
  });
  await page.goto("/");
  await page.getByPlaceholder(/Escribe tu pregunta|Write your question/).fill("¿Qué debería intentar?");
  const askButton = page.getByRole("button", { name: "Preguntar", exact: true });
  await askButton.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });

  await expect(page.getByText("Consultando Google Gemini")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("Respuesta comprobada.")).toBeVisible({ timeout: 25_000 });
  expect(teacherRequests).toBe(1);
});

test("sets the player color before starting and locks the setup during play", async ({ page }) => {
  await page.goto("/");
  const start = page.getByRole("button", { name: "Comenzar partida", exact: true });
  const flip = page.getByRole("button", { name: "Girar tablero", exact: true });
  const restart = page.getByRole("button", { name: "Nueva sesión", exact: true });

  await expect(start).toBeVisible();
  await expect(flip).toBeVisible();
  await expect(restart).toBeVisible();

  await flip.click();
  await expect(page.locator(".board-coordinate-files span").first()).toHaveText("h");
  await expect(page.locator(".evaluation-bar")).toHaveClass(/orientation-black/);
  await start.click();

  await expect(start).toBeHidden();
  await expect(flip).toBeHidden();
  await expect(restart).toBeVisible();
  await expect(page.locator(".moves-strip button")).toHaveCount(1, { timeout: 20_000 });
});

test("keeps a White-perspective value attached to the White end when the board flips", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop evaluation geometry coverage");
  await page.goto("/");
  const evaluation = page.locator(".evaluation-bar");
  const label = evaluation.locator("span");
  await expect(evaluation).toHaveAttribute("data-evaluation-status", "ready", { timeout: 25_000 });
  await expect(evaluation).toHaveAttribute("data-evaluation-perspective", "white");

  const valueBefore = await evaluation.getAttribute("data-evaluation-value");
  const barBefore = await evaluation.boundingBox();
  const labelBefore = await label.boundingBox();
  if (!barBefore || !labelBefore) throw new Error("Evaluation is not visible");
  expect(labelBefore.y + labelBefore.height / 2).toBeGreaterThan(barBefore.y + barBefore.height / 2);

  await page.getByRole("button", { name: "Girar tablero", exact: true }).click();
  await expect(evaluation).toHaveClass(/orientation-black/);
  expect(await evaluation.getAttribute("data-evaluation-value")).toBe(valueBefore);
  const barAfter = await evaluation.boundingBox();
  const labelAfter = await label.boundingBox();
  if (!barAfter || !labelAfter) throw new Error("Flipped evaluation is not visible");
  expect(labelAfter.y + labelAfter.height / 2).toBeLessThan(barAfter.y + barAfter.height / 2);
});

test("places every coordinate outside and centered on its square in both orientations and themes", async ({ page }) => {
  await page.goto("/");

  const assertCoordinates = async (files: string[], ranks: string[]) => {
    const board = await page.locator(".quiet-board").boundingBox();
    if (!board) throw new Error("Board is not visible");
    const fileLabels = page.locator(".board-coordinate-files span");
    const rankLabels = page.locator(".board-coordinate-ranks span");
    await expect(fileLabels).toHaveCount(8);
    await expect(rankLabels).toHaveCount(8);

    for (let index = 0; index < 8; index += 1) {
      await expect(fileLabels.nth(index)).toHaveText(files[index]);
      await expect(rankLabels.nth(index)).toHaveText(ranks[index]);
      const fileBox = await fileLabels.nth(index).boundingBox();
      const rankBox = await rankLabels.nth(index).boundingBox();
      expect(fileBox).not.toBeNull();
      expect(rankBox).not.toBeNull();
      const fileCenter = fileBox!.x + fileBox!.width / 2;
      const rankCenter = rankBox!.y + rankBox!.height / 2;
      const expectedFileCenter = board.x + (board.width * (index + 0.5)) / 8;
      const expectedRankCenter = board.y + (board.height * (index + 0.5)) / 8;
      expect(Math.abs(fileCenter - expectedFileCenter)).toBeLessThan(2);
      expect(Math.abs(rankCenter - expectedRankCenter)).toBeLessThan(2);
      expect(fileBox!.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
      expect(rankBox!.x + rankBox!.width).toBeLessThanOrEqual(board.x + 1);
    }
  };

  await assertCoordinates(
    ["a", "b", "c", "d", "e", "f", "g", "h"],
    ["8", "7", "6", "5", "4", "3", "2", "1"]
  );
  await page.getByRole("button", { name: "Girar tablero", exact: true }).click();
  await assertCoordinates(
    ["h", "g", "f", "e", "d", "c", "b", "a"],
    ["1", "2", "3", "4", "5", "6", "7", "8"]
  );
  await page.locator(".app-shell").evaluate((element) => element.setAttribute("data-theme", "dark"));
  await assertCoordinates(
    ["h", "g", "f", "e", "d", "c", "b", "a"],
    ["1", "2", "3", "4", "5", "6", "7", "8"]
  );
  await expect(page.locator(".board-coordinate-files span").first()).toHaveCSS("color", "rgb(33, 30, 25)");
});

test("binds the automatic evaluation to the visible FEN after the bot replies", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop engine coverage");
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));

  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator(".evaluation-bar")).toHaveAttribute("data-evaluation-status", "ready", {
    timeout: 25_000
  });
  const evaluationFen = await page.locator(".evaluation-bar").getAttribute("data-evaluation-fen");
  const visibleFen = await page.locator(".quiet-board-shell").getAttribute("data-fen");
  expect(evaluationFen).toBe(visibleFen);

  await page.getByRole("button", { name: "Sin ayuda", exact: true }).click();
  await expect(page.locator(".evaluation-bar")).toHaveAttribute("data-evaluation-status", "ready", {
    timeout: 25_000
  });
  await expect(page.locator(".locked-card")).toContainText(/disponible cuando termine|available when the game ends/);
});

test("uses the provider only after an explicit teacher question", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  let teacherRequests = 0;
  await page.route("**/api/teacher/respond", async (route) => {
    teacherRequests += 1;
    await route.fulfill({ json: { summary: "No debería solicitarse.", sources: [] } });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));
  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });
  await page.locator(".moves-strip button").first().click();
  await expect(page.locator(".evaluation-bar")).toHaveAttribute("data-evaluation-status", "ready", {
    timeout: 25_000
  });
  expect(teacherRequests).toBe(0);
});

test("shows three local Stockfish lines without calling the teacher API", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop engine variation coverage");
  let teacherRequests = 0;
  await page.route("**/api/teacher/config", async (route) => {
    await route.fulfill({ json: { configured: { openai: false, gemini: true } } });
  });
  await page.route("**/api/teacher/respond", async (route) => {
    teacherRequests += 1;
    await route.fulfill({ json: { summary: "Unexpected", sources: [] } });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ language: "es", aiProvider: "gemini", aiModel: "gemini-3.5-flash" })
    );
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: /El profesor|The teacher/ })).toHaveCount(0);
  const rows = page.locator(".engine-variations li");
  await expect(rows).toHaveCount(3);
  await expect.poll(async () => rows.first().innerText(), { timeout: 60_000 }).toMatch(/\w/);
  await expect(rows.first()).not.toContainText(/[—…]/);
  expect(teacherRequests).toBe(0);
});

test("keeps independent paged teacher exchanges and renders Markdown", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop teacher history coverage");
  const sentRequests: any[] = [];
  await page.route("**/api/teacher/config", async (route) => {
    await route.fulfill({ json: { configured: { openai: false, gemini: true } } });
  });
  await page.route("**/api/teacher/respond", async (route) => {
    const body = await route.request().postDataJSON();
    sentRequests.push(body.request);
    const question = String(body.request.question);
    const summary = question.includes("Primera")
      ? "**Caballo activo**\n\n- Controla e5\n- Prepara el enroque"
      : question.includes("Segunda")
        ? "Respuesta de la segunda pregunta."
        : "Respuesta de la tercera pregunta.";
    await route.fulfill({ json: { summary, sources: [] } });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ language: "es", aiProvider: "gemini", aiModel: "gemini-3.5-flash" })
    );
  });
  await page.goto("/");

  const textarea = page.getByPlaceholder(/Escribe tu pregunta/);
  const ask = page.getByRole("button", { name: "Preguntar", exact: true });
  const engineRows = page.locator(".engine-variations li");
  await expect(engineRows).toHaveCount(3);
  await expect(page.getByRole("heading", { name: /El profesor|The teacher/ })).toHaveCount(0);
  const engineRowBoxes = await engineRows.evaluateAll((rows) =>
    rows.map((row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, fontSize: getComputedStyle(row).fontSize };
    })
  );
  expect(engineRowBoxes).toHaveLength(3);
  expect(engineRowBoxes[0].top).toBeLessThan(engineRowBoxes[1].top);
  expect(engineRowBoxes[1].top).toBeLessThan(engineRowBoxes[2].top);
  expect(engineRowBoxes.every(({ fontSize }) => Number.parseFloat(fontSize) <= 10)).toBe(true);
  expect(await textarea.getAttribute("rows")).toBe("2");
  await expect(ask).toHaveText("");

  const composerBox = await page.locator(".question-box").boundingBox();
  const sendBox = await ask.boundingBox();
  if (!composerBox || !sendBox) throw new Error("Teacher composer is not visible");
  expect(sendBox.x).toBeGreaterThan(composerBox.x);
  expect(sendBox.y).toBeGreaterThan(composerBox.y);
  expect(sendBox.x + sendBox.width).toBeLessThanOrEqual(composerBox.x + composerBox.width);
  expect(sendBox.y + sendBox.height).toBeLessThanOrEqual(composerBox.y + composerBox.height);

  await textarea.fill("Primera pregunta");
  await ask.click();
  await expect(textarea).toHaveValue("");
  await expect(page.locator(".teacher-question p")).toHaveText("Primera pregunta");
  await expect(page.locator(".teacher-answer strong")).toHaveText("Caballo activo", {
    timeout: 25_000
  });
  await expect(page.locator(".teacher-answer li")).toHaveCount(2);
  await expect(page.locator(".teacher-answer")).not.toContainText("**");

  await textarea.fill("Segunda pregunta");
  await ask.click();
  await expect(textarea).toHaveValue("");
  await expect(page.locator(".teacher-question p")).toHaveText("Segunda pregunta");
  await expect(page.getByText("Respuesta de la segunda pregunta.")).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText("2/2")).toBeVisible();

  await page.getByRole("button", { name: "Pregunta anterior", exact: true }).click();
  await expect(page.locator(".teacher-question p")).toHaveText("Primera pregunta");
  await expect(page.getByText("1/2")).toBeVisible();

  await textarea.fill("Tercera pregunta");
  await ask.click();
  await expect(textarea).toHaveValue("");
  await expect(page.locator(".teacher-question p")).toHaveText("Tercera pregunta");
  await expect(page.getByText("3/3")).toBeVisible();
  await expect(page.getByText("Respuesta de la tercera pregunta.")).toBeVisible({ timeout: 25_000 });

  await page.getByRole("button", { name: "Pregunta anterior", exact: true }).click();
  await expect(page.locator(".teacher-question p")).toHaveText("Segunda pregunta");
  await page.getByRole("button", { name: "Pregunta siguiente", exact: true }).click();
  await expect(page.locator(".teacher-question p")).toHaveText("Tercera pregunta");

  expect(sentRequests.map((request) => request.question)).toEqual([
    "Primera pregunta",
    "Segunda pregunta",
    "Tercera pregunta"
  ]);
  expect(JSON.stringify(sentRequests[1])).not.toContain("Primera pregunta");
  expect(JSON.stringify(sentRequests[2])).not.toContain("Segunda pregunta");
});

test("recovers hidden player classifications locally without calling the teacher", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop engine interaction coverage");
  let teacherRequests = 0;
  await page.route("**/api/teacher/respond", async (route) => {
    teacherRequests += 1;
    await route.fulfill({ json: { summary: "Unexpected", sources: [] } });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ language: "es", showMoveClassifications: false })
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));
  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });
  await expect(page.locator(".move-classification-badge")).toHaveCount(0);

  await page.getByRole("button", { name: /Preferencias|Preferences/ }).click();
  await page.getByRole("switch", { name: /Mostrar clasif|Show move classifications/ }).click();
  const badge = page.locator(".move-classification-badge");
  await expect(badge).toBeVisible({ timeout: 60_000 });
  await expect(badge).toHaveAttribute("data-square", "e4");
  await expect(badge).toHaveAttribute("data-classification", /book|best|excellent|good|great|brilliant/);
  expect(teacherRequests).toBe(0);
});

test("shows an immediate player classification in no-help mode", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop engine interaction coverage");
  await page.goto("/");
  await page.getByRole("button", { name: "Sin ayuda", exact: true }).click();
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));
  await expect(page.locator(".move-classification-badge")).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".move-classification-badge")).toHaveAttribute("data-square", "e4");
});

test("uses one full-width history below the board and teacher", async ({ page }, testInfo) => {
  await page.goto("/");
  const boardColumn = await page.locator(".board-column").boundingBox();
  const teacher = await page.locator(".teacher-column").boundingBox();
  const history = await page.locator(".history-panel").boundingBox();
  const board = await page.locator(".quiet-board").boundingBox();
  if (!boardColumn || !teacher || !history || !board) throw new Error("Layout is incomplete");

  if (testInfo.project.name === "chromium-desktop") {
    expect(Math.abs(history.x - boardColumn.x)).toBeLessThan(2);
    expect(Math.abs(history.x + history.width - (teacher.x + teacher.width))).toBeLessThan(2);
    expect(history.y).toBeGreaterThan(boardColumn.y + boardColumn.height);
    expect(board.width).toBeGreaterThan(390);
    await expect(page.locator(".opponent-row")).toHaveCount(0);
    await expect(page.locator(".player-row")).toHaveCount(0);
  } else {
    expect(history.y).toBeGreaterThan(boardColumn.y + boardColumn.height);
    expect(teacher.y).toBeGreaterThan(history.y + history.height);
  }
});

test("keeps accepting player moves after every bot reply", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const playSquare = async (file: number, rankFromTop: number) => {
    const box = await board.boundingBox();
    if (!box) throw new Error("Board is not visible");
    await page.mouse.click(
      box.x + box.width * ((file + 0.5) / 8),
      box.y + box.height * ((rankFromTop + 0.5) / 8)
    );
  };

  await playSquare(4, 6); // e2
  await playSquare(4, 4); // e4
  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });

  await playSquare(6, 7); // g1
  await playSquare(5, 5); // f3
  await expect(page.locator(".moves-strip button")).toHaveCount(4, { timeout: 20_000 });
});

test("navigates with arrow keys and replaces the future from a valid player turn", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop keyboard interaction coverage");
  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ language: "es", allowHistoricalBranching: true })
    );
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const playSquare = async (file: number, rankFromTop: number) => {
    const box = await board.boundingBox();
    if (!box) throw new Error("Board is not visible");
    await page.mouse.click(
      box.x + box.width * ((file + 0.5) / 8),
      box.y + box.height * ((rankFromTop + 0.5) / 8)
    );
  };

  await playSquare(4, 6); // e2
  await playSquare(4, 4); // e4
  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });
  await playSquare(6, 7); // g1
  await playSquare(5, 5); // f3
  await expect(page.locator(".moves-strip button")).toHaveCount(4, { timeout: 20_000 });

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".history-controls span")).toHaveText("3/4");
  await playSquare(1, 7); // b1; historical position is the opponent's turn, so this must do nothing
  await playSquare(2, 5); // c3
  await expect(page.locator(".history-controls span")).toHaveText("3/4");

  await page.keyboard.press("ArrowLeft");
  await expect(page.locator(".history-controls span")).toHaveText("2/4");
  await playSquare(1, 7); // b1
  await playSquare(2, 5); // c3
  await expect(page.locator(".moves-strip button")).toHaveCount(4, { timeout: 20_000 });
  await expect(page.locator(".moves-strip button").nth(2)).toContainText("Nc3");
  await expect(page.locator(".moves-strip")).not.toContainText("Nf3");
});

test("keeps completed teacher exchanges when a real move is made", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  let teacherRequests = 0;
  await page.route("**/api/teacher/config", async (route) => {
    await route.fulfill({ json: { configured: { openai: false, gemini: true } } });
  });
  await page.route("**/api/teacher/respond", async (route) => {
    teacherRequests += 1;
    await route.fulfill({ json: { summary: "Explicación visible.", sources: [] } });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      "quietmove:preferences",
      JSON.stringify({ language: "es", aiProvider: "gemini", aiModel: "gemini-3.5-flash" })
    );
  });
  await page.goto("/");

  const textarea = page.getByPlaceholder(/Escribe tu pregunta/);
  await textarea.fill("¿Qué debería intentar aquí?");
  await page.getByRole("button", { name: "Preguntar", exact: true }).click();
  await expect(page.getByText("Explicación visible.")).toBeVisible({ timeout: 25_000 });
  expect(teacherRequests).toBe(1);

  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();
  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));

  await expect(textarea).toHaveValue("");
  await expect(page.locator(".teacher-question p")).toHaveText("¿Qué debería intentar aquí?");
  await expect(page.getByText("Explicación visible.")).toBeVisible();
});

test("plays one subtle sound for each completed move", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  await page.addInitScript(() => {
    const soundWindow = window as Window & { __quietMovePlayedSounds: string[] };
    soundWindow.__quietMovePlayedSounds = [];
    HTMLMediaElement.prototype.play = function () {
      soundWindow.__quietMovePlayedSounds.push(this.getAttribute("src") ?? "");
      return Promise.resolve();
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();

  const board = page.locator(".quiet-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("Board is not visible");
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (6.5 / 8));
  await page.mouse.click(box.x + box.width * (4.5 / 8), box.y + box.height * (4.5 / 8));

  await expect(page.locator(".moves-strip button")).toHaveCount(2, { timeout: 20_000 });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { __quietMovePlayedSounds: string[] })
            .__quietMovePlayedSounds
      )
    )
    .toEqual([
      "/sounds/piece-move-dry.mp3",
      "/sounds/piece-move-dry.mp3"
    ]);
});

test("keeps accepting repeated moves when the player chooses black", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "Desktop interaction coverage");
  await page.goto("/");
  await page.getByRole("button", { name: "Girar tablero", exact: true }).click();
  await page.getByRole("button", { name: "Comenzar partida", exact: true }).click();
  await expect(page.locator(".moves-strip button")).toHaveCount(1, { timeout: 20_000 });

  const board = page.locator(".quiet-board");
  const playSquare = async (fileFromLeft: number, rankFromTop: number) => {
    const box = await board.boundingBox();
    if (!box) throw new Error("Board is not visible");
    await page.mouse.click(
      box.x + box.width * ((fileFromLeft + 0.5) / 8),
      box.y + box.height * ((rankFromTop + 0.5) / 8)
    );
  };

  await playSquare(1, 6); // g7 from Black's orientation
  await playSquare(1, 5); // g6
  await expect(page.locator(".moves-strip button")).toHaveCount(3, { timeout: 20_000 });

  await playSquare(1, 7); // g8
  await playSquare(2, 5); // f6
  await expect(page.locator(".moves-strip button")).toHaveCount(5, { timeout: 20_000 });
});
