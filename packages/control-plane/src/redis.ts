import Redis from "ioredis";
import { env } from "./env.ts";

// One connection for commands, a second for subscriptions (ioredis requirement:
// a subscribed connection can't issue normal commands).
export const redis = new Redis(env.REDIS_URL);
export const redisSub = new Redis(env.REDIS_URL);

// Live session state lives in Redis (TTL'd), Postgres keeps the durable record.
export const sessionKey = (id: string) => `session:${id}`;
