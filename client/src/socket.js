import { io } from "socket.io-client";
import { API_BASE } from "./api";

const socket = io(API_BASE, {
  autoConnect: false,
  transports: ["websocket", "polling"],
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
