import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import path from "node:path";
const root = path.resolve("..");
function addEvidence(board: string, text: string) {
  execFileSync(
    path.join(root, ".venv/bin/python"),
    [
      "-c",
      "import json,sys; from boardscope.logs import store; b,t=json.load(sys.stdin); store.add(b,None,'uart',t)",
    ],
    {
      cwd: path.join(root, "backend"),
      env: {
        ...process.env,
        BOARDSCOPE_DATA: path.join(root, "frontend/.browser-runtime"),
      },
      input: JSON.stringify([board, text]),
    },
  );
}
test("authenticated offline overview workflows and responsive layout", async ({
  page,
  context,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.setViewportSize({ width: 1586, height: 992 });
  await page.goto("/");
  await expect(page.getByText("Your lab, locally.")).toBeVisible();
  expect((await page.request.get("/api/logs")).status()).toBe(401);
  await page
    .getByLabel("Local password", { exact: true })
    .fill("browser-local-password");
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await expect(page.getByText("Bring your first board online")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Local AI not configured" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overview-desktop.png",
    fullPage: true,
  });
  for (const name of ["Boards", "Tests", "Results", "Assistant", "Settings"]) {
    await page
      .locator("nav")
      .getByRole("button", { name, exact: true })
      .click();
    await expect(
      page.getByText(
        `Detailed ${name.toLowerCase()} functionality is planned.`,
      ),
    ).toBeVisible();
  }
  await page
    .locator("nav")
    .getByRole("button", { name: "Overview", exact: true })
    .click();
  await page.getByRole("button", { name: "Add your first board" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Board name", { exact: true }).fill("Board-01 — Lab");
  await dialog
    .getByRole("button", { name: "Add connection", exact: true })
    .click();
  await dialog.getByRole("button", { name: "SSH Linux remote shell" }).click();
  await dialog.getByLabel("Hostname or IP").fill("127.0.0.1");
  await dialog.getByLabel("Port", { exact: true }).fill("1");
  await dialog.getByLabel("Username", { exact: true }).fill("tester");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("browser-fixture-secret");
  await dialog
    .getByRole("button", { name: "Verify connections", exact: true })
    .click();
  await expect(dialog.getByText("disconnected", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Add Board", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Board-01 — Lab", exact: true }),
  ).toBeVisible();
  const auth = await (await page.request.get("/api/auth-status")).json();
  const headers = { "x-csrf-token": auth.csrf };
  let state = await (await page.request.get("/api/state")).json();
  const board = state.boards[0];
  expect(JSON.stringify(state)).not.toContain("browser-fixture-secret");
  await page.getByRole("article", { name: "Select Board-01 — Lab" }).click();
  addEvidence(board.id, "first original UART line\n");
  await expect(
    page.getByRole("log").getByText("first original UART line"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  addEvidence(board.id, "second captured while paused\n");
  await page.waitForTimeout(650);
  await expect(
    page.getByRole("log").getByText("second captured while paused"),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(
    page.getByRole("log").getByText("second captured while paused"),
  ).toBeVisible();
  await page.getByLabel("Search captured output").fill("second");
  await expect(
    page.getByRole("log").getByText("first original UART line"),
  ).not.toBeVisible();
  await page.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Copied", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Search captured output").fill("");
  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export", exact: true }).click();
  expect((await download).suggestedFilename()).toBe(
    "boardscope-evidence.jsonl",
  );
  await page.getByRole("button", { name: "Manage suites" }).click();
  await page.getByLabel("Suite name").fill("Smoke plan");
  await page.getByRole("button", { name: "Save suite" }).click();
  await expect(
    page.getByText("Suite saved. You can assign it in Board settings."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Actions for Board-01 — Lab" })
    .click();
  await page
    .getByRole("menuitem", { name: "Board settings", exact: true })
    .click();
  await page
    .getByLabel("default suite", { exact: false })
    .selectOption({ label: "Smoke plan" });
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("button", { name: "Run Test", exact: true }).click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Every inventory command exits zero.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Start test", exact: true }).click();
  await expect(
    page.getByText("infrastructure error", { exact: true }).first(),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "View history", exact: false })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByRole("link", { name: "Report", exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page
    .getByRole("button", { name: "Actions for Board-01 — Lab" })
    .click();
  await page.getByRole("menuitem", { name: "Start configured suite" }).click();
  await expect(
    page.getByRole("dialog").getByText("Stage 1 · inventory"),
  ).toBeVisible();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm suite" }).click();
  await expect(
    page.getByText("Smoke plan", { exact: true }).first(),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("tab", { name: "logs", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Live Logs" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "assistant", exact: true }).click();
  await expect(page.getByLabel("Ask local AI")).toBeVisible();
  await page.getByRole("tab", { name: "workspace", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Boards (1)" })).toBeVisible();
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test("selected active run stays fixed across updates and navigation (explicit UI fixtures)", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByLabel("Local password", { exact: true })
    .fill("browser-local-password");
  await page.getByRole("button", { name: "Unlock workspace" }).click();
  await expect(
    page.getByRole("heading", { name: "Board-01 — Lab", exact: true }),
  ).toBeVisible();
  const state = await (await page.request.get("/api/state")).json();
  const board = state.boards[0];
  const python = path.join(root, ".venv/bin/python");
  const env = {
    ...process.env,
    BOARDSCOPE_DATA: path.join(root, "frontend/.browser-runtime"),
  };
  execFileSync(
    python,
    [
      "-c",
      `import json,sys,time
from boardscope import db
from boardscope.logs import store
board=sys.stdin.read()
with db.connect() as d:
 for n in ('A','B'):
  data={'name':'Browser fixture '+n,'step':'Fixture display state','transport':'SSH','started':time.time(),'timeout':300,'plan':[],'settings':{}}
  d.execute('INSERT INTO runs VALUES(?,?,?,?,?,?)',('ui-fixture-'+n,board,'running',time.time(),None,json.dumps(data)))
for n in ('A','B'):store.add(board,'ui-fixture-'+n,'stdout','Unique fixture evidence '+n+'\\n')
`,
    ],
    { cwd: path.join(root, "backend"), env, input: board.id },
  );
  try {
    const selector = page.getByLabel("Selected test for Board-01 — Lab");
    await expect(
      selector.getByRole("option", { name: "Browser fixture A · running" }),
    ).toHaveCount(1);
    await selector.selectOption("ui-fixture-A");
    await expect(
      page.getByRole("log").getByText("Unique fixture evidence A"),
    ).toBeVisible();
    await selector.selectOption("ui-fixture-B");
    await expect(
      page.getByRole("log").getByText("Unique fixture evidence B"),
    ).toBeVisible();
    await expect(
      page.getByRole("log").getByText("Unique fixture evidence A"),
    ).not.toBeVisible();
    await page.waitForTimeout(2300);
    await expect(selector).toHaveValue("ui-fixture-B");
    await page
      .locator("nav")
      .getByRole("button", { name: "Tests", exact: true })
      .click();
    await page
      .locator("nav")
      .getByRole("button", { name: "Overview", exact: true })
      .click();
    await expect(selector).toHaveValue("ui-fixture-B");
    const after = await (await page.request.get("/api/state")).json();
    expect(
      after.active.filter(
        (r: { id: string; state: string }) =>
          r.id.startsWith("ui-fixture-") && r.state === "running",
      ),
    ).toHaveLength(2);
  } finally {
    execFileSync(
      python,
      [
        "-c",
        "from boardscope import db;\nwith db.connect() as d:d.execute(\"DELETE FROM runs WHERE id LIKE 'ui-fixture-%'\")",
      ],
      { cwd: path.join(root, "backend"), env },
    );
  }
});
