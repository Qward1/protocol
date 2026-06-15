import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Приложение разворачивается за reverse-proxy с префиксом пути
// (напр. https://custom-servers.t1v.scibox.tech/jnserver/1109/application/).
// В сборке используем этот префикс как base, чтобы ассеты и API-вызовы шли через
// проксируемый путь. В dev-режиме base="/" (Vite-сервер на :5173 + прокси /api).
// Префикс можно переопределить переменной окружения VITE_BASE_PATH.
const BASE_PATH = process.env.VITE_BASE_PATH ?? "/jnserver/1109/application/";

export default defineConfig(({ command }) => ({
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
}));
