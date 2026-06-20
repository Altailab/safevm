import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { prisma } from "./db.ts";
import { env } from "./env.ts";

// Shared JWT config. Payload carries the user identity used by routes.
export const jwtPlugin = jwt({
  name: "jwt",
  secret: env.JWT_SECRET,
  exp: "7d",
});

const bearer = (authHeader?: string) =>
  authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

// Role check for admin-only mutations. `auth` is the verified JWT payload.
export const isAdmin = (auth: unknown): boolean =>
  !!auth && typeof auth === "object" && (auth as { role?: string }).role === "admin";

// Login + whoami. NOT guarded (login must be reachable without a token).
export const authRoutes = new Elysia({ prefix: "/api/auth" })
  .use(jwtPlugin)
  .post(
    "/login",
    async ({ body, jwt, status }) => {
      const user = await prisma.user.findFirst({
        where: { tenantId: env.TENANT_ID, email: body.email.toLowerCase() },
      });
      if (!user?.passwordHash || !(await Bun.password.verify(body.password, user.passwordHash))) {
        return status(401, "invalid credentials");
      }
      const token = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      });
      return { token, user: { id: user.id, email: user.email, role: user.role } };
    },
    { body: t.Object({ email: t.String(), password: t.String() }) },
  )
  .get("/me", async ({ jwt, headers, status }) => {
    const token = bearer(headers.authorization);
    const payload = token ? await jwt.verify(token) : false;
    if (!payload) return status(401, "unauthorized");
    return { id: payload.sub, email: payload.email, role: payload.role };
  });

// Guard plugin: derives `auth` from the Bearer token and rejects unauthenticated
// requests. `.as('scoped')` propagates the hooks to the instance that .use()s it,
// so protected route groups just add `.use(authGuard)`.
export const authGuard = new Elysia({ name: "auth-guard" })
  .use(jwtPlugin)
  .derive(async ({ jwt, headers }) => {
    const token = bearer(headers.authorization);
    const payload = token ? await jwt.verify(token) : false;
    return { auth: payload || null };
  })
  .onBeforeHandle(({ auth, status }) => {
    if (!auth) return status(401, "unauthorized");
  })
  .as("scoped");
