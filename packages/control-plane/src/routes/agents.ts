import { Elysia, t } from "elysia";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { publishJob } from "../queue.ts";
import { authGuard } from "../auth.ts";

// AI agent tasks: hand a workspace a natural-language goal; the agent runner
// executes an observe->think->act loop and streams steps back.
export const agentRoutes = new Elysia({ prefix: "/api/agent-tasks" })
  .use(authGuard)
  .get("/", () =>
    prisma.agentTask.findMany({
      where: { tenantId: env.TENANT_ID },
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { workspace: { select: { name: true } } },
    }),
  )
  .get(
    "/:id",
    async ({ params, status }) => {
      const task = await prisma.agentTask.findFirst({
        where: { id: params.id, tenantId: env.TENANT_ID },
        include: {
          workspace: { select: { name: true } },
          steps: { orderBy: { idx: "asc" } },
        },
      });
      return task ?? status(404, "task not found");
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/",
    async ({ body, auth, status }) => {
      const ws = await prisma.workspace.findFirst({
        where: { id: body.workspaceId, tenantId: env.TENANT_ID },
      });
      if (!ws) return status(404, "workspace not found");

      const task = await prisma.agentTask.create({
        data: {
          tenantId: env.TENANT_ID,
          workspaceId: ws.id,
          userId: (auth as { sub?: string })?.sub ?? ws.ownerId,
          goal: body.goal,
          maxSteps: body.maxSteps ?? 20,
          model: body.model ?? "mock",
          status: "pending",
        },
      });

      await prisma.auditLog.create({
        data: {
          tenantId: env.TENANT_ID,
          actorId: (auth as { sub?: string })?.sub,
          action: "agent.task.create",
          target: task.id,
          meta: { workspaceId: ws.id, goal: body.goal },
        },
      });

      await publishJob({
        type: "agent.task.start",
        taskId: task.id,
        goal: task.goal,
        maxSteps: task.maxSteps,
        model: task.model,
        workspace: ws,
      });

      return task;
    },
    {
      body: t.Object({
        workspaceId: t.String(),
        goal: t.String(),
        maxSteps: t.Optional(t.Number()),
        model: t.Optional(t.UnionEnum(["mock", "claude"])),
      }),
    },
  )
  .post(
    "/:id/stop",
    async ({ params, status }) => {
      const task = await prisma.agentTask.findFirst({
        where: { id: params.id, tenantId: env.TENANT_ID },
      });
      if (!task) return status(404, "task not found");
      await prisma.agentTask.update({ where: { id: task.id }, data: { status: "stopped" } });
      await publishJob({ type: "agent.task.stop", taskId: task.id });
      return { id: task.id, status: "stopped" };
    },
    { params: t.Object({ id: t.String() }) },
  );
