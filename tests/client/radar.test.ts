import { describe, expect, it } from "vitest";
import { createPlayer } from "../../src/shared/simulation.js";
import { quaternionFromRotation } from "../../src/shared/math.js";
import type { PlayerState, Rotation } from "../../src/shared/types.js";
import { RADAR_RADIUS_PX, RADAR_RANGE, radarContacts } from "../../src/client/utils/radar.js";

function setRotation(player: PlayerState, rotation: Rotation) {
  player.rotation = rotation;
  player.orientation = quaternionFromRotation(rotation);
}

function alivePlayer(id: string, x: number, z: number): PlayerState {
  const player = createPlayer(id, id, 0, 1000);
  player.status = "alive";
  player.position = { x, y: 120, z };
  setRotation(player, { pitch: 0, yaw: 0, roll: 0 });
  return player;
}

describe("radarContacts", () => {
  it("projects contacts into the local player's screen-facing heading frame", () => {
    const local = alivePlayer("local", 0, 0);
    const ahead = alivePlayer("ahead", 0, RADAR_RANGE / 2);
    const right = alivePlayer("right", RADAR_RANGE / 2, 0);

    const contacts = radarContacts([local, ahead, right], local);
    const aheadContact = contacts.find((contact) => contact.player.id === "ahead");
    const rightContact = contacts.find((contact) => contact.player.id === "right");

    expect(aheadContact?.x).toBeCloseTo(0);
    expect(aheadContact?.y).toBeCloseTo(-RADAR_RADIUS_PX / 2);
    expect(rightContact?.x).toBeCloseTo(-RADAR_RADIUS_PX / 2);
    expect(rightContact?.y).toBeCloseTo(0);
  });

  it("rotates with the local player's yaw while preserving the screen-facing horizontal sign", () => {
    const local = alivePlayer("local", 0, 0);
    setRotation(local, { pitch: 0, yaw: Math.PI / 2, roll: 0 });
    const east = alivePlayer("east", RADAR_RANGE / 2, 0);
    const north = alivePlayer("north", 0, RADAR_RANGE / 2);

    const contacts = radarContacts([local, east, north], local);
    const eastContact = contacts.find((contact) => contact.player.id === "east");
    const northContact = contacts.find((contact) => contact.player.id === "north");

    expect(eastContact?.x).toBeCloseTo(0);
    expect(eastContact?.y).toBeCloseTo(-RADAR_RADIUS_PX / 2);
    expect(northContact?.x).toBeCloseTo(RADAR_RADIUS_PX / 2);
    expect(northContact?.y).toBeCloseTo(0);
  });

  it("keeps self centered and hides dead or out-of-range contacts", () => {
    const local = alivePlayer("local", 0, 0);
    const inRange = alivePlayer("near", 0, RADAR_RANGE);
    const outOfRange = alivePlayer("far", 0, RADAR_RANGE + 1);
    const dead = alivePlayer("dead", 0, 100);
    dead.status = "dead";

    const contacts = radarContacts([local, inRange, outOfRange, dead], local);

    expect(contacts.find((contact) => contact.player.id === "local")).toMatchObject({ x: 0, y: 0, className: "self" });
    expect(contacts.find((contact) => contact.player.id === "near")?.y).toBeCloseTo(-RADAR_RADIUS_PX);
    expect(contacts.some((contact) => contact.player.id === "far")).toBe(false);
    expect(contacts.some((contact) => contact.player.id === "dead")).toBe(false);
  });
});
