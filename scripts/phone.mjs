// CI check at phone size: no page may slide sideways (only tables scroll, inside their own box).
// Also saves screenshots of one page per screen type (phone + desktop) for review.
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:3000";
const cookie = readFileSync("smoke-demo-cookie.txt", "utf8").trim();
const all = readFileSync("smoke-urls.txt", "utf8").split("\n").filter((u) => u && !u.startsWith("/api/"));
const pub = readFileSync("smoke-public-urls.txt", "utf8").split("\n").filter((u) => u && !u.startsWith("/api/") && !/\.(png|js|html|webmanifest)$/.test(u));

// One page per screen type (ids and query values collapsed), plus every public page.
const key = (u) => u.replace(/\/[a-z0-9]{20,}/gi, "/:id").replace(/=[^&]*/g, "=");
const seen = new Map();
for (const u of all) if (!seen.has(key(u))) seen.set(key(u), u);
const pages = [...seen.values()];

mkdirSync("shots/phone", { recursive: true });
mkdirSync("shots/desktop", { recursive: true });
const name = (u) => (u.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "_").slice(0, 80) || "home");

const browser = await chromium.launch();
const problems = [];
async function run(width, height, list, dir, signedIn, shoot) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, isMobile: width < 600, hasTouch: width < 600 });
  if (signedIn) await ctx.addCookies([{ name: "uc_session", value: cookie, url: BASE }]);
  const page = await ctx.newPage();
  for (const u of list) {
    try {
      const t0 = Date.now();
      await page.goto(BASE + u, { waitUntil: "networkidle", timeout: 30000 });
      const ms = Date.now() - t0;
      // Anything wider than the screen that isn't inside a sideways-scrolling box.
      // Phones zoom out to fit wide pages, so compare against the real screen width, not the zoomed one.
      const bad = await page.evaluate((W) => {
        const out = [];
        // Inside a scrolling box, or inside something fixed to the screen (menus, panels): fine.
        const scrolls = (el) => {
          for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (["auto", "scroll", "hidden", "clip"].includes(s.overflowX) || s.position === "fixed") return true;
          }
          return false;
        };
        for (const el of document.body.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) continue;
          if (r.right > W + 1) {
            const s = getComputedStyle(el);
            if (s.position === "fixed") continue;
            if (scrolls(el)) continue;
            out.push(`${el.tagName.toLowerCase()}.${String(el.className || "").split(" ").slice(0, 4).join(".")} (${Math.round(r.right)}px) "${(el.textContent || "").trim().slice(0, 40)}"`);
          }
        }
        return out.slice(0, 3);
      }, width);
      const pageWide = await page.evaluate((W) => document.documentElement.scrollWidth > W + 1, width);
      if (bad.length || pageWide) problems.push(`${width}px ${u}: ${pageWide ? "PAGE SCROLLS SIDEWAYS; " : ""}${bad.join(" | ")}`);
      if (ms > 4000) problems.push(`${width}px ${u}: slow (${ms} ms)`);
      if (shoot) {
        // First screen (what you see on opening) and one further down, at real size.
        await page.screenshot({ path: `shots/${dir}/${name(u)}.jpg`, type: "jpeg", quality: 60 });
        const h = await page.evaluate(() => document.documentElement.scrollHeight);
        if (h > height * 1.5 && width < 600) {
          await page.evaluate((y) => window.scrollTo(0, y), height);
          await page.screenshot({ path: `shots/${dir}/${name(u)}__2.jpg`, type: "jpeg", quality: 60 });
        }
      }
    } catch (e) {
      problems.push(`${width}px ${u}: ${e.message.split("\n")[0]}`);
    }
  }
  await ctx.close();
}

await run(390, 844, pages, "phone", true, true);
await run(390, 844, pub, "phone", false, true);
const DESKTOP = ["/", "/deals", "/properties", "/buyers", "/dialer", "/closing", "/settings", "/recommendations"].filter((u) => pages.includes(u));
await run(1366, 900, [...DESKTOP, ...pages.filter((u) => /^\/deals\/[^/?]+\?tab=overview/.test(u)).slice(0, 1)], "desktop", true, true);
await browser.close();

writeFileSync("shots/README.txt", `${pages.length} screen types checked at phone size\n\n${problems.join("\n") || "No problems."}\n`);
for (const p of problems) console.log(`::warning title=phone check::${p.slice(0, 400)}`);
console.log(`${pages.length} screen types checked, ${problems.length} problems`);
const sideways = problems.filter((p) => p.includes("PAGE SCROLLS SIDEWAYS") || / \(\d+px\) /.test(p));
if (process.env.PHONE_STRICT === "1" && sideways.length) process.exit(1);
