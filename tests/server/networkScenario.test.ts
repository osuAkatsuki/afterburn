import { describe, expect, it } from "vitest";
import { MAX_COMBAT_REWIND_MS } from "../../src/shared/constants.js";
import { NETWORK_QA_PROFILES, runNetworkQaScenario } from "../../src/server/net/NetworkScenarioQa.js";

describe("network QA scenario", () => {
  it("validates lag-compensated hits and input backlog metrics across profiles", () => {
    const results = NETWORK_QA_PROFILES.map((profile) => runNetworkQaScenario(profile));

    expect(results).toHaveLength(4);
    for (const result of results) {
      expect(result.hitCount).toBe(1);
      expect(result.combatRewindMs).toBeLessThanOrEqual(MAX_COMBAT_REWIND_MS);
      expect(result.historySamples).toBeGreaterThan(0);
      expect(result.historyClampedSamples).toBeLessThanOrEqual(result.historySamples);
      expect(result.inputConsumed).toBeGreaterThan(0);
      expect(result.inputQueued).toBeGreaterThan(0);
    }

    const badLongHaul = results.find((result) => result.profile.name === "bad-long-haul");
    expect(badLongHaul?.combatRewindMs).toBe(MAX_COMBAT_REWIND_MS);
  });
});
