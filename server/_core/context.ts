import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifySimpleSessionToken, SIMPLE_ADMIN_USER } from "./simpleAuth";
import { parse as parseCookies } from "cookie";
import { COOKIE_NAME } from "@shared/const";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

const USE_SIMPLE_AUTH = !!process.env.ADMIN_PASSWORD;

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  try {
    if (USE_SIMPLE_AUTH) {
      // Simple password auth mode (Railway / self-hosted)
      const cookies = parseCookies(opts.req.headers.cookie ?? "");
      const token = cookies[COOKIE_NAME];
      if (token) {
        const payload = await verifySimpleSessionToken(token);
        if (payload) user = SIMPLE_ADMIN_USER as unknown as User;
      }
    } else {
      // Manus OAuth mode
      user = await sdk.authenticateRequest(opts.req);
    }
  } catch {
    user = null;
  }

  return { req: opts.req, res: opts.res, user };
}
