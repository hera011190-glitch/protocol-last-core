import { io } from "socket.io-client";
import { API_BASE } from "./api";

const socket = io(API_BASE, {
  autoConnect: false,
  transports: ["websocket", "polling"],
});

export function ensureSocketConnected() {
  if (!socket.connected) {
    try { socket.connect(); } catch {}
  }
  return socket;
}

export function ensureSocketDisconnected() {
  try {
    socket.removeAllListeners();
  } catch {}
  try {
    if (socket.connected || socket.active) socket.disconnect();
  } catch {}
}

export default socket;
