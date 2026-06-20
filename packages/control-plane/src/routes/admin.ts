import { Elysia, t } from "elysia";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { authGuard, isAdmin } from "../auth.ts";

// Images catalog, audit trail, users, stats + create endpoints. Guarded.
export const adminRoutes = new Elysia({ prefix: "/api" })
  .use(authGuard)
  .get("/images", () =>
    prisma.image.findMany({
      where: { tenantId: env.TENANT_ID },
      orderBy: { createdAt: "desc" },
    }),
  )
  .post(
    "/images",
    ({ body, auth, status }) =>
      isAdmin(auth)
        ? prisma.image.create({ data: { ...body, tenantId: env.TENANT_ID } })
        : status(403, "admin only"),
    {
      body: t.Object({
        name: t.String(),
        kernelRef: t.String(),
        rootfsRef: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/users",
    async ({ body, auth, status }) => {
      if (!isAdmin(auth)) return status(403, "admin only");
      const passwordHash = await Bun.password.hash(body.password);
      const user = await prisma.user.create({
        data: {
          tenantId: env.TENANT_ID,
          email: body.email.toLowerCase(),
          role: body.role ?? "member",
          passwordHash,
        },
        select: { id: true, email: true, role: true, createdAt: true },
      });
      await prisma.auditLog.create({
        data: { tenantId: env.TENANT_ID, action: "user.create", target: user.id, meta: { email: user.email } },
      });
      return user;
    },
    {
      body: t.Object({
        email: t.String(),
        password: t.String(),
        role: t.Optional(t.UnionEnum(["admin", "member"])),
      }),
    },
  )
  .get("/audit", () =>
    prisma.auditLog.findMany({
      where: { tenantId: env.TENANT_ID },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  )
  .get("/users", () =>
    prisma.user.findMany({
      where: { tenantId: env.TENANT_ID },
      select: { id: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  )
  .get("/stats", async () => {
    const where = { tenantId: env.TENANT_ID };
    const [workspaces, images, users, running, sessions] = await Promise.all([
      prisma.workspace.count({ where }),
      prisma.image.count({ where }),
      prisma.user.count({ where }),
      prisma.session.count({ where: { ...where, status: "running" } }),
      prisma.session.count({ where }),
    ]);
    return { workspaces, images, users, runningSessions: running, totalSessions: sessions };
  });
