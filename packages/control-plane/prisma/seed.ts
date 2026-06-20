import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeds a single-tenant ("default") OSS install with an admin, a sample image,
// and a workspace owned by the admin — enough to exercise the connect flow.
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default", name: "SafeVM" },
  });

  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? "admin@safevm.local";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? "changeme";
  const passwordHash = await Bun.password.hash(adminPassword);

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: adminEmail } },
    update: { role: "admin", passwordHash },
    create: { tenantId: tenant.id, email: adminEmail, role: "admin", passwordHash },
  });

  // Debian-based golden image (refs are placeholders the node agent resolves;
  // real kernel/rootfs land with the Firecracker runtime).
  let image = await prisma.image.findFirst({
    where: { tenantId: tenant.id, name: "debian-desktop" },
  });
  if (!image) {
    image = await prisma.image.create({
      data: {
        tenantId: tenant.id,
        name: "debian-desktop",
        kernelRef: "images/debian/vmlinux",
        rootfsRef: "images/debian/rootfs.ext4",
        description: "Debian desktop with streaming server (placeholder refs)",
      },
    });
  }

  const existingWs = await prisma.workspace.findFirst({
    where: { tenantId: tenant.id, ownerId: admin.id, name: "Admin Desktop" },
  });
  if (!existingWs) {
    await prisma.workspace.create({
      data: {
        tenantId: tenant.id,
        ownerId: admin.id,
        imageId: image.id,
        name: "Admin Desktop",
        kind: "persistent",
        vcpus: 2,
        memMib: 2048,
      },
    });
  }

  console.log(`Seeded tenant=${tenant.id} admin=${adminEmail} (password: ${adminPassword})`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
