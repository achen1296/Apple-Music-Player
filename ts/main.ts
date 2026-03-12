"use strict";

import { ipcMain, net } from "electron";
import { app, BrowserWindow, protocol } from "electron/main";
import { ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as zmq from "zeromq";

const BACKEND_PORT = 0xA91E; // hexspeak approximation of "Apple" which is also a valid port

const createWindow = () => {
    const win = new BrowserWindow({
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
        icon: path.join(__dirname, "assets", "icon.png"),
    });

    win.maximize();
    win.show();

    win.loadFile("index.html");
};

protocol.registerSchemesAsPrivileged([
    {
        scheme: "app",
        privileges: {
            stream: true,
            bypassCSP: true,
        }
    }
]);

let childProcess: ChildProcess | null = null;

function spawnBackend() {
    if (childProcess) {
        return;
    }
    childProcess = spawn(
        "python",
        [
            path.join(__dirname, "electron_backend.py"),
            `${BACKEND_PORT}`,
        ]
    );
    if (!childProcess) {
        throw Error("couldn't spawn backend child process");
    }
}

function killBackend() {
    if (childProcess) {
        childProcess.kill();
        childProcess = null;
    }
}

app.on("will-quit", killBackend);

async function backendRequest(url: string, body?: string) {
    // body usually JSON but no need to decode it on this end only to have to make it into a string again
    const sock = new zmq.Request();
    sock.connect(`tcp://localhost:${BACKEND_PORT}`);
    if (body) {
        // URL can't have spaces
        await sock.send(url + " " + body);
    } else { // empty string or undefined
        await sock.send(url);
    }
    const [result] = await sock.receive();
    const resultString = result.toString();
    if (resultString.startsWith("error ")) {
        // print Python backend errors to the main console
        console.error(resultString.slice("error ".length));
    }
    sock.close();
    return resultString;
}

app.whenReady().then(() => {
    spawnBackend();

    ipcMain.handle("backendRequest", (ev, url: string, body?: string) => backendRequest(url, body));

    createWindow();

    protocol.handle("app", async (req) => {
        // use host to determine how to interpret the result, but the rest of the URL parsing is done on the Python side
        const { host } = new URL(req.url);

        const response = await backendRequest(req.url, await req.text());

        if (response.startsWith("error ")) {
            return new Response(response.slice("error ".length), {
                status: 400,
                headers: { "content-type": "text/html" }
            });
        }

        if (host === "trackFile") {
            // already stored as a file:// URL
            return net.fetch(response.toString());
        } else if (host === "artwork") {
            return net.fetch(pathToFileURL(response.toString()).toString());
        } else {
            return new Response(response, {
                status: 200,
                headers: { "content-type": "text" }
            });
        }
    });

    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});