// Opens the demo build with the Content-Security-Policy that albireo sends with its pages
// (server/security-headers.ts), and fails when the browser blocks anything. The demo is the
// browser app of albireo with sample data, so a change that adds an inline script, a call
// to eval, or a load from another site fails here, before the demo goes out. The demo reads
// its sample files from its own origin, as albireo serves the files of the bucket from its
// own origin. The Pages workflow runs this after
// scripts/demo-media.ts, with Playwright and its Chromium in a folder of their own:
//   node scripts/demo-csp.ts <folder of the demo build> <folder of the tools> <base path of the demo>

import { createReadStream, readdirSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { extname, join, resolve, sep } from "node:path";
import { createLibrary, type DemoVideo } from "../src/demo/data.ts";
import { ATTACHMENT_FILES } from "../src/demo/media.ts";
import { previewKindOf } from "../src/lib/attachments.ts";
import { pageHeaders } from "../server/security-headers.ts";

// The parts of Playwright that this script uses. Playwright is no dependency of albireo,
// so its own types are not at hand.
interface Locator {
  click(): Promise<void>;
  count(): Promise<number>;
  first(): Locator;
  nth(index: number): Locator;
  setInputFiles(path: string): Promise<void>;
  waitFor(options?: { state: "attached" | "visible" | "hidden" }): Promise<void>;
}

interface Page {
  goto(url: string): Promise<unknown>;
  getByRole(role: string, options?: { name: string | RegExp; exact?: boolean; level?: number }): Locator;
  locator(selector: string): Locator;
  keyboard: { press(key: string): Promise<void>; type(text: string): Promise<void> };
  waitForLoadState(state: "networkidle"): Promise<void>;
  waitForTimeout(milliseconds: number): Promise<void>;
  on(event: "console", listener: (message: { text(): string }) => void): void;
}

interface Browser {
  newContext(options: { viewport: { width: number; height: number } }): Promise<{
    addInitScript(script: string): Promise<void>;
    newPage(): Promise<Page>;
  }>;
  close(): Promise<void>;
}

interface Playwright {
  chromium: { launch(): Promise<Browser> };
}

const QUERY = "design";

/** The attachments of a video that albireo previews, by the names of their files. */
function previewable(video: DemoVideo): string[] {
  return video.attachments.map(({ file }) => ATTACHMENT_FILES[file].fileName).filter((name) => previewKindOf(name) !== null);
}

// Every document of the page reports what the policy blocks to the console, where this
// script reads it. The listener comes before any script of the document runs.
const REPORT = "Content-Security-Policy blocked ";
const WATCH = `document.addEventListener("securitypolicyviolation", (event) => {
  console.error(${JSON.stringify(REPORT)} + JSON.stringify({
    directive: event.effectiveDirective,
    blocked: event.blockedURI,
    source: event.sourceFile,
    line: event.lineNumber,
    sample: event.sample,
  }));
}, true);`;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".csv": "text/csv",
  ".md": "text/markdown",
  ".woff2": "font/woff2",
};

/**
 * Serves the demo under its base path, as GitHub Pages does. Only the page carries the
 * policy, as albireo sends it with its pages: the script of a Web Worker, such as the one
 * that reads slides, runs under no policy of its own.
 */
function serve(site: string, base: string, policy: string): Promise<Server> {
  const root = resolve(site);
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    if (!path.startsWith(base)) {
      response.writeHead(404).end();
      return;
    }
    let file = resolve(root, path.slice(base.length));
    if (file !== root && !file.startsWith(root + sep)) {
      response.writeHead(404).end();
      return;
    }
    let size = statSync(file, { throwIfNoEntry: false });
    // The paths of the app are no files: GitHub Pages answers them with the page of the app.
    if (size === undefined || size.isDirectory()) {
      if (extname(file) !== "") {
        response.writeHead(404).end();
        return;
      }
      file = join(root, "index.html");
      size = statSync(file);
    }
    if (extname(file) === ".html") response.setHeader("Content-Security-Policy", policy);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Length": size.size,
    });
    createReadStream(file).pipe(response);
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function main(site: string, toolsFolder: string, base: string): Promise<void> {
  const policy = pageHeaders()["Content-Security-Policy"] ?? "";
  console.log(`Content-Security-Policy: ${policy}`);
  const server = await serve(site, base, policy);
  const { port } = server.address() as AddressInfo;
  const home = `http://127.0.0.1:${port}${base}`;

  const tools = createRequire(join(toolsFolder, "package.json"));
  const { chromium } = tools("playwright") as Playwright;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(WATCH);
  const page = await context.newPage();

  let step = "Opening the demo";
  const blocked: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (text.startsWith(REPORT)) blocked.push(`${step}: ${text.slice(REPORT.length)}`);
  });
  // Lets the requests of a step end, and the previews draw what they read.
  const settle = async () => {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1500);
  };
  const run = async (name: string, action: () => Promise<void>) => {
    step = name;
    console.log(name);
    await action();
    await settle();
  };

  try {
    await run("Home", async () => {
      await page.goto(home);
      await page.getByRole("heading", { name: "Home", level: 1 }).waitFor();
    });
    await run("All videos", async () => {
      await page.goto(`${home}videos`);
      await page.getByRole("heading", { level: 1, name: /./ }).waitFor();
    });
    // The video of the demo with the most attachments that albireo previews, so that each
    // kind of preview opens: PDF, slides, pictures, CSV, Markdown, JSON, and code.
    const video = createLibrary(new Date()).videos.reduce((most, next) => (previewable(next).length > previewable(most).length ? next : most));
    const files = previewable(video);
    await run(`The video "${video.title}"`, async () => {
      await page.goto(`${home}videos/${video.id}`);
      await page.getByRole("heading", { name: video.title, level: 1 }).waitFor();
      await page.locator("video").first().waitFor({ state: "attached" });
    });
    console.log(`Attachments to preview: ${files.join(", ")}`);
    const previews = page.getByRole("button", { name: "Preview", exact: true });
    const count = await previews.count();
    if (count !== files.length) {
      throw new Error(`The video shows ${count} attachment(s) to preview, not the ${files.length} of the demo data: ${files.join(", ")}.`);
    }
    for (let index = 0; index < count; index += 1) {
      await run(`The preview of attachment ${index + 1} of ${count}`, async () => {
        await previews.nth(index).click();
        await page.getByRole("dialog").waitFor();
      });
      await page.keyboard.press("Escape");
      await page.getByRole("dialog").waitFor({ state: "hidden" });
    }
    await run(`A search for "${QUERY}"`, async () => {
      await page.getByRole("textbox", { name: "Search", exact: true }).click();
      await page.keyboard.type(QUERY);
      await page.keyboard.press("Enter");
      await page.getByRole("heading", { name: new RegExp(QUERY), level: 1 }).waitFor();
    });
    // The demo keeps no files, so an upload stops after the browser reads the video,
    // which it does from a blob: URL.
    await run("Choosing a video on the upload page", async () => {
      await page.goto(`${home}upload`);
      await page.locator('input[type="file"][accept="video/*"]').first().setInputFiles(firstFile(join(site, "media", "videos"), ".mp4"));
      await page.waitForTimeout(3000);
    });
    await run("History", async () => {
      await page.goto(`${home}history`);
      await page.getByRole("heading", { level: 1, name: /./ }).waitFor();
    });
    await run("Account", async () => {
      await page.goto(`${home}settings/account`);
      await page.getByRole("heading", { level: 1, name: /./ }).waitFor();
    });
    // Cropping shows the chosen picture from a blob: URL.
    await run("Choosing a picture for the channel", async () => {
      await page.goto(`${home}settings/channel`);
      await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(firstFile(join(site, "media", "people"), ".jpg"));
      await page.getByRole("dialog").waitFor();
    });
  } finally {
    await browser.close();
    server.close();
    // What the policy blocked shows even when a step could not finish.
    if (blocked.length > 0) {
      console.error(`The Content-Security-Policy blocked ${blocked.length} request(s):`);
      for (const line of blocked) console.error(`- ${line}`);
      process.exitCode = 1;
    }
  }
  if (blocked.length === 0) console.log("The Content-Security-Policy blocked nothing.");
}

/** The path of the first file of a folder with the extension, in the order of their names. */
function firstFile(folder: string, extension: string): string {
  const name = readdirSync(folder).sort().find((file) => file.endsWith(extension));
  if (name === undefined) throw new Error(`${folder} has no ${extension} file.`);
  return join(folder, name);
}

const [site, toolsFolder, base] = process.argv.slice(2);
if (site === undefined || toolsFolder === undefined || base === undefined || !base.startsWith("/") || !base.endsWith("/")) {
  console.error("Usage: node scripts/demo-csp.ts <folder of the demo build> <folder of the tools> </base path of the demo/>");
  process.exit(1);
}
await main(site, toolsFolder, base);
