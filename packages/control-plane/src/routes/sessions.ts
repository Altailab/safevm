import { Elysia, t } from "elysia";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { publishJob } from "../queue.ts";
import { authGuard, isAdmin } from "../auth.ts";

// Per-user scoping: members only ever see/act on their own sessions; admins see
// all. `auth.sub` is the caller's user id (from the verified JWT).
const ownerScope = (auth: unknown) =>
  isAdmin(auth) ? {} : { userId: (auth as { sub?: string }).sub };

export const sessionRoutes = new Elysia({ prefix: "/api/sessions" })
  .use(authGuard)
  .get("/", ({ auth }) =>
    prisma.session.findMany({
      where: { tenantId: env.TENANT_ID, ...ownerScope(auth) },
      orderBy: { startedAt: "desc" },
      take: 100,
    }),
  )
  .get(
    "/:id",
    async ({ params, status, auth }) => {
      const session = await prisma.session.findFirst({
        where: { id: params.id, tenantId: env.TENANT_ID, ...ownerScope(auth) },
      });
      return session ?? status(404, "session not found");
    },
    { params: t.Object({ id: t.String() }) },
  )
  // Tear down a running session (own session, or any if admin).
  .post(
    "/:id/stop",
    async ({ params, status, auth }) => {
      const session = await prisma.session.findFirst({
        where: { id: params.id, tenantId: env.TENANT_ID, ...ownerScope(auth) },
      });
      if (!session) return status(404, "session not found");
      await prisma.session.update({ where: { id: session.id }, data: { status: "stopping" } });
      await publishJob({ type: "session.stop", sessionId: session.id });
      await prisma.auditLog.create({
        data: { tenantId: env.TENANT_ID, action: "session.stop", target: session.id, meta: {} },
      });
      return { id: session.id, status: "stopping" };
    },
    { params: t.Object({ id: t.String() }) },
  );
