import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import { createTeacherApiMiddleware } from "./server/teacherApi";

const stockfishFiles: Record<string, { path: string; type: string }> = {
  "/engine/stockfish-18-lite-single.js": {
    path: resolve("node_modules/stockfish/bin/stockfish-18-lite-single.js"),
    type: "text/javascript"
  },
  "/engine/stockfish-18-lite-single.wasm": {
    path: resolve("node_modules/stockfish/bin/stockfish-18-lite-single.wasm"),
    type: "application/wasm"
  },
  "/engine/stockfish-18-lite.js": {
    path: resolve("node_modules/stockfish/bin/stockfish-18-lite.js"),
    type: "text/javascript"
  },
  "/engine/stockfish-18-lite.wasm": {
    path: resolve("node_modules/stockfish/bin/stockfish-18-lite.wasm"),
    type: "application/wasm"
  }
};

const stockfishDevPlugin: Plugin = {
  name: "quietmove-stockfish-dev",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const file = stockfishFiles[req.url?.split("?")[0] ?? ""];
      if (!file) return next();
      res.statusCode = 200;
      res.setHeader("Content-Type", file.type);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      createReadStream(file.path).pipe(res);
    });
  }
};

const teacherApi = createTeacherApiMiddleware();
const teacherApiPlugin: Plugin = {
  name: "quietmove-teacher-api",
  configureServer(server) {
    server.middlewares.use(teacherApi);
  },
  configurePreviewServer(server) {
    server.middlewares.use(teacherApi);
  }
};

export default defineConfig({
  plugins: [
    react(),
    teacherApiPlugin,
    stockfishDevPlugin,
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/stockfish/bin/stockfish-18-lite-single.js",
          dest: "engine"
        },
        {
          src: "node_modules/stockfish/bin/stockfish-18-lite-single.wasm",
          dest: "engine"
        },
        {
          src: "node_modules/stockfish/bin/stockfish-18-lite.js",
          dest: "engine"
        },
        {
          src: "node_modules/stockfish/bin/stockfish-18-lite.wasm",
          dest: "engine"
        },
        {
          src: "node_modules/stockfish/Copying.txt",
          dest: "licenses",
          rename: "STOCKFISH-GPL-3.0.txt"
        }
      ]
    })
  ],
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless"
    }
  },
  worker: {
    format: "es"
  }
});
