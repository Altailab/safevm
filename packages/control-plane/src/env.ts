function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  DATABASE_URL: required("DATABASE_URL", "postgres://safevm:safevm@localhost:5433/safevm"),
  REDIS_URL: required("REDIS_URL", "redis://localhost:6379"),
  RABBITMQ_URL: required("RABBITMQ_URL", "amqp://safevm:safevm@localhost:5672"),
  JWT_SECRET: required("JWT_SECRET", "dev-only-change-me"),
  TENANT_ID: process.env.TENANT_ID ?? "default", // OSS = single tenant
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "http://localhost:3000",
};
