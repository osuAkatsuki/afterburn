import { mkdirSync, writeFileSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

type BrowserQaProfile = {
  name: string;
  description: string;
  oneWayLatencyMs: number;
  jitterMs: number;
  packetDropRate: number;
  durationMs: number;
  thresholds: BrowserQaThresholds;
};

type BrowserQaThresholds = {
  maxRttErrorMs: number;
  minSnapshotHz: number;
  maxReceiveAgeMs: number;
  maxCorrectionMeters: number;
};

type CliOptions = {
  baseUrl: string;
  browserExecutable?: string;
  durationMs?: number;
  headed: boolean;
  listProfiles: boolean;
  noStartServer: boolean;
  out?: string;
  profile?: string;
  stdout: boolean;
};

type SocketImpairmentCounters = {
  routed: number;
  pageToServer: number;
  serverToPage: number;
  droppedPageToServer: number;
  droppedServerToPage: number;
  delayedPageToServer: number;
  delayedServerToPage: number;
  maxDelayMs: number;
};

type DebugSample = {
  atMs: number;
  sections: Record<string, Record<string, string>>;
};

type ClientReport = {
  name: string;
  rttMs: number;
  snapshotHz: number;
  receiveAgeMs: number;
  correctionMeters: number;
  jets: number;
  samples: DebugSample[];
  websocket: SocketImpairmentCounters;
};

type ProfileReport = {
  profile: BrowserQaProfile;
  roomId: string;
  passed: boolean;
  failures: string[];
  clients: {
    host: ClientReport;
    guest: ClientReport;
  };
};

type BrowserQaReport = {
  version: 1;
  generatedAt: string;
  baseUrl: string;
  browserExecutable: string;
  profiles: ProfileReport[];
  passed: boolean;
};

const PROFILES: readonly BrowserQaProfile[] = [
  {
    name: "local-control",
    description: "Two local clients without network impairment.",
    oneWayLatencyMs: 0,
    jitterMs: 0,
    packetDropRate: 0,
    durationMs: 6000,
    thresholds: {
      maxRttErrorMs: 60,
      minSnapshotHz: 24,
      maxReceiveAgeMs: 350,
      maxCorrectionMeters: 25
    }
  },
  {
    name: "regional",
    description: "A nearby remote player, roughly 80 ms RTT.",
    oneWayLatencyMs: 40,
    jitterMs: 8,
    packetDropRate: 0,
    durationMs: 7000,
    thresholds: {
      maxRttErrorMs: 90,
      minSnapshotHz: 23,
      maxReceiveAgeMs: 450,
      maxCorrectionMeters: 45
    }
  },
  {
    name: "long-haul",
    description: "A far remote player, roughly 300 ms RTT with moderate jitter.",
    oneWayLatencyMs: 150,
    jitterMs: 25,
    packetDropRate: 0,
    durationMs: 8000,
    thresholds: {
      maxRttErrorMs: 120,
      minSnapshotHz: 22,
      maxReceiveAgeMs: 650,
      maxCorrectionMeters: 85
    }
  }
];

const SAMPLE_INTERVAL_MS = 250;
const HEALTH_TIMEOUT_MS = 30000;
const SERVER_PORT = 3000;
const SECTION_NAMES = new Set(["FRAME", "NETWORK", "CAPTURE", "PREDICTION", "RENDER", "SCENE", "GPU"]);

const options = readOptions(process.argv.slice(2));

if (options.listProfiles) {
  process.stdout.write(`${PROFILES.map((profile) => `${profile.name}: ${profile.description}`).join("\n")}\n`);
  process.exit(0);
}

const selectedProfiles = selectProfiles(options.profile).map((profile) => ({
  ...profile,
  durationMs: options.durationMs ?? profile.durationMs
}));
const server = await ensureServer(options);
let browser: Browser | undefined;

try {
  const browserExecutable = await resolveBrowserExecutable(options.browserExecutable);
  browser = await chromium.launch({
    executablePath: browserExecutable,
    headless: !options.headed,
    args: ["--no-sandbox"]
  });

  const report: BrowserQaReport = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseUrl: options.baseUrl,
    browserExecutable,
    profiles: [],
    passed: true
  };

  for (const profile of selectedProfiles) {
    const profileReport = await runProfile(browser, options.baseUrl, profile);
    report.profiles.push(profileReport);
    if (!profileReport.passed) {
      report.passed = false;
    }
    printProfileSummary(profileReport);
  }

  if (options.stdout) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    const outPath = resolve(options.out ?? "artifacts/network-browser-qa/latest.json");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`Wrote ${outPath}\n`);
  }

  process.exitCode = report.passed ? 0 : 1;
} finally {
  await browser?.close();
  await server.close();
}

async function runProfile(browser: Browser, baseUrl: string, profile: BrowserQaProfile): Promise<ProfileReport> {
  const hostContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const guestContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const hostSocket = createSocketCounters();
  const guestSocket = createSocketCounters();

  try {
    await installWebSocketImpairment(guestContext, profile, guestSocket);

    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const roomId = await setupMatch(baseUrl, host, guest);

    await showDebug(host);
    await showDebug(guest);

    const startedAt = Date.now();
    const hostSamples: DebugSample[] = [];
    const guestSamples: DebugSample[] = [];

    await runFlightScenario(host, guest, profile.durationMs, async () => {
      const atMs = Date.now() - startedAt;
      hostSamples.push(await sampleDebugOverlay(host, atMs));
      guestSamples.push(await sampleDebugOverlay(guest, atMs));
    });

    const clients = {
      host: buildClientReport("host", hostSamples, hostSocket),
      guest: buildClientReport("guest", guestSamples, guestSocket)
    };
    const failures = evaluateProfile(profile, clients.host, clients.guest);
    return {
      profile,
      roomId,
      passed: failures.length === 0,
      failures,
      clients
    };
  } finally {
    await hostContext.close();
    await guestContext.close();
  }
}

async function setupMatch(baseUrl: string, host: Page, guest: Page): Promise<string> {
  await host.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await host.waitForSelector("#lobby", { timeout: 15000 });
  await host.locator("#nameInput").fill("QA Host");
  await host.getByRole("button", { name: "Create Room" }).click();
  await host.waitForURL(/room=/, { timeout: 15000 });
  const roomId = new URL(host.url()).searchParams.get("room");
  if (!roomId) {
    throw new Error("Host did not receive a room id.");
  }

  await guest.goto(withRoom(baseUrl, roomId), { waitUntil: "domcontentloaded" });
  await guest.waitForSelector("#lobby", { timeout: 15000 });
  await guest.locator("#nameInput").fill("QA Guest");
  await guest.getByRole("button", { name: "Join" }).click();
  await guest.getByRole("button", { name: "Ready" }).click({ timeout: 15000 });
  await host.getByRole("button", { name: "Ready" }).click({ timeout: 15000 });
  await host.getByRole("button", { name: "Launch" }).click({ timeout: 15000 });
  await host.waitForSelector("#lobby", { state: "detached", timeout: 15000 });
  await guest.waitForSelector("#lobby", { state: "detached", timeout: 15000 });
  return roomId;
}

async function showDebug(page: Page): Promise<void> {
  await dispatchKey(page, "keydown", "F3", "F3");
  await dispatchKey(page, "keyup", "F3", "F3");
  await page.waitForSelector(".debug-overlay", { timeout: 15000 });
}

async function runFlightScenario(host: Page, guest: Page, durationMs: number, sample: () => Promise<void>): Promise<void> {
  const startedAt = Date.now();
  let lastPhase = -1;

  await setKey(host, "KeyW", "w", true);
  await setKey(guest, "KeyW", "w", true);

  while (Date.now() - startedAt < durationMs) {
    const elapsed = Date.now() - startedAt;
    const phase = Math.floor(elapsed / 1000) % 4;
    if (phase !== lastPhase) {
      lastPhase = phase;
      await applyPhaseInput(host, phase);
      await applyPhaseInput(guest, (phase + 2) % 4);
    }

    await sample();
    await wait(SAMPLE_INTERVAL_MS);
  }

  await releaseFlightKeys(host);
  await releaseFlightKeys(guest);
}

async function applyPhaseInput(page: Page, phase: number): Promise<void> {
  const active = new Set<string>(["KeyW"]);
  if (phase === 0) {
    active.add("KeyA");
  } else if (phase === 1) {
    active.add("KeyD");
    active.add("ShiftLeft");
  } else if (phase === 2) {
    active.add("KeyS");
  } else {
    active.add("KeyA");
    active.add("Space");
  }

  for (const [code, key] of flightKeys()) {
    await setKey(page, code, key, active.has(code));
  }
}

async function releaseFlightKeys(page: Page): Promise<void> {
  for (const [code, key] of flightKeys()) {
    await setKey(page, code, key, false);
  }
}

function flightKeys(): Array<[string, string]> {
  return [
    ["KeyW", "w"],
    ["KeyA", "a"],
    ["KeyS", "s"],
    ["KeyD", "d"],
    ["ShiftLeft", "Shift"],
    ["Space", " "]
  ];
}

async function setKey(page: Page, code: string, key: string, down: boolean): Promise<void> {
  await dispatchKey(page, down ? "keydown" : "keyup", code, key);
}

async function dispatchKey(page: Page, type: "keydown" | "keyup", code: string, key: string): Promise<void> {
  await page.evaluate(
    ({ eventType, eventCode, eventKey }) => {
      window.dispatchEvent(
        new KeyboardEvent(eventType, {
          bubbles: true,
          cancelable: true,
          code: eventCode,
          key: eventKey
        })
      );
    },
    { eventType: type, eventCode: code, eventKey: key }
  );
}

async function sampleDebugOverlay(page: Page, atMs: number): Promise<DebugSample> {
  const text = await page.locator(".debug-overlay").innerText();
  return { atMs, sections: parseDebugOverlay(text) };
}

function parseDebugOverlay(text: string): Record<string, Record<string, string>> {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const sections: Record<string, Record<string, string>> = {};
  let section = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (SECTION_NAMES.has(line)) {
      section = line.toLowerCase();
      sections[section] = {};
      continue;
    }

    if (!section || line === "DEBUG" || line === "F3") {
      continue;
    }

    const next = lines[index + 1];
    if (!next || SECTION_NAMES.has(next)) {
      continue;
    }

    sections[section][line] = next;
    index += 1;
  }

  return sections;
}

function buildClientReport(name: string, samples: DebugSample[], websocket: SocketImpairmentCounters): ClientReport {
  const tail = samples.slice(Math.floor(samples.length / 2));
  return {
    name,
    rttMs: medianMetric(tail, "network", "RTT"),
    snapshotHz: medianMetric(tail, "network", "Snapshots"),
    receiveAgeMs: percentileMetric(tail, "network", "Receive age", 95),
    correctionMeters: percentileMetric(tail, "prediction", "Correction", 95),
    jets: Math.max(...samples.map((sample) => numberFromValue(sample.sections.scene?.Jets)).filter(isFiniteNumber), 0),
    samples,
    websocket
  };
}

function evaluateProfile(profile: BrowserQaProfile, host: ClientReport, guest: ClientReport): string[] {
  const failures: string[] = [];
  const expectedGuestRtt = profile.oneWayLatencyMs * 2;
  const guestRttError = Math.abs(guest.rttMs - expectedGuestRtt);

  if (host.jets < 2 || guest.jets < 2) {
    failures.push(`Expected both clients to see 2 jets; saw host=${host.jets}, guest=${guest.jets}.`);
  }
  if (host.snapshotHz < profile.thresholds.minSnapshotHz || guest.snapshotHz < profile.thresholds.minSnapshotHz) {
    failures.push(`Snapshot rate too low; host=${host.snapshotHz.toFixed(1)} Hz, guest=${guest.snapshotHz.toFixed(1)} Hz.`);
  }
  if (guestRttError > profile.thresholds.maxRttErrorMs) {
    failures.push(`Guest RTT ${guest.rttMs.toFixed(0)} ms missed expected ${expectedGuestRtt} ms by ${guestRttError.toFixed(0)} ms.`);
  }
  if (host.receiveAgeMs > profile.thresholds.maxReceiveAgeMs || guest.receiveAgeMs > profile.thresholds.maxReceiveAgeMs) {
    failures.push(`Receive age too high; host=${host.receiveAgeMs.toFixed(0)} ms, guest=${guest.receiveAgeMs.toFixed(0)} ms.`);
  }
  if (host.correctionMeters > profile.thresholds.maxCorrectionMeters || guest.correctionMeters > profile.thresholds.maxCorrectionMeters) {
    failures.push(`Prediction correction too high; host=${host.correctionMeters.toFixed(1)} m, guest=${guest.correctionMeters.toFixed(1)} m.`);
  }

  return failures;
}

async function installWebSocketImpairment(
  context: BrowserContext,
  profile: BrowserQaProfile,
  counters: SocketImpairmentCounters
): Promise<void> {
  if (profile.oneWayLatencyMs <= 0 && profile.jitterMs <= 0 && profile.packetDropRate <= 0) {
    return;
  }

  let seed = hashString(profile.name);
  await context.routeWebSocket(/socket\.io/, (ws) => {
    counters.routed += 1;
    const server = ws.connectToServer();

    ws.onMessage((message) => {
      counters.pageToServer += 1;
      forwardWithImpairment(message, server.send.bind(server), "page", profile, counters, () => {
        seed = nextSeed(seed);
        return randomFromSeed(seed);
      });
    });

    server.onMessage((message) => {
      counters.serverToPage += 1;
      forwardWithImpairment(message, ws.send.bind(ws), "server", profile, counters, () => {
        seed = nextSeed(seed);
        return randomFromSeed(seed);
      });
    });
  });
}

function forwardWithImpairment(
  message: string | Buffer,
  send: (message: string | Buffer) => void,
  direction: "page" | "server",
  profile: BrowserQaProfile,
  counters: SocketImpairmentCounters,
  random: () => number
): void {
  if (profile.packetDropRate > 0 && random() < profile.packetDropRate) {
    if (direction === "page") {
      counters.droppedPageToServer += 1;
    } else {
      counters.droppedServerToPage += 1;
    }
    return;
  }

  const jitter = profile.jitterMs > 0 ? (random() * 2 - 1) * profile.jitterMs : 0;
  const delayMs = Math.max(0, Math.round(profile.oneWayLatencyMs + jitter));
  counters.maxDelayMs = Math.max(counters.maxDelayMs, delayMs);

  if (direction === "page") {
    counters.delayedPageToServer += 1;
  } else {
    counters.delayedServerToPage += 1;
  }

  if (delayMs <= 0) {
    send(message);
  } else {
    setTimeout(() => send(message), delayMs);
  }
}

function createSocketCounters(): SocketImpairmentCounters {
  return {
    routed: 0,
    pageToServer: 0,
    serverToPage: 0,
    droppedPageToServer: 0,
    droppedServerToPage: 0,
    delayedPageToServer: 0,
    delayedServerToPage: 0,
    maxDelayMs: 0
  };
}

function medianMetric(samples: DebugSample[], section: string, label: string): number {
  return percentileMetric(samples, section, label, 50);
}

function percentileMetric(samples: DebugSample[], section: string, label: string, percentile: number): number {
  const values = samples.map((sample) => numberFromValue(sample.sections[section]?.[label])).filter(isFiniteNumber).sort((a, b) => a - b);
  if (values.length === 0) {
    return 0;
  }

  const index = Math.min(values.length - 1, Math.max(0, Math.ceil((percentile / 100) * values.length) - 1));
  return values[index];
}

function numberFromValue(value: string | undefined): number {
  if (!value || value === "--") {
    return Number.NaN;
  }

  return Number.parseFloat(value.replace(/,/g, ""));
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

function withRoom(baseUrl: string, roomId: string): string {
  const url = new URL(baseUrl);
  url.searchParams.set("room", roomId);
  return url.toString();
}

async function ensureServer(options: CliOptions): Promise<{ close: () => Promise<void> }> {
  if (await isHealthy(options.baseUrl)) {
    return { close: async () => undefined };
  }

  if (options.noStartServer) {
    throw new Error(`No server is listening at ${options.baseUrl}.`);
  }

  const url = new URL(options.baseUrl);
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(`Refusing to auto-start a server for non-local base URL ${options.baseUrl}.`);
  }

  const port = Number(url.port || SERVER_PORT);
  const server = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], {
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe"
  });

  server.stdout.on("data", (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on("data", (chunk) => process.stderr.write(`[server] ${chunk}`));

  const started = await waitForHealth(options.baseUrl, HEALTH_TIMEOUT_MS);
  if (!started) {
    server.kill("SIGTERM");
    throw new Error(`Timed out waiting for ${options.baseUrl}/health.`);
  }

  return { close: async () => stopProcess(server) };
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL("/health", baseUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isHealthy(baseUrl)) {
      return true;
    }
    await wait(250);
  }
  return false;
}

async function stopProcess(process: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.exitCode !== null || process.killed) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 3000);
    process.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    process.kill("SIGTERM");
  });
}

async function resolveBrowserExecutable(explicitPath?: string): Promise<string> {
  const candidates = [
    explicitPath,
    process.env.AFTERBURN_BROWSER_EXECUTABLE,
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known browser location.
    }
  }

  throw new Error("Unable to find Chrome/Chromium. Set AFTERBURN_BROWSER_EXECUTABLE=/path/to/chrome and retry.");
}

function selectProfiles(name?: string): BrowserQaProfile[] {
  if (!name) {
    return [...PROFILES];
  }

  const profile = PROFILES.find((candidate) => candidate.name === name);
  if (!profile) {
    throw new Error(`Unknown profile "${name}". Available: ${PROFILES.map((candidate) => candidate.name).join(", ")}`);
  }

  return [profile];
}

function readOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    baseUrl: process.env.AFTERBURN_BASE_URL ?? `http://localhost:${SERVER_PORT}/`,
    headed: false,
    listProfiles: false,
    noStartServer: false,
    stdout: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") {
      options.baseUrl = requiredValue(args, ++index, arg);
    } else if (arg === "--browser-executable") {
      options.browserExecutable = requiredValue(args, ++index, arg);
    } else if (arg === "--duration-ms") {
      options.durationMs = Number(requiredValue(args, ++index, arg));
    } else if (arg === "--headed") {
      options.headed = true;
    } else if (arg === "--list-profiles") {
      options.listProfiles = true;
    } else if (arg === "--no-start-server") {
      options.noStartServer = true;
    } else if (arg === "--out") {
      options.out = requiredValue(args, ++index, arg);
    } else if (arg === "--profile") {
      options.profile = requiredValue(args, ++index, arg);
    } else if (arg === "--stdout") {
      options.stdout = true;
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }

  if (options.durationMs !== undefined && (!Number.isFinite(options.durationMs) || options.durationMs < 1000)) {
    throw new Error("--duration-ms must be at least 1000.");
  }

  return options;
}

function requiredValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function printProfileSummary(report: ProfileReport): void {
  const status = report.passed ? "PASS" : "FAIL";
  process.stdout.write(
    `${status} ${report.profile.name}: room=${report.roomId} host=${report.clients.host.rttMs.toFixed(0)}ms/${report.clients.host.snapshotHz.toFixed(1)}Hz guest=${report.clients.guest.rttMs.toFixed(0)}ms/${report.clients.guest.snapshotHz.toFixed(1)}Hz\n`
  );
  for (const failure of report.failures) {
    process.stdout.write(`  - ${failure}\n`);
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextSeed(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function randomFromSeed(seed: number): number {
  return seed / 0xffffffff;
}
