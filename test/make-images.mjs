// Renders the demo page's sample images (a chart, a map and an advert) to
// test/img/ with headless Chrome. Run once; the PNGs are committed.
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), "img");
const bar = (x, h, color, label) => `<rect x="${x}" y="${260 - h}" width="46" height="${h}" fill="${color}"/><text x="${x + 23}" y="${252 - h}" text-anchor="middle">${label}</text>`;
const group = (x, a, b, name) => bar(x, a * 2, "#8aa", a) + bar(x + 50, b * 2, "#d63", b) + `<text x="${x + 48}" y="282" text-anchor="middle">${name}</text>`;

const images = {
  "cost-chart.png": [560, 320, `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="320" font-family="sans-serif" font-size="13">
    <rect width="560" height="320" fill="#fff"/><text x="20" y="26" font-size="16" font-weight="bold">Estimated cost by component (millions)</text>
    <line x1="40" y1="260" x2="540" y2="260" stroke="#333"/>
    ${group(70, 88, 97, "Track and civil works")}${group(240, 19, 41, "Utility relocation")}${group(400, 44, 46, "Vehicles and depot")}
    <rect x="400" y="40" width="12" height="12" fill="#8aa"/><text x="418" y="51">2023 estimate</text>
    <rect x="400" y="60" width="12" height="12" fill="#d63"/><text x="418" y="71">2025 estimate</text></svg>`],
  "route-map.png": [560, 220, `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="220" font-family="sans-serif" font-size="13">
    <rect width="560" height="220" fill="#eef3f6"/><path d="M0 170 Q280 120 560 180 V220 H0Z" fill="#bcd7ea"/><text x="24" y="205" fill="#567">Harbour</text>
    <polyline points="50,110 190,80 340,95 500,55" fill="none" stroke="#d63" stroke-width="6"/>
    ${[[50, 110, "Ferry Terminal"], [190, 80, "Quay Street"], [340, 95, "Market Hall"], [500, 55, "Eastside"]].map(([x, y, n]) => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="#333" stroke-width="3"/><text x="${x}" y="${y - 18}" text-anchor="middle">${n}</text>`).join("")}
    <text x="20" y="26" font-size="16" font-weight="bold">Phase 2 route, 6.2 km</text></svg>`],
  "tyres-ad.png": [468, 90, `<svg xmlns="http://www.w3.org/2000/svg" width="468" height="90" font-family="sans-serif">
    <rect width="468" height="90" fill="#fdd"/><circle cx="50" cy="45" r="30" fill="#222"/><circle cx="50" cy="45" r="13" fill="#bbb"/>
    <text x="100" y="54" font-size="24" font-weight="bold" fill="#c33">HOT DEALS ON TYRES</text></svg>`],
};

const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
for (const [name, [width, height, svg]] of Object.entries(images)) {
  await page.setViewport({ width, height });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: path.join(out, name) });
}
await browser.close();
