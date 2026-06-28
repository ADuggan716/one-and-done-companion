#!/usr/bin/env node
/**
 * refresh_cookie.mjs
 *
 * Uses Playwright to log into Splash Sports headlessly and save a fresh
 * session cookie to config/runyourpool.cookie.
 *
 * Run this whenever the cookie expires:
 *   npm run refresh:cookie
 *
 * Credentials are read from .env in the project root:
 *   SPLASH_EMAIL=your@email.com
 *   SPLASH_PASSWORD=yourpassword
 *
 * You can also pass them as environment variables directly:
 *   SPLASH_EMAIL=... SPLASH_PASSWORD=... npm run refresh:cookie
 */

import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

// Minimal .env loader — no external dependency needed
async function loadEnv() {
  const envPath = path.join(root, ".env");
  try {
    const text = await fs.readFile(envPath, "utf8");
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // No .env file — rely on environment variables already in the shell
  }
}

async function main() {
  await loadEnv();

  const email = process.env.SPLASH_EMAIL;
  const password = process.env.SPLASH_PASSWORD;

  if (!email || !password) {
    console.error(
      "Error: SPLASH_EMAIL and SPLASH_PASSWORD must be set.\n" +
      "Copy .env.example to .env and fill in your credentials."
    );
    process.exit(1);
  }

  // On the Raspberry Pi (ARM), use the system Chromium installed via apt
  // rather than Playwright's bundled one (which is x86-only).
  // Set CHROMIUM_PATH=/usr/bin/chromium-browser in your .env on the Pi.
  const executablePath = process.env.CHROMIUM_PATH || undefined;

  console.log("Launching browser...");
  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",                // required for headless on Pi (no GPU)
      "--disable-dev-shm-usage",      // Pi has tiny /dev/shm (64MB) — use /tmp instead
      "--disable-software-rasterizer",
      "--single-process",             // reduces memory pressure on Pi
    ],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
      "AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();

  try {
    console.log("Navigating to Splash Sports login page...");
    await page.goto("https://sm.app.splashsports.com/sign-in", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // Wait for any input to appear (SPA may render after domcontentloaded)
    await page.waitForSelector("input", { timeout: 30000 });

    // Small pause to let the SPA fully render all fields
    await page.waitForTimeout(2000);

    // Try to find the email field — SPAs sometimes use generic input[type="text"]
    const emailSelector =
      'input[type="email"], input[name="email"], input[type="text"], input[placeholder*="email" i]';
    await page.fill(emailSelector, email);

    // Fill password field
    await page.fill('input[type="password"]', password);

    // Submit the form
    await page.click('button[type="submit"], input[type="submit"]');

    // Wait until we're no longer on the sign-in page
    await page.waitForURL((url) => !url.href.includes("/sign-in"), {
      timeout: 20000,
    });

    console.log("Login successful.");

    // Collect all cookies for the Splash Sports domain
    const cookies = await context.cookies("https://sm.app.splashsports.com");

    if (cookies.length === 0) {
      throw new Error(
        "No cookies found after login — login may have failed silently."
      );
    }

    // Format as a standard Cookie header value
    const cookieString = cookies
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");

    const cookiePath = path.join(root, "config/runyourpool.cookie");
    await fs.writeFile(cookiePath, cookieString, "utf8");

    console.log(
      `Cookie refreshed. Wrote ${cookies.length} cookies to config/runyourpool.cookie`
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("refresh_cookie failed:", err.message);
  process.exit(1);
});
