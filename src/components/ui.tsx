import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleHelp, Clock, Info, SearchCheck, ShieldCheck } from "lucide-react";
import "./application.css";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/** A stable surface for records and forms. */
export function Card({ children, className, interactive, ...rest }: ComponentProps<"section"> & { interactive?: boolean }) {
  return (
    <section
      className={cx(
        "app-card rounded-card border border-line bg-surface p-5 sm:p-6",
        interactive && "card-elevated card-interactive cursor-pointer",
        className
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/** Unboxed page section with an icon-accented title. */
export function Section({ title, id, description, action, children, className, panel = false }: { title: string; id: string; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; panel?: boolean }) {
  return (
    <section aria-labelledby={id} className={cx("app-section", panel ? "rounded-card border border-line bg-surface p-5 sm:p-7" : "mt-8 border-t border-line pt-8", className)}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <h2 id={id} className="text-xl font-bold text-ink">
            {title}
          </h2>
          {description ? <p className="mt-1.5 max-w-prose text-sm text-ink-soft">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function PageTitle({ title, lead, action, badge, dashboard = false }: { title: string; lead?: ReactNode; action?: ReactNode; badge?: string; dashboard?: boolean }) {
  return (
    <div className={cx("app-page-title mb-8 flex flex-wrap items-start justify-between gap-5", dashboard ? "pb-2" : "border-b border-line pb-6")}>
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        {badge ? (
          <span className="mb-2.5 inline-flex items-center gap-1.5 text-xs font-semibold text-primary-strong">
            <ShieldCheck aria-hidden className="size-3.5 text-primary" />
            {badge}
          </span>
        ) : null}
        <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h1>
        {lead ? <p className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft">{lead}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group mb-6 inline-flex min-h-11 items-center gap-2 rounded-control px-3 py-1.5 text-sm font-semibold text-primary-strong hover:bg-primary-soft">
      <ArrowLeft aria-hidden className="size-4 transition-transform group-hover:-translate-x-1" />
      {children}
    </Link>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "danger" | "quiet";
  pending?: boolean;
  icon?: ReactNode;
};

const variants = {
  primary: "border-primary bg-primary text-on-primary shadow-xs hover:bg-primary-strong hover:shadow-md hover:text-on-primary dark:hover:text-primary-dark",
  secondary: "border-line-strong bg-surface text-ink hover:bg-sunken hover:border-line-strong hover:shadow-xs",
  danger: "border-danger bg-danger-bg text-danger hover:bg-danger/10 hover:border-danger hover:shadow-xs focus:ring-danger/25",
  quiet: "border-transparent bg-transparent text-primary-strong hover:bg-primary-soft underline-offset-4 hover:underline",
};

export function Button({ variant = "primary", className, type = "button", pending, icon, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending ? "true" : undefined}
      className={cx(
        "inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-4 py-2.5 text-sm font-semibold transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {pending ? (
        <span className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
      ) : icon ? (
        <span className="shrink-0" aria-hidden="true">{icon}</span>
      ) : null}
      {children}
    </button>
  );
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: "primary" | "secondary"; className?: string }) {
  return (
    <Link href={href} className={cx("inline-flex min-h-11 items-center justify-center gap-2 rounded-control border px-5 py-2.5 text-sm font-semibold no-underline transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out active:scale-[0.97]", variants[variant], className)}>
      {children}
    </Link>
  );
}

const control =
  "block min-h-11 w-full rounded-control border border-line-strong bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-soft hover:border-primary focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/25 focus:shadow-[0_0_0_3px_var(--color-primary-soft)] transition-colors duration-150 aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/20 disabled:bg-sunken disabled:text-ink-soft";

export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: string; error?: string; children: ReactNode }) {
  return (
    <div className="mb-5">
      <label htmlFor={id} className="mb-1.5 block text-sm font-bold text-ink">
        {label}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mb-2 text-sm text-ink-soft">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-danger">
          <AlertTriangle aria-hidden className="size-4 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, hint?: string, error?: string) => [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;

export function TextField({ id, label, hint, error, ...rest }: { id: string; label: string; hint?: string; error?: string } & Omit<ComponentProps<"input">, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <input id={id} className={control} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest} />
    </Field>
  );
}

export function SelectField({ id, label, hint, error, children, ...rest }: { id: string; label: string; hint?: string; error?: string } & Omit<ComponentProps<"select">, "id">) {
  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <select id={id} className={control} aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, hint, error)} {...rest}>
        {children}
      </select>
    </Field>
  );
}

type Tone = "success" | "attention" | "danger" | "review" | "info" | "neutral";
const tones: Record<Tone, { box: string; Icon: typeof Info }> = {
  success: { box: "border-success bg-success-bg text-success", Icon: CheckCircle2 },
  attention: { box: "border-attention bg-attention-bg text-attention", Icon: Clock },
  danger: { box: "border-danger bg-danger-bg text-danger", Icon: AlertTriangle },
  review: { box: "border-review bg-review-bg text-review", Icon: SearchCheck },
  info: { box: "border-info bg-info-bg text-info", Icon: Info },
  neutral: { box: "border-line-strong bg-sunken text-ink", Icon: CircleHelp },
};

/** Status chip with dual-tinted styling and icons. */
export function StatusChip({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { box, Icon } = tones[tone];
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-control border px-2.5 py-1 text-xs font-semibold leading-snug", box)}>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {children}
    </span>
  );
}

/** Inline callout notice. */
export function Notice({ tone = "info", title, children, role }: { tone?: Tone; title?: string; children?: ReactNode; role?: "status" | "alert" }) {
  const { box, Icon } = tones[tone];
  return (
    <div role={role} className={cx("mb-5 flex gap-3.5 rounded-card border p-4 shadow-2xs", box)}>
      <Icon aria-hidden className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 text-sm">
        {title ? <p className="font-bold leading-snug">{title}</p> : null}
        {children ? <div className="mt-0.5 leading-relaxed">{children}</div> : null}
      </div>
    </div>
  );
}

export function ResultRegion({ children }: { children?: ReactNode }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {children}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-sunken px-6 py-8 text-center">
      <div className="mx-auto mb-3 flex size-12 items-center justify-center rounded-full bg-surface text-ink-soft shadow-xs">
        <CircleHelp aria-hidden className="size-6" />
      </div>
      <p className="font-bold text-ink">{title}</p>
      {children ? <div className="mt-1.5 mx-auto max-w-prose text-sm text-ink-soft">{children}</div> : null}
    </div>
  );
}

/** Always-visible identity banner for a child's record. */
export function ChildBanner({ name, recordNo, meta, chips, sticky }: { name: string; recordNo: string; meta?: ReactNode; chips?: ReactNode; sticky?: boolean }) {
  return (
    <div
      role="region"
      aria-label="Child identity"
      className={cx(
          "mb-6 rounded-card border border-line bg-surface p-5 sm:p-6",
        sticky && "sm:sticky sm:top-[calc(var(--header-h)+1rem)] sm:z-20"
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div>
          <h1 className="break-words text-2xl font-bold text-ink sm:text-3xl">{name}</h1>
        </div>
          <p className="tnum break-all text-sm font-semibold text-ink-soft">
          Record #{recordNo}
        </p>
      </div>
      {meta ? <p className="mt-2 text-sm text-ink-soft">{meta}</p> : null}
      {chips ? <div className="mt-3.5 flex flex-wrap gap-2">{chips}</div> : null}
    </div>
  );
}

export const recordStatusChip = (s: string) =>
  s === "active" ? <StatusChip tone="success">Verified Record</StatusChip> : s === "provisional" ? <StatusChip tone="review">Awaiting Verification</StatusChip> : s === "inactive" ? <StatusChip tone="neutral">Inactive record</StatusChip> : <StatusChip tone="neutral">{s}</StatusChip>;

export const relationshipChip = (s: string) =>
  s === "active" ? <StatusChip tone="success">Verified Guardian</StatusChip> : s === "provisional" ? <StatusChip tone="review">Pending Verification</StatusChip> : s === "suspended" ? <StatusChip tone="attention">Access Paused</StatusChip> : <StatusChip tone="neutral">{s}</StatusChip>;
