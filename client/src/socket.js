import { io } from "socket.io-client";
import { API_BASE } from "./api";

const socket = io(API_BASE, {
  autoConnect: true,
  transports: ["websocket", "polling"],
});

export default socket;