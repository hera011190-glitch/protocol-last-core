import { io } from "socket.io-client";
import { API_BASE } from "./api";

const socket = io(API_BASE, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
  timeout: 10000,
});

export default socket;

export function ensureSocketConnected() {
  if (!socket.connected) socket.connect();
  return socket;
}

export function ensureSocketDisconnected() {
  if (socket.connected) socket.disconnect();
  return socket;
}
