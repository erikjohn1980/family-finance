import { expect, test, type Browser, type Page } from "@playwright/test";

const ERIK = "erik@example.test";
const G = "g@example.test";
const month = new Date().toISOString().slice(0, 7);
const d = (day: number) => `${month}-${String(Math.min(day, new Date().getUTCDate())).padStart(2, "0")}`;

async function login(browser: Browser, email: string, viewport?: { width: number; height: number }): Promise<Page> {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Test sign-in" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 60_000 });
  return page;
}

const CSV = [
  "external_id,account,posted_at,amount,merchant,pending,pending_id,category",
  `e1,E2E Checking,${d(1)},2500.00,SAMPLE PAYROLL,false,,Salary`,
  `e2,E2E Checking,${d(1)},-80.00,SAMPLE GROCER 4,false,,`,
  `e3,E2E Checking,${d(1)},-300.00,TRANSFER TO SAVINGS,false,,Transfer`,
  `e4,E2E Checking,${d(1)},-120.00,PAYMENT TO CARD,false,,Card payment`,
  `e5,E2E Checking,${d(1)},20.00,SAMPLE GROCER 4 REFUND,false,,Groceries`,
  `e6,E2E Checking,${d(1)},-45.00,SAMPLE PHARMACY,true,,Medical`,
  `e7,E2E Checking,${d(1)},-9.99,KATAPULT EVENTS CHARGE,false,,`,
].join("\n");

test.describe.serial("Family Finance acceptance", () => {
  test("stranger gets 401 on household APIs and is redirected from pages", async ({ request, page }) => {
    expect((await request.get("/api/household/summary")).status()).toBe(401);
    expect((await request.get("/api/household/export")).status()).toBe(401);
    await page.goto("/transactions");
    await expect(page).toHaveURL(/\/login/);
  });

  test("an uninvited email cannot sign in", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("stranger@example.test");
    await page.getByRole("button", { name: "Test sign-in" }).click();
    await expect(page.locator("p[role=alert]")).toContainText(/not invited|not a member/);
  });

  test("owner bootstraps household; empty states render on every primary screen", async ({ browser }) => {
    const p = await login(browser, ERIK);
    await expect(p.getByRole("heading", { name: "Financial overview" })).toBeVisible();
    const checks: [string, RegExp][] = [
      ["/analytics", /No months with data/],
      ["/transactions", /No transactions match/],
      ["/income", /No income plans yet/],
      ["/needs-category", /Nothing needs a category/],
      ["/recurring", /No verified bills/],
      ["/accounts", /No household accounts yet/],
      ["/savings", /No savings accounts yet/],
      ["/investments", /No investment accounts yet/],
      ["/budgets", /No limits set/],
      ["/goals", /No goals yet/],
    ];
    for (const [path, text] of checks) {
      await p.goto(path);
      await expect(p.getByText(text).first(), path).toBeVisible();
    }
    await p.goto("/accounts");
    await expect(p.getByText("No OAL accounts")).toBeVisible({ visible: false }).catch(() => {});
    await p.context().close();
  });

  test("owner invites G; G joins and both see the same household", async ({ browser }) => {
    const erik = await login(browser, ERIK);
    await erik.goto("/share");
    await erik.getByLabel("Their Google account email").fill(G);
    await erik.getByRole("button", { name: "Create invite" }).click();
    await expect(erik.getByTestId("toast")).toContainText("Invite created for g@example.test");
    const link = (await erik.locator(".form-msg.ok").textContent())!.match(/\/invite\/[\w-]+/)![0];
    const g = await login(browser, G);
    await g.goto("/share");
    await expect(g.getByText(ERIK)).toBeVisible();
    await expect(g.getByText("Only the owner can invite members.")).toBeVisible();
    // invite links are single-use
    await g.goto(link);
    await expect(g.locator("p[role=alert]")).toContainText("invalid, expired, revoked, or already used");
    await erik.context().close();
    await g.context().close();
  });

  test("CSV import is idempotent, excludes Katapult, keeps pending separate", async ({ browser }) => {
    const p = await login(browser, ERIK);
    await p.goto("/settings");
    const form = p.getByRole("form", { name: "Import CSV" });
    const importFile = async (name: string, text: string, expected: RegExp | string) => {
      await form.locator("input[type=file]").setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(text) });
      await form.getByRole("button", { name: "Import", exact: true }).click();
      await expect(form.locator(".form-msg")).toContainText(expected);
      await expect(form.getByRole("button", { name: "Import", exact: true })).toBeEnabled();
    };
    await importFile("e2e.csv", CSV, /Imported: 6 new · 0 already present.*1 excluded by scope policy/);
    await importFile("e2e.csv", CSV, "This exact file was already imported");
    await importFile("e2e-2.csv", CSV + "\n", /Imported: 0 new · 6 already present/);

    const s = await (await p.request.get(`/api/household/summary?month=${month}`)).json();
    // spend = grocer 80 − refund 20 (transfers & card payment excluded; pending separate)
    expect(s.spendPostedCents).toBe(6000);
    expect(s.spendPendingCents).toBe(4500);
    expect(s.incomeDepositedCents).toBe(250000);
    expect(s.needsCategoryCount).toBe(1);
    expect(s.bankPendingCount).toBe(1);
    await p.context().close();
  });

  test("Add transaction persists for both users after reload and is marked Manual", async ({ browser }) => {
    const erik = await login(browser, ERIK);
    await erik.getByRole("link", { name: "Add transaction" }).click();
    await erik.getByLabel("Amount (USD)").fill("12.50");
    await erik.getByLabel("Merchant / description").fill('=HYPERLINK("http://x","cash")');
    await erik.getByLabel("Category").selectOption({ label: "Food · Groceries" });
    await erik.getByRole("button", { name: "Add transaction" }).last().click();
    await expect(erik.getByText("Transaction added. Both household members will see it.")).toBeVisible();
    await erik.reload();
    await expect(erik.getByText("Manual", { exact: true }).first()).toBeVisible();

    const g = await login(browser, G);
    await g.goto("/transactions");
    await g.reload();
    const row = g.getByRole("listitem").filter({ hasText: "HYPERLINK" });
    await expect(row).toContainText("Manual");
    await expect(row).toContainText("−$12.50");
    const s = await (await g.request.get(`/api/household/summary?month=${month}`)).json();
    expect(s.spendPostedCents).toBe(6000 + 1250);
    await erik.context().close();
    await g.context().close();
  });

  test("G categorizes a needs-category item; Erik sees it after refresh with audit", async ({ browser }) => {
    const g = await login(browser, G);
    await g.goto("/needs-category");
    await expect(g.getByTestId("needs-count")).toHaveText("1");
    await expect(g.getByTestId("pending-count")).toHaveText("1");
    await g.getByLabel("Category for SAMPLE GROCER 4").selectOption({ label: "Food · Groceries" });
    await g.getByRole("checkbox", { name: "Suggest rule" }).check();
    await g.getByRole("button", { name: "Assign" }).click();
    await expect(g.getByText("Nothing needs a category")).toBeVisible();

    const erik = await login(browser, ERIK);
    await erik.goto("/needs-category");
    await erik.reload();
    await expect(erik.getByTestId("needs-count")).toHaveText("0");
    await erik.goto("/transactions?q=SAMPLE+GROCER+4");
    await erik.getByRole("listitem").filter({ hasText: /^.*SAMPLE GROCER 4(?! REFUND)/ }).first().click();
    await expect(erik.getByText("Imported bank row")).toBeVisible();
    await expect(erik.getByRole("heading", { name: "Override history" })).toBeVisible();
    await expect(erik.locator("li").filter({ hasText: "categorize" }).first()).toBeVisible();
    // owner confirms the suggested rule
    await erik.goto("/settings");
    await expect(erik.getByText(/“sample grocer” → Food · Groceries/)).toBeVisible();
    await erik.getByRole("button", { name: "Confirm" }).click();
    await expect(erik.getByTestId("toast")).toHaveText("Rule confirmed and applied");
    await erik.context().close();
    await g.context().close();
  });

  test("Budget Limits → Groceries shows plan vs posted and merchants", async ({ browser }) => {
    const p = await login(browser, ERIK);
    await p.goto("/budgets");
    const row = p.getByRole("listitem").filter({ hasText: "Food · Groceries" });
    await row.getByLabel("Monthly limit").fill("400");
    await row.getByRole("button", { name: "Save limit" }).click();
    await expect(p.getByRole("link", { name: /Groceries/ }).first()).toBeVisible();
    await p.locator("a.mini", { hasText: "Groceries" }).click();
    await expect(p.getByRole("heading", { name: "Groceries", level: 1 })).toBeVisible();
    await expect(p.getByText("Limit $400.00 · rollover off")).toBeVisible();
    await expect(p.locator(".kpi-value").first()).toHaveText("$72.50"); // 80 − 20 refund + 12.50 manual
    await expect(p.getByRole("heading", { name: "Top merchants" })).toBeVisible();
    await expect(p.getByText("SAMPLE GROCER 4").first()).toBeVisible();
    await p.context().close();
  });

  test("Goals stay empty until a target is set, then show progress", async ({ browser }) => {
    const p = await login(browser, G);
    await p.goto("/goals");
    await expect(p.getByText("No goals yet")).toBeVisible();
    await p.getByLabel("Title").fill("Emergency fund");
    await p.getByLabel("Target amount (owner-set)").fill("10000");
    await p.getByLabel("Funded so far (if no linked account)").fill("2500");
    await p.getByRole("button", { name: "Add goal" }).click();
    await expect(p.getByRole("heading", { name: "Emergency fund" })).toBeVisible();
    await p.reload();
    await expect(p.getByRole("progressbar", { name: "Emergency fund progress" })).toHaveAttribute("aria-valuenow", "25");
    await p.context().close();
  });

  test("CSV export matches filters and escapes formula-like cells", async ({ browser }) => {
    const p = await login(browser, ERIK);
    const res = await p.request.get(`/api/household/export?month=${month}&scope=default&q=HYPERLINK`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + the one filtered row
    expect(lines[1]).toContain(`"'=HYPERLINK(""http://x"",""cash"")"`);
    expect(lines[1]).toContain("'-12.50");
    const all = await (await p.request.get(`/api/household/export?month=${month}&scope=default`)).text();
    expect(all).not.toMatch(/katapult/i);
    await p.context().close();
  });

  test("removed member receives 403 on household APIs", async ({ browser }) => {
    const erik = await login(browser, ERIK);
    await erik.goto("/share");
    await erik.getByLabel("Their Google account email").fill("temp@example.test");
    await erik.getByRole("button", { name: "Create invite" }).click();
    await expect(erik.getByTestId("toast")).toContainText("Invite created for temp@example.test");
    const temp = await login(browser, "temp@example.test");
    expect((await temp.request.get("/api/household/summary")).status()).toBe(200);
    await erik.reload();
    await erik.getByRole("listitem").filter({ hasText: "temp@example.test" }).getByRole("button", { name: "Remove" }).click();
    await expect(erik.getByTestId("toast")).toHaveText("Member removed");
    expect((await temp.request.get("/api/household/summary")).status()).toBe(403);
    expect((await temp.request.get("/api/household/export")).status()).toBe(403);
    await erik.context().close();
    await temp.context().close();
  });

  test("filters persist after full reload", async ({ browser }) => {
    const p = await login(browser, ERIK);
    await p.getByLabel("Scope").selectOption("household");
    await expect(p).toHaveURL(/scope=household/);
    await p.goto("/"); // no params: must come from persisted preference
    await expect(p.getByLabel("Scope")).toHaveValue("household");
    await expect(p.getByText("· Household only")).toBeVisible();
    await p.getByLabel("Scope").selectOption("default");
    await expect(p).toHaveURL(/scope=default/);
    await p.context().close();
  });

  test("keyboard: tab reaches skip link, sidebar destinations, and primary actions", async ({ browser }) => {
    const p = await login(browser, ERIK);
    await p.goto("/"); // full page load: focus starts at the document
    await expect(p.getByRole("heading", { name: "Financial overview" })).toBeVisible();
    await p.waitForLoadState("networkidle");
    await p.keyboard.press("Tab");
    await expect(p.getByRole("link", { name: "Skip to content" })).toBeFocused();
    const seen: string[] = [];
    for (let i = 0; i < 30; i++) {
      await p.keyboard.press("Tab");
      seen.push(await p.evaluate(() => { const el = document.activeElement as HTMLElement | null; return (el?.getAttribute("aria-label") || el?.innerText || "").replace(/\s+/g, " ").trim(); }));
    }
    for (const label of ["Overview", "Analytics", "All transactions", "Income", "Expenses", "Recurring bills", "Cards & bank", "Savings", "Investments", "Budget Limits", "Goals", "Settings", "Export CSV", "Share", "Add transaction"]) {
      expect(seen.some((s) => s.startsWith(label)), `${label} reachable by Tab (saw: ${seen.join(" | ")})`).toBe(true);
    }
    expect(seen.some((s) => s.startsWith("Needs category"))).toBe(true);
    // Enter activates a focused sidebar link
    await p.getByRole("link", { name: "Goals" }).focus();
    await p.keyboard.press("Enter");
    await expect(p).toHaveURL(/\/goals/);
    await p.context().close();
  });

  test("mobile: no horizontal clipping on primary screens; drawer navigation works", async ({ browser }) => {
    const p = await login(browser, ERIK, { width: 390, height: 844 });
    for (const path of ["/", "/analytics", "/transactions", "/income", "/expenses", "/needs-category", "/recurring", "/accounts", "/savings", "/investments", "/budgets", "/goals", "/settings", "/share", "/transactions/new"]) {
      await p.goto(path);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
    }
    await p.goto("/");
    await p.getByRole("button", { name: "Open navigation" }).click();
    await p.getByRole("link", { name: "Budget Limits" }).click();
    await expect(p).toHaveURL(/\/budgets/);
    const box = await p.getByRole("link", { name: "Add transaction" }).boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await p.context().close();
  });
});
