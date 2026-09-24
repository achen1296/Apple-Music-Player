"use strict";

import { ipcRenderer } from "electron";
import { contextBridge } from "electron/renderer";

contextBridge.exposeInMainWorld(
    "backendRequest", (url: string, body?: string) => ipcRenderer.invoke("backendRequest", url, body)
);

contextBridge.exposeInMainWorld(
    "loadSettings", () => ipcRenderer.invoke("loadSettings")
);

contextBridge.exposeInMainWorld(
    "saveSettings", (settings: any) => ipcRenderer.invoke("saveSettings", settings)
);

contextBridge.exposeInMainWorld(
    "showItemInFolder", (p: string) => ipcRenderer.invoke("showItemInFolder", p)
);

contextBridge.exposeInMainWorld(
    "copyToClipboard", (s: string) => ipcRenderer.invoke("copyToClipboard", s)
);