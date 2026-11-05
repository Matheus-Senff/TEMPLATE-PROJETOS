import { ImageResponse } from "next/og";
import { site } from "@/lib/site";

export const alt = site.name;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Default share image (WhatsApp, LinkedIn, X). Pages can export their own opengraph-image. */
export default function OpengraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#0a0a0a",
        color: "#fafafa",
      }}
    >
      <div style={{ fontSize: 72, fontWeight: 700 }}>{site.name}</div>
      <div style={{ fontSize: 32, marginTop: 24, color: "#a3a3a3" }}>{site.description}</div>
    </div>,
    size,
  );
}
