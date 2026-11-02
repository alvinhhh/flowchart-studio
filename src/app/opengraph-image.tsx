import { ImageResponse } from "next/og";
import { PRODUCT } from "@/lib/config";

export const alt = `${PRODUCT.name} — free programming flowchart maker`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(<div style={{ background: "#fff", width: "100%", height: "100%", display: "flex", flexDirection: "column", padding: "70px 82px", color: "#171717", fontFamily: "sans-serif" }}><div style={{ display: "flex", fontSize: 26, paddingBottom: 38, borderBottom: "1px solid #ddd" }}>{PRODUCT.name}</div><div style={{ display: "flex", fontSize: 66, letterSpacing: -3, lineHeight: 1.1, marginTop: 62, maxWidth: 870 }}>Free programming flowchart maker</div><div style={{ display: "flex", fontSize: 24, color: "#666", marginTop: 34 }}>Branches. Loops. Local saves. JSON and PNG export.</div><div style={{ display: "flex", fontSize: 20, marginTop: 48 }}>No account required.</div></div>, size);
}
