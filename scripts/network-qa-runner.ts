import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { NETWORK_QA_PROFILES, runNetworkQaScenario, type NetworkQaProfile } from "../src/server/net/NetworkScenarioQa.js";

type CliOptions = {
  profile?: string;
  out?: string;
  stdout: boolean;
};

const options = readOptions(process.argv.slice(2));
const profiles = selectProfiles(options.profile);
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  profiles: profiles.map((profile) => runNetworkQaScenario(profile))
};

if (options.stdout) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const outPath = resolve(options.out ?? "artifacts/network-qa/latest.json");
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`Wrote ${outPath}\n`);
}

function selectProfiles(name?: string): NetworkQaProfile[] {
  if (!name) {
    return [...NETWORK_QA_PROFILES];
  }

  const profile = NETWORK_QA_PROFILES.find((candidate) => candidate.name === name);
  if (!profile) {
    throw new Error(`Unknown profile "${name}". Available: ${NETWORK_QA_PROFILES.map((candidate) => candidate.name).join(", ")}`);
  }

  return [profile];
}

function readOptions(args: string[]): CliOptions {
  const options: CliOptions = { stdout: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--stdout") {
      options.stdout = true;
    } else if (arg === "--profile") {
      options.profile = args[index + 1];
      index += 1;
    } else if (arg === "--out") {
      options.out = args[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument "${arg}".`);
    }
  }

  return options;
}
