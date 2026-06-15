var _a;
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
// Приложение разворачивается за reverse-proxy с префиксом пути
// (напр. https://custom-servers.t1v.scibox.tech/jnserver/1109/application/).
// В сборке используем этот префикс как base, чтобы ассеты и API-вызовы шли через
// проксируемый путь. В dev-режиме base="/" (Vite-сервер на :5173 + прокси /api).
// Префикс можно переопределить переменной окружения VITE_BASE_PATH.
var BASE_PATH = (_a = process.env.VITE_BASE_PATH) !== null && _a !== void 0 ? _a : "/jnserver/1109/application/";
export default defineConfig(function (_a) {
    var command = _a.command;
    return ({
        base: command === "build" ? BASE_PATH : "/",
        plugins: [react()],
        resolve: {
            alias: { "@": path.resolve(__dirname, "src") },
        },
        server: {
            port: 5173,
            proxy: {
                // Прокси на backend, чтобы фронт обращался к /api без CORS-настроек.
                "/api": "http://localhost:8080",
            },
        },
    });
});
