/**
 * Simple password auth — replaces Manus OAuth for self-hosted deployments.
 * Set ADMIN_PASSWORD and ADMIN_EMAIL in Railway env vars.
 * Login at /api/auth/login with { email, password }
 */
import type { Express, Request, Response } from "express";
import { SignJWT, jwtVerify } from "jose";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./cookies";

const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? "admin@dreambrothers.it";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "";
const JWT_SECRET = process.env.JWT_SECRET ?? "changeme-set-JWT_SECRET-in-railway";

const secret = new TextEncoder().encode(JWT_SECRET);

export const SIMPLE_ADMIN_USER = {
  id: 1,
  openId: "admin",
  name: process.env.ADMIN_NAME ?? "Andrea Bilotta",
  email: ADMIN_EMAIL,
  loginMethod: "password",
  role: "admin" as const,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

export async function createSimpleSessionToken(): Promise<string> {
  return new SignJWT({ openId: "admin", appId: "dreambrothers", name: SIMPLE_ADMIN_USER.name })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1y")
    .sign(secret);
}

export async function verifySimpleSessionToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as { openId: string; appId: string; name: string };
  } catch {
    return null;
  }
}

export function registerSimpleAuthRoutes(app: Express) {
  // POST /api/auth/login
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body ?? {};
    if (!ADMIN_PASSWORD) {
      res.status(503).json({ error: "ADMIN_PASSWORD not set in environment variables" });
      return;
    }
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      res.status(401).json({ error: "Email o password errati" });
      return;
    }
    const token = await createSimpleSessionToken();
    const cookieOptions = getSessionCookieOptions(req);
    res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
    res.json({ success: true, user: SIMPLE_ADMIN_USER });
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout-simple", (req: Request, res: Response) => {
    const cookieOptions = getSessionCookieOptions(req);
    res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
    res.json({ success: true });
  });
}
