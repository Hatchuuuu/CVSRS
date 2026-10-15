import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { getViewer } from "@/lib/server/viewer";
import { DisplayBoard, type DisplayData } from "./board";

export const metadata: Metadata = { title: "Waiting room display" };

// Waiting-room screen. Public by design and therefore deliberately limited to ticket numbers and stations (BP17).
export default async function Display({ params }: { params: Promise<{ clinicId: string }> }) {
  const { clinicId } = await params;
  if (!z.uuid().safeParse(clinicId).success) notFound();
  const { rpc } = await getViewer();
  const data = await rpc.rpc<DisplayData>("public_queue_display", { p_clinic_id: clinicId });
  if (!data) notFound();
  return <DisplayBoard clinicId={clinicId} initial={data} />;
}
