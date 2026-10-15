import { z } from "zod";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour time, for example 08:30.");
const optText = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const sessionBody = z
  .object({
    serviceDate: z.iso.date(),
    startTime: time,
    endTime: time,
    serviceCode: optText(40),
    totalCapacity: z.number().int().min(0).max(1000),
    onlineCapacity: z.number().int().min(0).max(1000),
    walkinCapacity: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((s) => s.onlineCapacity + s.walkinCapacity <= s.totalCapacity, { message: "Online plus walk-in places cannot be more than the total.", path: ["totalCapacity"] })
  .refine((s) => s.endTime > s.startTime, { message: "The session must end after it starts.", path: ["endTime"] });

export const cancelSessionBody = z.object({ reason: z.string().trim().min(3, "Give a short reason.").max(500) }).strict();
export const bookBody = z.object({ childId: z.uuid(), sessionId: z.uuid(), reason: optText(300), ruleCodes: z.array(z.string().trim().min(1).max(60)).max(10).default([]) }).strict();
export const cancelAppointmentBody = z.object({ reason: optText(300) }).strict();
export const rescheduleBody = z.object({ newSessionId: z.uuid(), reason: optText(300) }).strict();

export const checkInBody = z.object({ childId: z.uuid(), appointmentId: z.uuid().optional(), overflowReason: optText(300) }).strict();
export const QUEUE_STATES = ["waiting", "called", "in_service", "completed", "held", "left", "cancelled", "deferred"] as const;
export const transitionBody = z
  .object({
    to: z.enum(QUEUE_STATES),
    expectedVersion: z.number().int().positive(),
    station: optText(40),
    reason: optText(300),
    outcome: z.enum(["vaccinated", "deferred", "referred", "no_service"]).optional(),
  })
  .strict();
export const callNextBody = z.object({ station: z.string().trim().min(1, "Enter your station.").max(40) }).strict();
export const priorityBody = z.object({ priority: z.enum(["routine", "priority"]), reason: optText(300) }).strict();

/** Close a past service day (0037). The database refuses today and future dates. */
export const closeDayBody = z.object({ serviceDate: z.iso.date("Choose the day to close.") }).strict();
export const capacityBody = z
  .object({
    expectedVersion: z.number().int().positive(),
    totalCapacity: z.number().int().min(0).max(1000),
    onlineCapacity: z.number().int().min(0).max(1000),
    walkinCapacity: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine((s) => s.onlineCapacity + s.walkinCapacity <= s.totalCapacity, { message: "Online plus walk-in places cannot be more than the total.", path: ["totalCapacity"] });
