#!/usr/bin/env node
import { existsSync } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultOutDir = resolve(repoRoot, "artifacts/terrain-qa");

const captures = [
  {
    name: "mountain-low-pass",
    camera: [-980, 440, -1220],
    target: [-420, 240, -240],
    note: "near terrain stability, slopes, ridge silhouette"
  },
  {
    name: "continental-horizon",
    camera: [420, 1500, -3350],
    target: [-180, 260, -120],
    note: "large landmass scale, far terrain, fog, horizon"
  },
  {
    name: "coast-and-water",
    camera: [-2750, 760, -480],
    target: [-1180, 110, 80],
    note: "coastline shape, water edge, shore foam"
  },
  {
    name: "lake-valley",
    camera: [920, 1080, -1680],
    target: [520, 80, -780],
    note: "inland water basin, valley readability"
  },
  {
    name: "snow-range",
    camera: [-1420, 1320, 480],
    target: [-640, 560, -180],
    note: "snow cap masks, mountain range profile"
  },
  {
    name: "sky-horizon",
    camera: [0, 1850, -3600],
    target: [0, 1500, 1200],
    note: "sky gradient, clouds, atmospheric perspective"
  },
  {
    name: "sky-zenith",
    camera: [120, 1820, -400],
    target: [180, 4200, 120],
    note: "upper sky gradient, cloud ceiling, skybox clipping"
  },
  {
    name: "cloud-layer-up",
    camera: [-840, 920, -900],
    target: [-1600, 1620, -1200],
    note: "cloud scale and skybox stability looking upward"
  },
  {
    name: "vertical-coastline",
    camera: [-1850, 2200, 620],
    target: [-1850, 0, 620],
    note: "map layout from above, water/land distribution"
  }
];

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(repoRoot, args.out ?? args.outDir ?? defaultOutDir);
const baseUrl = normalizeBaseUrl(args.url ?? args.baseUrl ?? args["base-url"] ?? "http://localhost:3000/");
const width = parsePositiveInt(args.width, 1600);
const height = parsePositiveInt(args.height, 900);
const settleMs = parsePositiveInt(args.settleMs ?? args["settle-ms"] ?? args.settle, 3000);
const overlay = args.overlay !== "0" && args.hideOverlay !== "1" && args["hide-overlay"] !== "1";
const selectedView = args.view;
const selectedCaptures = selectedView ? captures.filter((capture) => capture.name === selectedView) : captures;

if (selectedCaptures.length === 0) {
  throw new Error(`Unknown terrain QA view "${selectedView}". Known views: ${captures.map((capture) => capture.name).join(", ")}`);
}

const chromePath = findChrome();
const chromeWindow = measureChromeWindowSize(chromePath, width, height);
let devServer;

await mkdir(outDir, { recursive: true });
await rm(resolve(outDir, "chrome-profile"), { recursive: true, force: true });

if (!(await isReachable(baseUrl))) {
  devServer = await startDevServer(baseUrl);
  await delay(1800);
}

const manifest = {
  capturedAt: new Date().toISOString(),
  baseUrl,
  width,
  height,
  settleMs,
  overlay,
  captures: []
};

try {
  for (const [index, capture] of selectedCaptures.entries()) {
    const url = qaUrl(baseUrl, capture, overlay, width, height);
    const filename = `${String(index + 1).padStart(2, "0")}-${capture.name}.png`;
    const output = resolve(outDir, filename);
    await runChromeScreenshot(url, output, chromeWindow.width, chromeWindow.height, settleMs, chromePath, outDir);
    manifest.captures.push({ ...capture, url, filename, output });
    console.log(`Captured ${capture.name}: ${output}`);
  }

  const manifestPath = resolve(outDir, "manifest.json");
  const galleryPath = resolve(outDir, "index.html");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(galleryPath, createGalleryHtml(manifest));
  console.log(`Terrain QA captures written to ${outDir}`);
  console.log(`Gallery: ${galleryPath}`);
  console.log(`Manifest: ${manifestPath}`);
} finally {
  if (devServer) {
    devServer.kill("SIGTERM");
  }
}

function qaUrl(baseUrl, capture, overlay, width, height) {
  const url = new URL(baseUrl);
  url.searchParams.set("terrainQa", "1");
  url.searchParams.set("qaName", capture.name);
  url.searchParams.set("camera", capture.camera.join(","));
  url.searchParams.set("target", capture.target.join(","));
  url.searchParams.set("overlay", overlay ? "1" : "0");
  url.searchParams.set("captureWidth", String(width));
  url.searchParams.set("captureHeight", String(height));
  return url.toString();
}

async function runChromeScreenshot(url, output, width, height, settleMs, chromePath, outDir) {
  await rm(output, { force: true });

  const chromeArgs = [
    "--headless=new",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-extensions",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--force-device-scale-factor=1",
    `--user-data-dir=${resolve(outDir, "chrome-profile")}`,
    `--window-size=${width},${height}`,
    `--virtual-time-budget=${settleMs}`,
    `--screenshot=${output}`,
    url
  ];

  if (process.platform === "linux") {
    chromeArgs.unshift("--no-sandbox");
  }

  const result = spawnSync(chromePath, chromeArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    timeout: settleMs + 4500,
    killSignal: "SIGTERM"
  });

  const screenshot = await getFileStat(output);
  const timedOutAfterCapture = result.error?.code === "ETIMEDOUT" && screenshot && screenshot.size > 0;

  if (!screenshot || screenshot.size <= 0) {
    throw new Error(`Chrome did not write screenshot ${output}\n${result.stderr}`);
  }

  if (result.error && !timedOutAfterCapture) {
    throw result.error;
  }

  if (result.status !== 0 && !timedOutAfterCapture) {
    throw new Error(`Chrome exited with ${result.status}\n${result.stderr}`);
  }
}

async function startDevServer(baseUrl) {
  console.log(`No server reachable at ${baseUrl}; starting npm run dev for capture.`);
  const server = spawn("npm", ["run", "dev"], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let recentOutput = "";
  const appendOutput = (chunk) => {
    recentOutput = `${recentOutput}${chunk.toString()}`.slice(-4000);
  };
  server.stdout.on("data", appendOutput);
  server.stderr.on("data", appendOutput);

  try {
    await waitForReachable(baseUrl, 20_000, () => recentOutput);
    return server;
  } catch (error) {
    server.kill("SIGTERM");
    throw error;
  }
}

async function waitForReachable(url, timeoutMs, getRecentOutput) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isReachable(url)) {
      return;
    }
    await delay(250);
  }

  throw new Error(`Timed out waiting for ${url}\n${getRecentOutput()}`);
}

async function isReachable(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function getFileStat(path) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("Could not find Chrome. Set CHROME_BIN=/path/to/chrome and rerun npm run terrain:qa.");
}

function measureChromeWindowSize(chromePath, requestedWidth, requestedHeight) {
  const result = spawnSync(
    chromePath,
    [
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      `--window-size=${requestedWidth},${requestedHeight}`,
      "--dump-dom",
      "data:text/html,<script>document.write(window.innerWidth+'x'+window.innerHeight)</script>"
    ],
    { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5000 }
  );
  const match = result.stdout.match(/(\d+)x(\d+)/);
  if (!match) {
    return { width: requestedWidth, height: requestedHeight };
  }

  const actualWidth = Number(match[1]);
  const actualHeight = Number(match[2]);
  return {
    width: requestedWidth + Math.max(0, requestedWidth - actualWidth),
    height: requestedHeight + Math.max(0, requestedHeight - actualHeight)
  };
}

function createGalleryHtml(manifest) {
  const cards = manifest.captures
    .map(
      (capture) => `
        <article>
          <img src="${escapeHtml(capture.filename)}" alt="${escapeHtml(capture.name)}">
          <h2>${escapeHtml(capture.name)}</h2>
          <p>${escapeHtml(capture.note)}</p>
          <code>camera ${escapeHtml(capture.camera.join(","))} / target ${escapeHtml(capture.target.join(","))}</code>
        </article>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Afterburn Terrain QA</title>
  <style>
    body { margin: 0; padding: 24px; color: #e8f7ff; background: #07111f; font-family: system-ui, sans-serif; }
    header { display: flex; justify-content: space-between; gap: 16px; align-items: end; margin: 0 0 24px; }
    h1 { margin: 0; font-size: 24px; }
    small { color: #9ec3d5; }
    main { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 18px; }
    article { overflow: hidden; border: 1px solid rgb(139 233 255 / 18%); border-radius: 8px; background: #0d2034; }
    img { display: block; width: 100%; background: #000; }
    h2 { margin: 14px 16px 4px; font-size: 17px; }
    p, code { display: block; margin: 0 16px 14px; color: #a7cddd; }
    code { overflow-wrap: anywhere; font-size: 12px; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Afterburn Terrain QA</h1>
      <small>${escapeHtml(manifest.capturedAt)} / ${manifest.width}x${manifest.height} / settle ${manifest.settleMs}ms</small>
    </div>
    <small>${manifest.captures.length} views</small>
  </header>
  <main>${cards}</main>
</body>
</html>
`;
}

function normalizeBaseUrl(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function parsePositiveInt(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : fallback;
}

function delay(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function parseArgs(argv) {
  const parsed = {};
  const booleanArgs = new Set(["hideOverlay", "hide-overlay"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=");
    if (inlineValue !== undefined) {
      parsed[key] = inlineValue;
      continue;
    }

    if (booleanArgs.has(key) || argv[i + 1]?.startsWith("--") || argv[i + 1] === undefined) {
      parsed[key] = "1";
    } else {
      parsed[key] = argv[i + 1];
      i += 1;
    }
  }
  return parsed;
}
