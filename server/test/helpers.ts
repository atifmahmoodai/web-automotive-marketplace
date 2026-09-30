import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { createPool } from "../src/db";

export const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/market_test";
export const PASSWORD = "demo-password-1";

export interface TestCtx {
  app: FastifyInstance;
  db: ReturnType<typeof createPool>;
  close(): Promise<void>;
}

export async function makeApp(env: Record<string, string> = {}): Promise<TestCtx> {
  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DB_URL,
    LOG_LEVEL: "silent",
    PUBLIC_URL: "https://cars.example.com",
    WEB_DIST: "",
    ...env,
  });
  const db = createPool(config.DATABASE_URL, 5);
  const app = await buildApp(config, db);
  return {
    app,
    db,
    async close() {
      await app.close();
      await db.end();
    },
  };
}

export interface Agent {
  cookie: string;
  csrf: string;
  get(url: string): Promise<LightMyRequestResponse>;
  send(method: "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<LightMyRequestResponse>;
  upload(method: "POST" | "PUT", url: string, data: Buffer, type?: string): Promise<LightMyRequestResponse>;
}

/** Logs in and returns a client that sends the session cookie and CSRF token like the browser does. */
export async function login(app: FastifyInstance, email: string, password = PASSWORD): Promise<Agent> {
  const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password }, remoteAddress: randomIp() });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  return agentFrom(app, res);
}

export const randomIp = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

let registered = 0;
/** Signs up a brand-new member (so tests don't trip over each other's data). */
export async function register(app: FastifyInstance, name = "Test Member"): Promise<Agent & { email: string; id: string }> {
  const email = `member${Date.now()}${registered++}@test.local`;
  const res = await app.inject({ method: "POST", url: "/api/auth/register", payload: { email, name, password: PASSWORD }, remoteAddress: randomIp() });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.statusCode} ${res.body}`);
  return { ...agentFrom(app, res), email, id: res.json().user.id };
}

function agentFrom(app: FastifyInstance, res: LightMyRequestResponse): Agent {
  const cookie = res.cookies.find((c) => c.name === "sid")!;
  const csrf = res.json().csrfToken as string;
  const headers = { cookie: `sid=${cookie.value}` };
  return {
    cookie: cookie.value,
    csrf,
    get: (url) => app.inject({ method: "GET", url, headers }),
    send: (method, url, body) => app.inject({ method, url, headers: { ...headers, "x-csrf-token": csrf }, ...(body === undefined ? {} : { payload: body as object }) }),
    upload: (method, url, data, type = "image/png") => app.inject({ method, url, headers: { ...headers, "x-csrf-token": csrf, "content-type": type }, payload: data }),
  };
}
