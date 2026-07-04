import { ipcMain } from "electron";
import * as api from "@/rpc/router";

function registerNamespace(obj: object, prefix: string): void {
  for (const [key, value] of Object.entries(obj)) {
    const channel = `${prefix}.${key}`;
    if (typeof value === "function") {
      ipcMain.handle(channel, (_event, args) => value(args));
    } else if (value !== null && typeof value === "object") {
      registerNamespace(value, channel);
    }
  }
}

export function registerIpcHandlers(): void {
  for (const [key, value] of Object.entries(api)) {
    if (typeof value === "function") {
      ipcMain.handle(key, (_event, args) => value(args));
    } else if (value !== null && typeof value === "object") {
      registerNamespace(value, key);
    }
  }
}
