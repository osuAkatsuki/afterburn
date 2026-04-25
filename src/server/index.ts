import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { configureClientServing } from "./clientServing.js";
import { GameRoomManager } from "./gameServer.js";
import { registerGameSocketHandlers, startGameLoop } from "./socketHandlers.js";
import type { ClientToServerEvents, ServerToClientEvents } from "../shared/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";
const serveClient = process.env.SERVE_CLIENT !== "0";
const port = Number(process.env.PORT ?? 3000);

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  serveClient: false
});
const manager = new GameRoomManager();

app.get("/health", (_req, res) => {
  res.json({ ok: true, rooms: manager.rooms.size });
});

registerGameSocketHandlers(io, manager);
startGameLoop(io, manager);

if (serveClient) {
  await configureClientServing(app, __dirname, isProduction);
}

httpServer.listen(port, () => {
  console.log(`Afterburn Arena listening on http://localhost:${port}`);
});
