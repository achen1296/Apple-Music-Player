"use strict";

import { ipcRenderer } from "electron";
import { contextBridge } from "electron/renderer";

contextBridge.exposeInMainWorld(
    "backendRequest", (url: string, body?: string) => ipcRenderer.invoke("backendRequest", url, body)
);