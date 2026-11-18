import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const org = "10000000-0000-4000-8000-000000000001";
const mailpit = process.env.MAILPIT_URL || "http://localhost:8025";
const screenshots = path.resolve(process.cwd(), "../../docs/screenshots");
async function message(page: Page, email: string, subject: string) {
  let id = "";
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${mailpit}/api/v1/messages?limit=100`,
        );
        const data = await response.json();
        const m = data.messages?.find(
          (m: { ID: string; Subject: string; To: { Address: string }[] }) =>
            m.Subject === subject && m.To.some((t) => t.Address === email),
        );
        id = m?.ID || "";
        return id;
      },
      { timeout: 45000 },
    )
    .not.toBe("");
  return (
    await (await page.request.get(`${mailpit}/api/v1/message/${id}`)).json()
  ).Text as string;
}
async function signIn(page: Page, name: string) {
  const email = `${name}@demo.waitlistfair.test`;
  await page.goto("/login");
  await page.getByLabel("Email address", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send sign-in link" }).click();
  await expect(
    page.getByRole("heading", { name: "Check your inbox" }),
  ).toBeVisible();
  const body = await message(page, email, "Your WaitlistFair sign-in link");
  const link = body.match(/http[^\s]+\/auth\/verify#token=[a-f0-9]+/)?.[0];
  expect(link).toBeTruthy();
  await page.goto(link!);
  await page.getByRole("button", { name: "Continue to WaitlistFair" }).click();
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}
async function mutate(
  page: Page,
  route: string,
  body?: unknown,
  method = "POST",
) {
  return page.evaluate(
    async ({ route, body, method }) => {
      const me = await (await fetch("/api/me")).json();
      const r = await fetch(`/api${route}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": me.user.csrf,
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: r.status, body: await r.json() };
    },
    { route, body, method },
  );
}
function compose(...args: string[]) {
  execFileSync("docker", ["compose", ...args], {
    cwd: path.resolve(process.cwd(), "../.."),
    stdio: "pipe",
    timeout: 90000,
  });
}
test("real email sign-in, waitlist, cancellation, safe acceptance, audit, expiry and recovery", async ({
  browser,
  page: admin,
}) => {
  await mkdir(screenshots, { recursive: true });
  const errors: string[] = [];
  admin.on("pageerror", (e) => errors.push(e.message));
  await admin.goto("/login");
  await admin.screenshot({
    path: path.join(screenshots, "sign-in.png"),
    fullPage: true,
  });
  await signIn(admin, "admin");
  await admin.screenshot({
    path: path.join(screenshots, "admin-overview.png"),
    fullPage: true,
  });
  const studentContext = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const student = await studentContext.newPage();
  await signIn(student, "maya");
  await student.goto("/app/waitlist");
  await student.getByRole("button", { name: "Join a waitlist" }).click();
  await student
    .getByLabel("What would you like help with?")
    .selectOption({ label: "Physics" });
  await student
    .getByRole("dialog")
    .getByRole("button", { name: "Join waitlist", exact: true })
    .click();
  await expect(student.getByRole("status")).toContainText("on the waitlist");
  await expect(
    student.getByRole("row").filter({ hasText: "Physics" }),
  ).toBeVisible();
  await admin.goto("/app/calendar");
  const calculus = admin
    .locator("article")
    .filter({
      has: admin.getByRole("heading", { name: "Calculus I", exact: true }),
    })
    .filter({
      has: admin.getByRole("button", { name: "Cancel booking", exact: true }),
    });
  await calculus
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await admin.getByRole("button", { name: "Confirm cancellation" }).click();
  await expect(admin.getByRole("status")).toContainText("Booking canceled");
  await message(
    admin,
    "maya@demo.waitlistfair.test",
    "A tutoring appointment is waiting for you",
  );
  await student.goto("/app/offers");
  await expect(
    student.getByRole("heading", { name: "Calculus I", exact: true }),
  ).toBeVisible();
  await student.screenshot({
    path: path.join(screenshots, "student-offer.png"),
    fullPage: true,
  });
  await student
    .getByRole("button", { name: "Accept appointment", exact: true })
    .click();
  await expect(student.getByRole("status")).toContainText("You’re booked");
  await student.goto("/app/appointments");
  await expect(
    student.getByRole("cell", { name: "confirmed", exact: true }),
  ).toBeVisible();
  await student.goto("/app");
  await student.screenshot({
    path: path.join(screenshots, "student-home.png"),
    fullPage: true,
  });
  await student.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      student
        .locator(".sidebar")
        .evaluate((el) => Math.round(el.getBoundingClientRect().right)),
    )
    .toBe(0);
  await student.getByRole("button", { name: "Open navigation" }).click();
  await expect(
    student.getByRole("dialog", { name: "Workspace navigation" }),
  ).toBeVisible();
  await student.keyboard.press("Escape");
  await expect(
    student.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
  await expect
    .poll(() =>
      student
        .locator(".sidebar")
        .evaluate((el) => Math.round(el.getBoundingClientRect().right)),
    )
    .toBe(0);
  await student.screenshot({
    path: path.join(screenshots, "student-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await admin.goto("/app/history");
  await admin.getByRole("button").filter({ hasText: "3 evaluated" }).click();
  await expect(admin.getByRole("dialog")).toContainText(
    "1 — earliest eligible",
  );
  await expect(admin.getByRole("dialog")).toContainText("unavailable");
  await admin.screenshot({
    path: path.join(screenshots, "allocation-explanation.png"),
    fullPage: true,
  });
  await admin.getByLabel("Close dialog").click();
  await admin.getByRole("button", { name: "Audit trail", exact: true }).click();
  await expect(
    admin.getByRole("cell", { name: "Offer Accepted", exact: true }),
  ).toBeVisible();
  await admin.goto("/app/calendar");
  await admin.getByRole("button", { name: "Create availability" }).click();
  await admin
    .getByLabel("Subject", { exact: true })
    .selectOption("30000000-0000-4000-8000-000000000002");
  await admin
    .getByLabel("Tutor", { exact: true })
    .selectOption("40000000-0000-4000-8000-000000000002");
  await admin
    .getByLabel("Start date and time")
    .fill(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16));
  await admin
    .getByRole("button", { name: "Create appointment", exact: true })
    .click();
  await expect(admin.getByRole("status")).toContainText("Availability added");
  // The following controls operate only on the seeded, explicitly marked demo center.
  const added = await mutate(admin, `/orgs/${org}/members`, {
    email: "ava@demo.waitlistfair.test",
    display_name: "Ava · Demo student",
    role: "student",
  });
  expect(added.status).toBe(201);
  const avaContext = await browser.newContext();
  const ava = await avaContext.newPage();
  await signIn(ava, "ava");
  expect(
    (
      await mutate(ava, `/orgs/${org}/waitlist`, {
        service_id: "30000000-0000-4000-8000-000000000001",
        preferences: {
          timezone: "UTC",
          windows: Array.from({ length: 7 }, (_, day) => ({
            day,
            start: "00:00",
            end: "23:59",
          })),
        },
      })
    ).status,
  ).toBe(201);
  const samContext = await browser.newContext();
  const sam = await samContext.newPage();
  await signIn(sam, "sam");
  const secondSlot = "50000000-0000-4000-8000-000000000004";
  const secondBooking = await mutate(
    sam,
    `/orgs/${org}/slots/${secondSlot}/book`,
  );
  expect(secondBooking.status).toBe(201);
  if (process.env.FAULT_TESTS === "1") compose("stop", "worker");
  expect(
    (
      await mutate(admin, `/orgs/${org}/slots/${secondSlot}/cancel`, {
        booking_id: secondBooking.body.id,
      })
    ).status,
  ).toBe(200);
  if (process.env.FAULT_TESTS === "1") {
    compose("restart", "db");
    compose("up", "-d", "--wait", "worker");
    await expect
      .poll(
        async () => {
          try {
            return (
              await admin.request.get("http://localhost:8080/healthz")
            ).status();
          } catch {
            return 0;
          }
        },
        { timeout: 45000 },
      )
      .toBe(200);
  }
  await message(
    admin,
    "leo@demo.waitlistfair.test",
    "A tutoring appointment is waiting for you",
  );
  const leoContext = await browser.newContext();
  const leo = await leoContext.newPage();
  await signIn(leo, "leo");
  const leoDashboard = await leo.evaluate(
    async (org) => await (await fetch(`/api/orgs/${org}/dashboard`)).json(),
    org,
  );
  const oldOffer = leoDashboard.offers.find(
    (o: { state: string }) => o.state === "pending",
  );
  expect(oldOffer).toBeTruthy();
  if (process.env.FAULT_TESTS === "1")
    compose("exec", "-T", "api", "/app/manage", "expire-demo");
  else {
    test.info().annotations.push({
      type: "note",
      description:
        "Set FAULT_TESTS=1 to exercise Docker restart and forced demo expiration.",
    });
  }
  if (process.env.FAULT_TESTS === "1") {
    await message(
      admin,
      "ava@demo.waitlistfair.test",
      "A tutoring appointment is waiting for you",
    );
    const replay = await mutate(
      leo,
      `/orgs/${org}/offers/${oldOffer.id}/accept`,
    );
    expect(replay.status).toBe(409);
    await ava.goto("/app/offers");
    await expect(
      ava.getByRole("button", { name: "Accept appointment" }),
    ).toBeVisible();
    await ava.getByRole("button", { name: "Accept appointment" }).click();
    await expect(ava.getByRole("status")).toContainText("You’re booked");
  }
  expect(errors).toEqual([]);
  await Promise.all([
    studentContext.close(),
    samContext.close(),
    avaContext.close(),
    leoContext.close(),
  ]);
});
