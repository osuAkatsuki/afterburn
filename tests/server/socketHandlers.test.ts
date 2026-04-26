import { createServer, type Server as HttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Server } from "socket.io";
import { io as createClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";
import { GameRoomManager } from "../../src/server/gameServer.js";
import { registerGameSocketHandlers } from "../../src/server/socketHandlers.js";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "../../src/shared/types.js";

type TestServer = Server<ClientToServerEvents, ServerToClientEvents>;
type TestClient = ClientSocket<ServerToClientEvents, ClientToServerEvents>;

let activeHarness: SocketHarness | undefined;

describe("socketHandlers", () => {
  afterEach(async () => {
    await activeHarness?.close();
    activeHarness = undefined;
  });

  it("creates rooms, joins guests, and broadcasts room snapshots", async () => {
    const harness = await createHarness("ROOMA");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostInitialSnapshot = waitForEvent(host, "state:snapshot");

    host.emit("room:create", { name: "Host", clientId: "host-client" });

    const created = await hostJoined;
    await hostInitialSnapshot;
    expect(created.roomId).toBe("ROOMA");
    expect(created.playerId).toBe("host-client");

    const guest = await harness.connectClient();
    const hostJoinSnapshot = waitForEvent(host, "state:snapshot");
    const guestJoined = waitForEvent(guest, "room:joined");
    const guestSnapshot = waitForEvent(guest, "state:snapshot");

    guest.emit("room:join", { roomId: "rooma", name: "Guest", clientId: "guest-client" });

    const joined = await guestJoined;
    const hostState = await hostJoinSnapshot;
    const guestState = await guestSnapshot;

    expect(joined.roomId).toBe("ROOMA");
    expect(joined.playerId).toBe("guest-client");
    expect(Object.keys(hostState.room.players).sort()).toEqual(["guest-client", "host-client"]);
    expect(Object.keys(guestState.room.players).sort()).toEqual(["guest-client", "host-client"]);
  });

  it("emits room errors for invalid joins and responds to net pings", async () => {
    const harness = await createHarness("ROOMB");
    const client = await harness.connectClient();
    const roomError = waitForEvent(client, "room:error");

    client.emit("room:join", { roomId: "", name: "Pilot" });

    expect((await roomError).message).toMatch(/not found/i);

    const pong = waitForEvent(client, "net:pong");
    const before = Date.now();
    client.emit("net:ping", { clientTime: 1234 });
    const payload = await pong;

    expect(payload.clientTime).toBe(1234);
    expect(payload.serverTime).toBeGreaterThanOrEqual(before);
    expect(payload.serverTime).toBeLessThanOrEqual(Date.now());
  });

  it("broadcasts player latency updates", async () => {
    const harness = await createHarness("PING2");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostInitialSnapshot = waitForEvent(host, "state:snapshot");

    host.emit("room:create", { name: "Host", clientId: "host-client" });

    await hostJoined;
    await hostInitialSnapshot;

    const latencySnapshot = waitForEvent(host, "state:snapshot");
    host.emit("net:latency", { rttMs: 123.4 });

    const snapshot = await latencySnapshot;
    expect(snapshot.room.players["host-client"].latencyMs).toBe(123);
  });

  it("broadcasts player rename updates", async () => {
    const harness = await createHarness("NAME1");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostInitialSnapshot = waitForEvent(host, "state:snapshot");

    host.emit("room:create", { name: "Host", clientId: "host-client" });

    await hostJoined;
    await hostInitialSnapshot;

    const renameSnapshot = waitForEvent(host, "state:snapshot");
    host.emit("player:rename", { name: "Viper" });

    const snapshot = await renameSnapshot;
    expect(snapshot.room.players["host-client"].name).toBe("Viper");
  });

  it("broadcasts player ready updates and starts when ready", async () => {
    const harness = await createHarness("RDY01");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostInitialSnapshot = waitForEvent(host, "state:snapshot");

    host.emit("room:create", { name: "Host", clientId: "host-client" });

    await hostJoined;
    await hostInitialSnapshot;

    const readySnapshot = waitForEvent(host, "state:snapshot");
    host.emit("player:ready", { ready: true });

    expect((await readySnapshot).room.players["host-client"].ready).toBe(true);

    const startSnapshot = waitForEvent(host, "state:snapshot");
    host.emit("round:start", {});

    const snapshot = await startSnapshot;
    expect(snapshot.room.phase).toBe("playing");
    expect(snapshot.room.players["host-client"].ready).toBe(false);
  });

  it("lets the host add and remove bots", async () => {
    const harness = await createHarness("BOT01");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostInitialSnapshot = waitForEvent(host, "state:snapshot");

    host.emit("room:create", { name: "Host", clientId: "host-client" });

    await hostJoined;
    await hostInitialSnapshot;

    const addSnapshot = waitForEvent(host, "state:snapshot");
    host.emit("bot:add", { skill: "ace" });

    const withBot = await addSnapshot;
    const bot = Object.values(withBot.room.players).find((player) => player.isBot);
    expect(bot?.name).toBe("Bandit 1");
    expect(bot?.botSkill).toBe("ace");
    expect(bot?.ready).toBe(true);

    const removeSnapshot = waitForEvent(host, "state:snapshot");
    host.emit("bot:remove", { playerId: bot?.id });

    const withoutBot = await removeSnapshot;
    expect(Object.values(withoutBot.room.players).some((player) => player.isBot)).toBe(false);
  });

  it("broadcasts a room snapshot when a player disconnects", async () => {
    const harness = await createHarness("ROOMC");
    const host = await harness.connectClient();
    const hostJoined = waitForEvent(host, "room:joined");
    const hostSnapshot = waitForEvent(host, "state:snapshot");
    host.emit("room:create", { name: "Host", clientId: "host-client" });
    await hostJoined;
    await hostSnapshot;

    const guest = await harness.connectClient();
    const guestJoined = waitForEvent(guest, "room:joined");
    const guestJoinSnapshot = waitForEvent(guest, "state:snapshot");
    guest.emit("room:join", { roomId: "ROOMC", name: "Guest", clientId: "guest-client" });
    await guestJoined;
    await guestJoinSnapshot;

    const disconnectSnapshot = waitForEvent(guest, "state:snapshot");
    host.disconnect();

    const snapshot = await disconnectSnapshot;
    expect(snapshot.room.players["host-client"]).toBeDefined();
    expect(snapshot.room.players["guest-client"]).toBeDefined();
  });
});

async function createHarness(...roomIds: string[]): Promise<SocketHarness> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { serveClient: false });
  const manager = new GameRoomManager(ids(...roomIds));
  registerGameSocketHandlers(io, manager);

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const address = httpServer.address() as AddressInfo;
  activeHarness = new SocketHarness(httpServer, io, `http://127.0.0.1:${address.port}`);
  return activeHarness;
}

class SocketHarness {
  private readonly clients: TestClient[] = [];

  constructor(
    private readonly httpServer: HttpServer,
    private readonly io: TestServer,
    private readonly url: string
  ) {}

  async connectClient(): Promise<TestClient> {
    const client = createClient(this.url, {
      forceNew: true,
      reconnection: false,
      transports: ["websocket"]
    }) as TestClient;
    this.clients.push(client);
    await waitForSocketConnect(client);
    return client;
  }

  async close(): Promise<void> {
    this.clients.forEach((client) => client.disconnect());
    await new Promise<void>((resolve) => this.io.close(() => resolve()));
    await new Promise<void>((resolve) => this.httpServer.close(() => resolve()));
  }
}

function ids(...values: string[]) {
  const queue = [...values];
  return () => queue.shift() ?? "ROOMX";
}

function waitForSocketConnect(socket: TestClient): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for socket connect")), 1000);
    socket.once("connect", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

function waitForEvent<Event extends keyof ServerToClientEvents>(
  socket: TestClient,
  event: Event
): Promise<Parameters<ServerToClientEvents[Event]>[0]> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), 1000);
    const untypedSocket = socket as unknown as {
      once: (eventName: string, listener: (payload: Parameters<ServerToClientEvents[Event]>[0]) => void) => void;
    };
    untypedSocket.once(event, (payload) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}
