// Drives the content script in headless Chrome against test/demo.html with a
// stubbed chrome.runtime (no extension install, no API calls) and saves
// screenshots to test/shots/.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./serve.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = path.join(here, "shots");
mkdirSync(shots, { recursive: true });

const server = await serve();
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

await page.evaluateOnNewDocument(() => {
  const DESC = "This is the opening paragraph of a local news article.\n\nIt says the city council approved the second stage of a tram line by 9 votes to 4. The new section is 6.2 km long. It will be paid for in two ways: the city will borrow money by selling bonds, and businesses in the Eastside area will pay a special charge.";
  window.__posted = [];
  const stub = {
    runtime: {
      onMessage: { addListener: (fn) => (window.__toggle = () => fn({ type: "toggle-pick" })) },
      sendMessage: () => {},
      connect: () => {
        const listeners = [];
        let dead = false;
        const emit = (m) => !dead && listeners.forEach((l) => l(m));
        return {
          onMessage: { addListener: (l) => listeners.push(l) },
          onDisconnect: { addListener: () => {} },
          disconnect: () => (dead = true),
          postMessage: (msg) => {
            window.__posted.push(msg);
            const words = DESC.split(/(?<= )/);
            words.forEach((w, i) => setTimeout(() => emit({ type: "delta", text: w }), 150 + i * 12));
            setTimeout(() => emit({ type: "desc-done" }), 200 + words.length * 12);
            const pick = (re, reason) => {
              const c = msg.candidates.find((c) => re.test(c.text));
              return c ? [{ id: c.id, reason }] : [];
            };
            const items = [...pick(/Estimated cost/, "Shows the cost figures behind the plan"), ...pick(/framework agreement caps/, "Explains the spending cap it mentions"), ...pick(/pay the levy/, "Says who pays the business charge")];
            const images = msg.imageCandidates.filter((c) => /route|cost-chart/.test(c.url)).map((c) => ({ id: c.id, reason: "Shows something this block is about" }));
            setTimeout(() => emit({ type: "related", items, images }), 500);
          },
        };
      },
    },
  };
  Object.defineProperty(window, "chrome", { value: stub, configurable: true });
});

await page.goto(server.url);
await page.addScriptTag({ path: path.join(here, "..", "content", "content.js") });

const shadowEval = (fn, ...args) => page.evaluate(fn, ...args);
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) process.exitCode = 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1. Alt+hover shows the outline around the paragraph.
const lede = await page.$("#lede");
const box = await lede.boundingBox();
await page.keyboard.down("Alt");
await page.mouse.move(box.x + 40, box.y + 20);
await sleep(250);
check("outline visible on Alt+hover", await shadowEval(() => document.querySelector("[data-lift-out]").shadowRoot.querySelector(".outline").classList.contains("on")));
await page.screenshot({ path: path.join(shots, "1-hover.png") });

// 2. Alt+click lifts it.
await page.mouse.click(box.x + 40, box.y + 20);
await page.keyboard.up("Alt");
await sleep(200);
await page.screenshot({ path: path.join(shots, "2-lifting.png") });
await sleep(2500);
await page.screenshot({ path: path.join(shots, "3-open.png") });
const state = await shadowEval(() => {
  const s = document.querySelector("[data-lift-out]").shadowRoot;
  return {
    dialog: !!s.querySelector('[role="dialog"]'),
    panelText: s.querySelector(".content").innerText.slice(0, 40),
    desc: s.querySelector(".desc-text").textContent.length,
    busy: s.querySelector("[aria-live]").getAttribute("aria-busy"),
    cards: s.querySelectorAll("button.card:not(.thumb)").length,
    focusInPanel: s.activeElement?.classList.contains("panel"),
    inert: document.body.inert,
    candidates: window.__posted[0].candidates.length,
    hasAd: /TYRES/.test(s.querySelector(".content").innerText),
  };
});
console.log(state);
check("dialog open with clean copy", state.dialog && state.panelText.startsWith("The council voted") && !state.hasAd);
check("description streamed and marked done", state.desc > 100 && state.busy === "false");
check("three related cards", state.cards === 3);
check("focus moved into panel, page inert", state.focusInPanel && state.inert);

// 2b. One click collapses the description to its first sentence; it stays that way.
const descState = () => page.evaluate(() => {
  const s = document.querySelector("[data-lift-out]").shadowRoot;
  return { shown: s.querySelector(".desc-text").innerText.trim(), button: s.querySelector(".toggle").textContent, expanded: s.querySelector(".toggle").getAttribute("aria-expanded") };
});
await page.evaluate(() => document.querySelector("[data-lift-out]").shadowRoot.querySelector(".toggle").click());
let d = await descState();
check("toggle collapses to one sentence", d.shown === "This is the opening paragraph of a local news article." && d.button === "Full description" && d.expanded === "false");
await page.evaluate(() => document.querySelector("[data-lift-out]").shadowRoot.querySelector(".desc-text").click());
d = await descState();
check("clicking the text restores the full description", d.shown.length > 200 && d.button === "One sentence");

// 3. Tab stays inside the dialog.
for (let i = 0; i < 8; i++) await page.keyboard.press("Tab");
check("focus trapped in dialog", await shadowEval(() => !!document.querySelector("[data-lift-out]").shadowRoot.activeElement));

// 4. Clicking a related card swaps it in.
await shadowEval(() => document.querySelector("[data-lift-out]").shadowRoot.querySelector("button.card").click());
await sleep(2500);
await page.screenshot({ path: path.join(shots, "4-swapped.png") });
check("swap shows the cost table", await shadowEval(() => !!document.querySelector("[data-lift-out]").shadowRoot.querySelector(".content table, .content caption")));

// 5. Escape puts it back.
await page.keyboard.press("Escape");
await sleep(800);
check("closed and cleaned up", await shadowEval(() => !document.querySelector("[data-lift-out]").shadowRoot.querySelector(".stage") && !document.body.inert));

// 6. Keyboard pick mode.
await page.evaluate(() => window.__toggle());
await page.keyboard.press("ArrowDown");
await page.keyboard.press("ArrowDown");
await sleep(250);
await page.screenshot({ path: path.join(shots, "5-pick.png") });
await page.keyboard.press("Enter");
await sleep(1200);
check("keyboard pick opens dialog", await shadowEval(() => !!document.querySelector("[data-lift-out]").shadowRoot.querySelector('[role="dialog"]')));
await page.keyboard.press("Escape");
await sleep(800);

// 7. Reduced motion still works.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.keyboard.down("Alt");
await page.mouse.click(box.x + 40, box.y + 20);
await page.keyboard.up("Alt");
await sleep(600);
check("opens under reduced motion", await shadowEval(() => !!document.querySelector("[data-lift-out]").shadowRoot.querySelector('[role="dialog"]')));

await page.keyboard.press("Escape");
await sleep(400);
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);

// 8. Lifting an image: Alt+click the chart.
const root = () => document.querySelector("[data-lift-out]").shadowRoot;
const altClick = async (selector) => {
  const el = await page.$(selector);
  await el.evaluate((n) => n.scrollIntoView({ block: "center" }));
  const b = await el.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.keyboard.up("Alt");
  await sleep(2200);
};
await altClick("#chart img");
await page.screenshot({ path: path.join(shots, "6-image.png") });
const img = await page.evaluate(() => {
  const s = document.querySelector("[data-lift-out]").shadowRoot;
  const msg = window.__posted.at(-1);
  return {
    kind: msg.block.kind,
    sent: msg.block.images.map((i) => i.url),
    caption: msg.block.caption,
    nearby: !!msg.block.nearby.before,
    imageCandidates: msg.imageCandidates.map((c) => c.url.split("/").pop()),
    figureAsText: msg.candidates.some((c) => /four new stops/.test(c.text)),
    panelImg: !!s.querySelector(".content.media img"),
    label: s.querySelector(".desc .label").textContent,
    thumbs: s.querySelectorAll("button.card.thumb").length,
    imagesFirst: s.querySelector(".related-wrap .group .thumbs") !== null,
  };
});
console.log(img);
check("figure lifted as an image with caption and nearby text", img.kind === "image" && /cost-chart/.test(img.sent[0]) && /Cost estimates/.test(img.caption) && img.nearby && img.panelImg && img.label === "What this shows");
check("other images offered as candidates, advert kept out of nav", img.imageCandidates.includes("route-map.png") && !img.imageCandidates.includes("cost-chart.png") && !img.figureAsText);
check("related image thumbnail shown", img.thumbs === 1 && img.imagesFirst);

// 9. Clicking the thumbnail swaps to that image.
await page.evaluate(() => document.querySelector("[data-lift-out]").shadowRoot.querySelector("button.card.thumb").click());
await sleep(2200);
check("thumbnail swap shows the map", await page.evaluate(() => /route-map/.test(document.querySelector("[data-lift-out]").shadowRoot.querySelector(".content img").src)));
await page.keyboard.press("Escape");
await sleep(800);

// 10. Inline SVG chart is snapshotted for the model and the panel.
await altClick("#votes");
await page.screenshot({ path: path.join(shots, "7-svg.png") });
const svg = await page.evaluate(() => {
  const s = document.querySelector("[data-lift-out]").shadowRoot;
  const msg = window.__posted.at(-1);
  return { kind: msg.block.kind, data: (msg.block.images[0]?.dataUrl || "").slice(0, 23), size: (msg.block.images[0]?.dataUrl || "").length, panel: (s.querySelector(".content img")?.src || "").slice(0, 23) };
});
console.log(svg);
check("inline SVG sent and shown as a picture", svg.kind === "image" && svg.data === "data:image/jpeg;base64," && svg.size > 3000 && svg.panel === svg.data);

check("no page errors", errors.length === 0);
if (errors.length) console.log(errors);
await browser.close();
server.close();
