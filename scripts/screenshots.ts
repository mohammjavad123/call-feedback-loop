// Renders the demo dashboard in headless Chrome and saves the README screenshots to docs/.
//   npm run demo && npm run screenshots
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PAGE = pathToFileURL(join(process.cwd(), "dist/demo/dashboard.html")).href;
const OUT = join(process.cwd(), "docs");
const png = (f: string) => join(OUT, f) as `${string}.png`;
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--hide-scrollbars"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(PAGE, { waitUntil: "networkidle0" });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
await wait(1800);

const shot = async (selector: string, file: string) => {
	const el = await page.$(selector);
	if (!el) throw new Error(`missing ${selector}`);
	await el.scrollIntoView();
	await wait(700);
	await el.screenshot({ path: png(file) });
	console.log(`docs/${file}`);
};

await page.screenshot({ path: png("hero.png") });
console.log("docs/hero.png");
await shot(".mapcard", "map.png");
await shot("#headlines", "headlines.png");
await shot("#tree", "clusters.png");
await shot("#board", "themes.png");

await page.click('#mapmode button[data-v="problem"]');
await wait(900);
await shot(".mapcard", "map-struggle.png");
await page.click('#mapmode button[data-v="all"]');
await wait(600);

await page.evaluate(() => (document.querySelector(".tcard") as HTMLElement).click());
await wait(900);
await page.screenshot({ path: png("theme-detail.png") });
console.log("docs/theme-detail.png");

await browser.close();
