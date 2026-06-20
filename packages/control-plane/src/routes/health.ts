import { Elysia } from "elysia";

export const healthRoutes = new Elysia().get("/health", () => ({
  status: "ok",
  service: "control-plane",
}));
