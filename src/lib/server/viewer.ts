import "server-only";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { cache } from "react";
import { AppError } from "@/lib/api/errors";
import { getRpcClient, type RpcClient } from "@/lib/db";
import type { SessionInfo } from "@/lib/db/port";
import { ConfigError, getConfig, type DataMode } from "@/lib/env";
import { securityPageFor } from "@/lib/auth/redirect";
import { clinicLandingRoute } from "@/lib/auth/destination";
import { clinicAccessFor } from "@/lib/auth/clinic-access";

export interface Membership {
  membershipId: string;
  clinicId: string;
  clinicName: string;
  clinicTimezone: string;
  role: string;
  status: string;
  validUntil: string | null;
  capabilities: string[];
}
export interface MyContext {
  profileId: string;
  displayName: string;
  locale: string;
  status: string;
  /** The account was created without a name (0037); the app asks for one. */
  needsName?: boolean;
  mfa: boolean;
  demoMode: boolean;
  memberships: Membership[];
}
export interface Viewer {
  rpc: RpcClient;
  session: SessionInfo | null;
  ctx: MyContext | null;
  mode: DataMode;
}

/**
 * Server-component access to the same authenticated command surface the API uses. Never trusts client state.
 * Memoized per request with React `cache`: the root layout, the clinic layout and the page share one Auth lookup and
 * one `get_my_context` read. The scope is a single request, so nothing is shared between users or requests.
 */
export const getViewer = cache(async (): Promise<Viewer> => {
  const cfg = getConfig();
  const rpc = await getRpcClient(randomUUID());
  const session = await rpc.session();
  const context = session ? await rpc.rpc<MyContext>("get_my_context") : null;
  const ctx = context?.status === "active" ? context : null;
  return { rpc, session, ctx, mode: cfg.mode };
});

export async function requireViewer(): Promise<Viewer & { session: SessionInfo; ctx: MyContext }> {
  const v = await getViewer();
  if (!v.session || !v.ctx) redirect("/sign-in");
  return v as Viewer & { session: SessionInfo; ctx: MyContext };
}

/**
 * Clinic pages: the URL clinic must be one the viewer holds an ACTIVE membership for (the DB re-checks every command).
 * Every clinic read needs a satisfied second sign-in step (`private.mfa_ok()`), so staff without it are sent to finish it
 * instead of meeting a server-error page; after the second step they return to their role's start page at this clinic
 * (the bare clinic page is "Find or register", which an administrator or health worker cannot use).
 */
export async function requireClinicStaff(clinicId: string) {
  const v = await requireViewer();
  // Every active role the person holds at this clinic, merged: the database authorizes on their union (audit F09).
  const m = clinicAccessFor(v.ctx.memberships, clinicId);
  if (!m) redirect("/clinic");
  if (v.ctx.mfa !== true) redirect(securityPageFor(clinicLandingRoute(clinicId, m.capabilities)));
  return { ...v, membership: m };
}

export { AppError, ConfigError };
