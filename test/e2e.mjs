// End to end: loads the real unpacked extension in headless Chrome, stores
// ANTHROPIC_API_KEY in its storage, lifts a block on the demo page and waits
// for the live description and related cards.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ext = path.join(here, "..");
const server = await serve();

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, pipe: true, enableExtensions: [ext], args: ["--no-sandbox"] });
try {
  const target = await browser.waitForTarget((t) => t.type() === "service_worker" && t.url().includes("background.js"), { timeout: 15000 });
  const worker = await target.worker();
  await worker.evaluate((apiKey) => chrome.storage.local.set({ apiKey }), process.env.ANTHROPIC_API_KEY);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(server.url);
  await new Promise((r) => setTimeout(r, 500));

  const lift = async (selector, shot) => {
    const el = await page.$(selector);
    await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
    const box = await el.boundingBox();
    await page.keyboard.down("Alt");
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.up("Alt");
    const t0 = Date.now();
    await page.waitForFunction(() => {
      const s = document.querySelector("[data-lift-out]")?.shadowRoot;
      return s?.querySelector("[aria-live]")?.getAttribute("aria-busy") === "false" && !s.querySelector(".card.placeholder");
    }, { timeout: 90000 });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: path.join(here, "shots", shot) });
    console.log(`\n=== ${selector} (${Date.now() - t0} ms)`);
    console.log(await page.evaluate(() => {
      const s = document.querySelector("[data-lift-out]").shadowRoot;
      return {
        desc: s.querySelector("[aria-live]").innerText,
        cards: [...s.querySelectorAll("button.card:not(.thumb) .why")].map((c) => c.textContent),
        images: [...s.querySelectorAll("button.card.thumb")].map((c) => `${c.querySelector("img").src.split("/").pop()}: ${c.textContent}`),
      };
    }));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 900));
  };

  for (const [selector, shot] of [["#lede", "e2e-text.png"], ["#chart img", "e2e-chart.png"], ["#votes", "e2e-svg.png"]]) {
    if (!process.argv[2] || selector.includes(process.argv[2])) await lift(selector, shot);
  }
} finally {
  await browser.close();
  server.close();
}
