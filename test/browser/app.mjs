// Uses a running albireo in Google Chrome the way its people do: it creates the first admin
// with the setup code, uploads a clip through the page, plays it and moves in it, comments
// with a time, attaches notes and opens their preview, picks a frame for the thumbnail,
// searches, renames the channel, and changes the password on the account page. It then makes
// an invitation link, which a member opens in a browser of their own to join, logs the member
// out and in again, and looks at a page on a phone. It saves a screenshot of each step, and
// fails on an error in a page, a request that fails, and anything that the
// Content-Security-Policy blocks.
//
// Usage: node app.mjs <albireo URL> <setup code> <clip .mp4> <notes .md> <folder for screenshots>

import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const [base, setupCode, clip, notes, out] = process.argv.slice(2);
if (!base || !setupCode || !clip || !notes || !out) {
  throw new Error("usage: node app.mjs <albireo URL> <setup code> <clip> <notes> <screenshots>");
}
await mkdir(out, { recursive: true });

// What went wrong in any page, reported at the end so that every screenshot is taken.
const problems = [];

// The app asks who is signed in when it opens, which a browser without a session answers with 401.
function isSignedOutCheck(url, status) {
  return status === 401 && url !== "" && new URL(url).pathname === "/api/me";
}

function watch(page) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (message.text().includes("status of 401") && isSignedOutCheck(message.location().url ?? "", 401)) return;
    problems.push(`console error on ${page.url()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`page error on ${page.url()}: ${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !isSignedOutCheck(response.url(), response.status())) {
      problems.push(`${response.status()} for ${response.request().method()} ${response.url()}`);
    }
    // A picture whose URL is wrong can come back as the page of the app, with 200.
    const type = response.headers()["content-type"] ?? "";
    if (response.request().resourceType() === "image" && type.startsWith("text/html")) {
      problems.push(`a page instead of a picture for ${response.url()}`);
    }
  });
  page.on("requestfailed", (request) => {
    // A player cancels the ranges that it no longer needs, and a page its pictures when it goes.
    const reason = request.failure()?.errorText ?? "";
    if (reason !== "net::ERR_ABORTED") problems.push(`${reason} for ${request.method()} ${request.url()}`);
  });
}

async function until(check, what, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

let step = 0;
async function shot(page, name) {
  step += 1;
  const file = `${String(step).padStart(2, "0")}-${name}.png`;
  console.log(`  screenshot ${file}`);
  await page.screenshot({ path: path.join(out, file) });
}

// Waits until the pictures that the page shows have loaded, so that no screenshot catches them empty.
async function imagesLoaded(page) {
  await until(
    () => page.evaluate(() => [...document.images].filter((image) => image.getBoundingClientRect().width > 0).every((image) => image.complete)),
    "the pictures of the page",
  );
}

/** A browser of its own, as a person on another device, which reports what the policy blocks to the console. */
async function newBrowserContext(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error(`Content-Security-Policy blocked ${event.blockedURI} (${event.violatedDirective})`);
    });
  });
  const page = await context.newPage();
  watch(page);
  return page;
}

async function api(page, path) {
  const response = await page.request.get(`${base}${path}`);
  assert.equal(response.status(), 200, `GET ${path} answered ${response.status()}`);
  return response.json();
}

const browser = await chromium.launch({ channel: "chrome" });
try {
  const page = await newBrowserContext(browser);

  console.log("Create the first admin with the setup code");
  await page.goto(base);
  await page.getByRole("heading", { name: "Create the first admin" }).waitFor();
  await page.getByLabel("Setup code").fill(setupCode);
  await page.getByLabel("Email", { exact: true }).fill("alex@example.com");
  await page.getByLabel("Display name").fill("Alex Morgan");
  await page.getByLabel("Password", { exact: true }).fill("correct horse battery");
  await shot(page, "setup");
  await page.getByRole("button", { name: "Create admin" }).click();
  await page.getByText("No videos yet").first().waitFor();
  await shot(page, "empty-library");

  console.log("Upload the clip through the page");
  await page.goto(`${base}/upload`);
  await page.locator('input[type="file"][accept="video/*"]').setInputFiles(clip);
  await page.getByText("Uploaded “Sample clip”").waitFor({ timeout: 120_000 });
  await shot(page, "uploaded");
  const { videos } = await api(page, "/api/videos");
  assert.equal(videos.length, 1);
  const [video] = videos;
  assert.equal(video.title, "Sample clip");
  assert.ok(video.thumbnailUrl, "the upload made no thumbnail");
  assert.ok(Math.abs(video.durationSec - 8) < 0.5, `the clip lasts ${video.durationSec} seconds`);

  console.log("Home shows the clip with its thumbnail");
  await page.goto(base);
  await page.getByText("Sample clip").first().waitFor();
  await imagesLoaded(page);
  const thumbnailWidth = await page.locator(`img[src="${video.thumbnailUrl}"]`).first().evaluate((image) => image.naturalWidth);
  assert.ok(thumbnailWidth > 0, "the thumbnail did not load");
  await shot(page, "home");

  console.log("Play the clip, and move to its end");
  await page.goto(`${base}/videos/${video.id}`);
  const player = page.locator("video").first();
  await player.waitFor();
  await player.evaluate((element) => {
    element.muted = true;
    return element.play();
  });
  await until(async () => (await player.evaluate((element) => element.currentTime)) > 1, "the clip to play");
  await player.evaluate((element) => {
    element.currentTime = 6;
  });
  await until(async () => (await player.evaluate((element) => element.currentTime)) > 6.5, "the clip to play from 0:06");
  await player.evaluate((element) => element.pause());
  await shot(page, "playing");

  console.log("Comment with a time, and play from it");
  await page.getByLabel("Comment", { exact: true }).fill("The pattern at 0:02 is the one to look at.");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const time = page.getByRole("button", { name: "Play from 0:02" });
  await time.waitFor();
  await time.click();
  await until(async () => {
    const current = await player.evaluate((element) => element.currentTime);
    return current >= 2 && current < 4;
  }, "the clip to play from 0:02");
  await player.evaluate((element) => element.pause());
  await shot(page, "comment");

  console.log("Attach the notes, and open their preview");
  await page.locator('input[type="file"]:not([accept])').setInputFiles(notes);
  await page.getByText("Attached notes.md").waitFor();
  await page.getByRole("button", { name: "Preview" }).click();
  await page.getByRole("dialog").getByText("The tone is 440 Hz.").waitFor();
  await shot(page, "attachment-preview");
  await page.keyboard.press("Escape");
  const download = await page.request.get(`${base}${(await api(page, `/api/videos/${video.id}`)).video.attachments[0].downloadUrl}`);
  assert.match(download.headers()["content-disposition"] ?? "", /^attachment; filename="notes\.md"/);

  console.log("Pick a frame for the thumbnail");
  await page.goto(`${base}/videos/${video.id}/edit`);
  await page.getByRole("button", { name: "Choose a frame" }).click();
  const useFrame = page.getByRole("button", { name: "Use this frame" });
  await until(() => useFrame.isEnabled(), "the frame picker to be ready");
  await useFrame.click();
  await page.getByText("Thumbnail changed").waitFor();
  const { video: changed } = await api(page, `/api/videos/${video.id}`);
  assert.notEqual(changed.thumbnailUrl, video.thumbnailUrl);
  await imagesLoaded(page);
  await shot(page, "thumbnail");

  console.log("Search for the clip");
  await page.getByRole("search").locator("input").fill("sample");
  await page.keyboard.press("Enter");
  await page.getByRole("main").getByText("Sample clip").first().waitFor();
  await imagesLoaded(page);
  await shot(page, "search");

  console.log("Rename the channel");
  await page.goto(`${base}/settings/channel`);
  await page.getByLabel("Display name").fill("Alex");
  await page.getByRole("button", { name: "Save" }).click();
  await until(async () => (await api(page, "/api/me")).me.displayName === "Alex", "the new name");
  await shot(page, "channel-settings");

  console.log("Change the password on the account page");
  await page.goto(`${base}/settings/account`);
  await page.getByText("This device").waitFor();
  await page.getByLabel("Current password").fill("correct horse battery");
  await page.getByLabel("New password").fill("a new horse battery");
  await page.getByRole("button", { name: "Change password" }).click();
  await page.getByText("Changed the password.").waitFor();
  await shot(page, "account");

  console.log("Make an invitation link");
  await page.goto(`${base}/settings/people`);
  await page.getByRole("heading", { name: "Invitations" }).waitFor();
  await page.getByRole("button", { name: "Create invitation link" }).click();
  const link = await page.locator("code").filter({ hasText: "/join/" }).first().textContent();
  assert.ok(link?.startsWith(`${base}/join/`), `the invitation link is ${link}`);
  await shot(page, "people");

  console.log("A member joins with the link in a browser of their own");
  const member = await newBrowserContext(browser);
  await member.goto(link);
  await member.getByRole("heading", { name: "Join albireo" }).waitFor();
  await member.getByLabel("Email", { exact: true }).fill("sam@example.com");
  await member.getByLabel("Display name").fill("Sam Lee");
  await member.getByLabel("Password", { exact: true }).fill("a long password");
  await shot(member, "join");
  await member.getByRole("button", { name: "Join" }).click();
  await member.getByText("Sample clip").first().waitFor();
  await imagesLoaded(member);
  await shot(member, "member-home");
  const { video: seen } = await api(member, `/api/videos/${video.id}`);
  assert.equal(seen.canEdit, false, "a member can edit the video of an admin");

  console.log("The member logs out and signs in again");
  await member.getByRole("button", { name: "Account of Sam Lee" }).click();
  await member.getByRole("menuitem", { name: "Log out" }).click();
  await member.getByRole("heading", { name: "Sign in to albireo" }).waitFor();
  await member.getByLabel("Email", { exact: true }).fill("sam@example.com");
  await member.getByLabel("Password", { exact: true }).fill("a long password");
  await shot(member, "sign-in");
  await member.getByRole("button", { name: "Sign in" }).click();
  await member.getByText("Sample clip").first().waitFor();

  console.log("The people page lists the member");
  await page.goto(`${base}/settings/people`);
  await page.getByText("sam@example.com").waitFor();
  await imagesLoaded(page);
  await shot(page, "people-with-member");

  console.log("The video page on a phone");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/videos/${video.id}`);
  await page.locator("video").first().waitFor();
  await page.getByText("notes.md").first().waitFor();
  await shot(page, "phone");
} finally {
  await browser.close();
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  throw new Error(`${problems.length} problem(s) in the pages`);
}
console.log("PASS");
