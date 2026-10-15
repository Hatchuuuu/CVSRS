import { ImageResponse } from "next/og";
import { MARK_E, MARK_STROKE, MARK_V } from "@/components/brand";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon: the eVacTrack mark on its blue tile (iOS rounds the corners itself). */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#0648ef" }}>
        <svg width="180" height="180" viewBox="0 0 40 40">
          <path d={MARK_E} fill="none" stroke="#ffffff" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
          <path d={MARK_V} fill="none" stroke="#a9c8ff" strokeWidth={MARK_STROKE} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    ),
    size,
  );
}
