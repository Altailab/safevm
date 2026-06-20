import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "./env.ts";
import { healthRoutes } from "./routes/health.ts";
import { workspaceRoutes } from "./routes/workspaces.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { adminRoutes } from "./routes/admin.ts";
import { agentRoutes } from "./routes/agents.ts";
import { authRoutes } from "./auth.ts";
import { startEventConsumer } from "./events.ts";

const app = new Elysia()
  .use(cors({ origin: env.WEB_ORIGIN, credentials: true }))
  .use(healthRoutes)
  .use(authRoutes)
  .use(workspaceRoutes)
  .use(sessionRoutes)
  .use(adminRoutes)
  .use(agentRoutes)
  .listen(env.PORT);

// Reconcile node-agent status events back into Postgres/Redis.
startEventConsumer().catch((err) => console.error("event consumer failed to start:", err));

console.log(`SafeVM control plane listening on :${env.PORT} (tenant=${env.TENANT_ID})`);

export type App = typeof app;
