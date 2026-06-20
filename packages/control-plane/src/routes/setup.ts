import { Elysia, t } from "elysia";
import { resolve4 } from "node:dns/promises";
import { prisma } from "../db.ts";
import { env } from "../env.ts";
import { authGuard, isAdmin } from "../auth.ts";

// First-run setup wizard: domain + HTTPS provisioning, driven from the dashboard.
// The control-plane runs certbot + reconfigures nginx (it already runs as root
// and manages per-session nginx locations), so the admin never touches the CLI.

const NGINX_SITE = process.env.NGINX_SITE ?? "/etc/nginx/sites-available/safevm";
const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

async function run(cmd: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { code, out: `${stdout}${stderr}`.trim() };
}

let cachedIp = "";
async function publicIp(): Promise<string> {
  if (cachedIp) return cachedIp;
  try {
    const r = await fetch("https://api.ipify.org", { signal: AbortSignal.timeout(5000) });
    cachedIp = (await r.text()).trim();
  } catch {
    cachedIp = "";
  }
  return cachedIp;
}

async function getSetting() {
  return prisma.setting.upsert({
    where: { tenantId: env.TENANT_ID },
    update: {},
    create: { tenantId: env.TENANT_ID },
  });
}

export const setupRoutes = new Elysia({ prefix: "/api/setup" })
  .use(authGuard)
  // Current setup state — any authed user (the dashboard decides whether to show
  // the wizard); mutations below are admin-only.
  .get("/status", async () => {
    const s = await getSetting();
    return {
      setupDone: s.setupDone,
      tlsEnabled: s.tlsEnabled,
      publicDomain: s.publicDomain,
      serverIp: await publicIp(),
    };
  })
  // Check whether a domain's A record points at this server.
  .post(
    "/verify-dns",
    async ({ body, auth, status }) => {
      if (!isAdmin(auth)) return status(403, "admin only");
      const domain = body.domain.trim().toLowerCase();
      if (!HOSTNAME_RE.test(domain)) return status(400, "invalid domain");
      const ip = await publicIp();
      const addresses = await resolve4(domain).catch(() => [] as string[]);
      return {
        domain,
        serverIp: ip,
        addresses,
        resolves: addresses.length > 0,
        matches: !!ip && addresses.includes(ip),
      };
    },
    { body: t.Object({ domain: t.String() }) },
  )
  // Point nginx at the domain, obtain a Let's Encrypt cert, switch to HTTPS.
  .post(
    "/enable-tls",
    async ({ body, auth, status }) => {
      if (!isAdmin(auth)) return status(403, "admin only");
      const domain = body.domain.trim().toLowerCase();
      const email = body.email.trim();
      if (!HOSTNAME_RE.test(domain)) return status(400, "invalid domain");

      // certbot --nginx matches the cert to a server block by server_name, so
      // set it to the domain first, then reload.
      const setName = await run(["sed", "-i", `s/server_name .*/server_name ${domain};/`, NGINX_SITE]);
      if (setName.code !== 0) return status(500, `could not update nginx: ${setName.out}`);
      const test = await run(["nginx", "-t"]);
      if (test.code !== 0) return status(500, `nginx config invalid: ${test.out}`);
      await run(["nginx", "-s", "reload"]);

      const cb = await run([
        "certbot", "--nginx", "-d", domain,
        "--non-interactive", "--agree-tos", "-m", email, "--redirect",
      ]);
      if (cb.code !== 0) {
        return status(400, `certbot failed — check DNS points here and 80/443 are open:\n${cb.out}`);
      }

      const s = await prisma.setting.upsert({
        where: { tenantId: env.TENANT_ID },
        update: { publicDomain: domain, tlsEnabled: true, setupDone: true },
        create: { tenantId: env.TENANT_ID, publicDomain: domain, tlsEnabled: true, setupDone: true },
      });
      await prisma.auditLog.create({
        data: { tenantId: env.TENANT_ID, action: "setup.enable-tls", target: domain, meta: {} },
      });
      return { ok: true, publicDomain: s.publicDomain, url: `https://${domain}` };
    },
    { body: t.Object({ domain: t.String(), email: t.String() }) },
  )
  // Dismiss the wizard without TLS (e.g. running on a plain IP for testing).
  .post("/skip", async ({ auth, status }) => {
    if (!isAdmin(auth)) return status(403, "admin only");
    await prisma.setting.upsert({
      where: { tenantId: env.TENANT_ID },
      update: { setupDone: true },
      create: { tenantId: env.TENANT_ID, setupDone: true },
    });
    return { ok: true };
  });
