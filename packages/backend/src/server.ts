import { createServer } from "http";
import { Server } from "socket.io";
import type {
  ServerToClientEvents,
  ClientToServerEvents,
} from "@projekt/shared";

const PORT = process.env.PORT ?? 3000;

const httpServer = createServer();

const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: "*",
  },
});

io.on("connection", (socket) => {
  console.log(`[Server] Player connected:    id=${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`[Server] Player disconnected: id=${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[Server] Listening on http://localhost:${PORT}`);
});
