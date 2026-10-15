import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";
import { Building2, HelpCircle, MessageSquare, UserRound, Users, type LucideIcon } from "lucide-react";
import { ConfigError, getViewer, type Viewer } from "@/lib/server/viewer";
import { AppError } from "@/lib/api/errors";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceNavLink } from "@/components/workspace-nav-link";
import { ProfileMenu } from "@/components/profile-menu";
import { HeaderHeight } from "@/components/header-height";
import { AppToaster } from "@/components/toaster";
import { SignOutButton } from "@/components/sign-out-button";
import { StaffIdleSignOut } from "@/components/staff-idle-sign-out";
import { ScrollShadow } from "@/components/scroll-shadow";
import { clinicLandingRoute } from "@/lib/auth/destination";
import { activeClinicAccess } from "@/lib/auth/clinic-access";
import { BrandLogo } from "@/components/brand";
import { PublicNav } from "@/components/public-nav";
import { SiteFooter } from "@/components/site-footer";

export const metadata: Metadata = {
  title: { default: "eVacTrack — Children's Vaccination Records", template: "%s · eVacTrack" },
  description: "Children's vaccination records and scheduling, shared between community health centers and families.",
  applicationName: "eVacTrack",
  metadataBase: publicOrigin(),
  robots: { index: false, follow: false },
  openGraph: { siteName: "eVacTrack", type: "website", locale: "en_PH" },
  twitter: { card: "summary_large_image" },
};

/** Absolute base for social-card URLs: the canonical public address when configured, otherwise the local origin. */
function publicOrigin(): URL {
  try {
    return new URL(process.env.CVSRS_PUBLIC_URL ?? "http://127.0.0.1:3000");
  } catch {
    return new URL("http://127.0.0.1:3000");
  }
}
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0648ef" };

export const dynamic = "force-dynamic";

async function safeViewer(): Promise<{ viewer: Viewer | null; configError: string | null }> {
  try {
    return { viewer: await getViewer(), configError: null };
  } catch (e) {
    // Configuration detail (it can name environment variables) goes to the server log only, never to the page (SEC-06).
    const detail = e instanceof Error ? e.message : String(e);
    if (e instanceof ConfigError || (e instanceof AppError && e.code === "misconfigured")) {
      console.error("[layout] configuration error:", detail);
      return { viewer: null, configError: "The service is not configured. Please contact the clinic or try again later." };
    }
    console.error("[layout] viewer unavailable:", detail);
    return { viewer: null, configError: "Please try again in a few minutes." };
  }
}

interface HeaderLink {
  href: string;
  label: string;
  Icon: LucideIcon;
  ariaLabel?: string;
  badge?: string | null;
  accent?: boolean;
}

/** One sidebar destination; the unread count is named only by aria-label (UI-01). */
function HeaderNavLink({ link }: { link: HeaderLink }) {
  const { Icon } = link;
  return (
    <WorkspaceNavLink href={link.href} label={link.ariaLabel}>
      <Icon aria-hidden className="size-4 shrink-0" />
      <span>{link.label}</span>
      {link.badge ? (
        <span aria-hidden className="tnum ml-1 inline-flex items-center rounded-full bg-primary px-2 py-0.5 text-xs font-bold text-on-primary">
          {link.badge}
        </span>
      ) : null}
    </WorkspaceNavLink>
  );
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const { viewer, configError } = await safeViewer();
  // One entry per clinic, merging every active role held there (audit F09).
  const staff = viewer?.ctx ? activeClinicAccess(viewer.ctx.memberships) : [];
  const firstClinic = staff[0]?.clinicId;
  const firstClinicRoute = staff[0] ? clinicLandingRoute(staff[0].clinicId, staff[0].capabilities) : "/clinic";
  const unread = viewer?.session ? await viewer.rpc.rpc<{ unread: number }>("my_messages", { p_limit: 1 }).catch(() => null) : null;
  const userInitial = viewer?.ctx?.displayName?.[0]?.toUpperCase() || viewer?.session?.email?.[0]?.toUpperCase() || "U";
  // The proxy sets x-nonce with the per-request CSP; next-themes needs it for its pre-paint script (UI-09).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const unreadBadge = unread && unread.unread > 0 ? (unread.unread > 99 ? "99+" : String(unread.unread)) : null;
  const links: HeaderLink[] = viewer?.session
    ? [
      ...(firstClinic
        ? [{ href: staff.length === 1 ? firstClinicRoute : "/clinic", label: staff.length === 1 && staff[0]?.roles.every(role => role === "tech_admin") ? "Admin console" : "Clinic workspace", Icon: Building2, accent: true }]
        : [{ href: "/children", label: "My Children", Icon: Users }, { href: "/help", label: "Care Info", Icon: HelpCircle }]),
      {
        href: "/messages",
        label: "Messages",
        Icon: MessageSquare,
        ariaLabel: !unread ? "Messages, unread count unavailable" : unread.unread > 0 ? `Messages, ${unread.unread} unread` : undefined,
        badge: unreadBadge,
      },
      { href: "/account", label: "Account", Icon: UserRound },
    ]
    : [];

  return (
    <html lang="en" suppressHydrationWarning className="font-sans light" data-scroll-behavior="smooth">
      <body className="flex min-h-screen flex-col bg-canvas text-ink">
        <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem={false} nonce={nonce}>
          <ScrollShadow />
          <HeaderHeight />
          <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-xl focus:bg-surface focus:px-4 focus:py-2.5 focus:shadow-lg focus:ring-2 focus:ring-primary">
            Skip to main content
          </a>


          <header data-site-header="" className="sticky top-0 z-40 border-b border-line glass-header">
            <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2 sm:px-6">
              <Link href="/" aria-label="eVacTrack home" className="site-brand inline-flex min-h-11 shrink-0 items-center text-[1.875rem] no-underline sm:text-[2.125rem]">
                <BrandLogo />
              </Link>

              {viewer?.session ? (
                <ProfileMenu name={viewer.ctx?.displayName || viewer.session.email || "Your account"} initial={userInitial} />
              ) : <PublicNav />}
            </div>
          </header>

          <div data-workspace-frame className={`mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8${viewer?.session ? " lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8" : ""}`}>
          {viewer?.session ? <WorkspaceSidebar clinics={staff.map(({ clinicId, clinicName, roles, capabilities }) => ({ clinicId, clinicName, roles, capabilities }))} unread={unread ? unread.unread : null}>
            <ul className="grid gap-1">
              {links.filter(link => !firstClinic || !link.accent).map(link => <li key={link.href}><HeaderNavLink link={link} /></li>)}
            </ul>
            <div className="mt-5 border-t border-line pt-4"><SignOutButton inline /></div>
          </WorkspaceSidebar> : null}
          <main id="main" tabIndex={-1} className="relative z-10 min-w-0">
            {configError ? (
              <div role="alert" className="rounded-card border border-danger bg-danger-bg p-6 text-danger">
                <p className="text-lg font-bold">The service is temporarily unavailable.</p>
                <p className="mt-1 text-sm text-ink">{configError}</p>
              </div>
            ) : (
              <>
                {viewer?.ctx?.needsName ? (
                  <div role="status" className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-card border border-attention bg-attention-bg px-4 py-3 text-sm text-attention">
                    <span className="font-semibold">Add your full name so the clinic can recognise you.</span>
                    <Link href="/account" className="inline-flex min-h-11 items-center font-bold underline">Add my name</Link>
                  </div>
                ) : null}
                {children}
              </>
            )}
          </main>
          </div>

          <SiteFooter signedIn={Boolean(viewer?.session)} />
          <AppToaster />
          {viewer?.session && staff.length > 0 ? <StaffIdleSignOut /> : null}
        </ThemeProvider>
      </body>
    </html>
  );
}
