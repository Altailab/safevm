import { Elysia, t } from "elysia";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { publishJob } from "../queue.ts";
import { authGuard, isAdmin } from "../auth.ts";

// Workspace API. Guarded by JWT (authGuard). Tenant is the single OSS tenant.
// Members only see/connect workspaces they own; admins see all.
const ownerScope = (auth: unknown) =>
  isAdmin(auth) ? {} : { ownerId: (auth as { sub?: string }).sub };

export const workspaceRoutes = new Elysia({ prefix: "/api/workspaces" })
  .use(authGuard)
  .get("/", ({ auth }) =>
    prisma.workspace.findMany({ where: { tenantId: env.TENANT_ID, ...ownerScope(auth) } }),
  )
  .post(
    "/",
    async ({ body, auth, status }) => {
      if (!isAdmin(auth)) return status(403, "admin only");
      const ws = await prisma.workspace.create({
        data: { ...body, tenantId: env.TENANT_ID },
      });
      await prisma.auditLog.create({
        data: {
          tenantId: env.TENANT_ID,
          action: "workspace.create",
          target: ws.id,
          meta: { name: ws.name },
        },
      });
      return ws;
    },
    {
      body: t.Object({
        ownerId: t.String(),
        imageId: t.String(),
        name: t.String(),
        kind: t.Optional(t.UnionEnum(["persistent", "disposable"])),
        vcpus: t.Optional(t.Number()),
        memMib: t.Optional(t.Number()),
      }),
    },
  )
  // Request a running session. Records intent, dispatches a start job to a node
  // agent over RabbitMQ; the agent fills connectUrl via a status event.
  .post(
    "/:id/connect",
    async ({ params, status, auth }) => {
      const ws = await prisma.workspace.findFirst({
        where: { id: params.id, tenantId: env.TENANT_ID, ...ownerScope(auth) },
      });
      if (!ws) return status(404, "workspace not found");

      // Reuse a live session for this workspace instead of spinning up a second
      // container. Anything not yet torn down counts as active.
      const existing = await prisma.session.findFirst({
        where: {
          tenantId: env.TENANT_ID,
          workspaceId: ws.id,
          status: { in: ["pending", "starting", "running"] },
        },
        orderBy: { startedAt: "desc" },
      });
      if (existing) return existing;

      const session = await prisma.session.create({
        data: {
          tenantId: env.TENANT_ID,
          workspaceId: ws.id,
          userId: ws.ownerId,
          status: "pending",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: env.TENANT_ID,
          actorId: ws.ownerId,
          action: "session.connect",
          target: session.id,
          meta: { workspaceId: ws.id },
        },
      });

      await publishJob({ type: "session.start", sessionId: session.id, workspace: ws });
      return session;
    },
    { params: t.Object({ id: t.String() }) },
  );
