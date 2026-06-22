import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// 节点 RPC 地址(供开发代理转发用)。浏览器不直接访问它,避免跨源/CORS 问题。
const RPC_TARGET = process.env.VITE_RPC_TARGET ?? "http://127.0.0.1:8545";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // 前端只读请求打到同源的 /rpc,由 dev server 转发到节点
      "/rpc": {
        target: RPC_TARGET,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/rpc/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
