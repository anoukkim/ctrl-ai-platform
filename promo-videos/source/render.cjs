// Render one promo video: step engine.html through every frame in headless
// Chrome and pipe the frames, with the music, into ffmpeg.
//
//   node render.cjs <site-url> <style-id> <out.mp4> <audio.wav>
//   node render.cjs <site-url> <style-id> --stills <dir> 1.5 7 12.2 ...
//
// <site-url> serves engine.html, shots/ and audio/ (python -m http.server).
// Needs Playwright (from the frontend's node_modules, or PLAYWRIGHT) and
// ffmpeg (FFMPEG, default "ffmpeg").
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");

const [site, sid, out, ...rest] = process.argv.slice(2);
const FPS = Number(process.env.FPS || 30);

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--force-color-profile=srgb"] });
  const v = sid.startsWith("03") || sid.startsWith("04");
  const [W, H] = v ? [1080, 1920] : [1920, 1080];
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on("console", (m) => { if (m.type() === "error") console.error("page:", m.text()); });
  // a busy static server can drop an image request now and then: retry
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${site}/engine.html?style=${sid}`);
    await page.waitForFunction(() => window.READY || window.ERROR, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.ERROR);
    if (!err) break;
    if (attempt === 3) throw new Error(err);
  }
  const duration = await page.evaluate(() => window.DURATION);

  if (out === "--stills") {
    const dir = rest[0];
    fs.mkdirSync(dir, { recursive: true });
    for (const t of rest.slice(1).map(Number)) {
      await page.evaluate((x) => window.seek(x), t);
      await page.screenshot({ path: path.join(dir, `${sid}-${t.toFixed(2)}.png`) });
    }
    await browser.close();
    return;
  }

  const audio = rest[0];
  const ff = spawn(process.env.FFMPEG || "ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-",
    "-i", audio,
    "-c:v", "libx264", "-preset", "slow", "-crf", "21", "-maxrate", "3500k", "-bufsize", "7000k",
    // JPEG frames are full-range BT.601; players expect limited-range BT.709
    "-vf", "scale=in_range=pc:in_color_matrix=bt601:out_range=tv:out_color_matrix=bt709,format=yuv420p",
    "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
    "-r", String(FPS),
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
    out,
  ], { stdio: ["pipe", "inherit", "inherit"] });

  const frames = Math.round(duration * FPS);
  const t0 = Date.now();
  for (let i = 0; i < frames; i++) {
    await page.evaluate((x) => window.seek(x), i / FPS);
    const buf = await page.screenshot({ type: "jpeg", quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (i % 150 === 0) console.log(`${sid} ${i}/${frames} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  ff.stdin.end();
  await new Promise((r, j) => ff.on("close", (c) => (c ? j(new Error("ffmpeg " + c)) : r())));
  await browser.close();
  console.log(`${sid} done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${out}`);
})().catch((e) => { console.error(e); process.exit(1); });
