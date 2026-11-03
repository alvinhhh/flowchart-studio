import { ImageResponse } from "next/og";

export const dynamic = "force-static";
export const alt = "Flowchart Studio — free flowchart editor with a branching example diagram";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", display: "flex", background: "#f5f5f2", color: "#202120", fontFamily: "sans-serif" }}>
      <div style={{ display: "flex", position: "absolute", left: 56, top: 57, alignItems: "center", gap: 14 }}>
        <svg width="42" height="42" viewBox="0 0 42 42">
          <rect x="1" y="1" width="40" height="40" rx="11" fill="#202120" />
          <path d="m21 11 10 10-10 10-10-10Z" fill="none" stroke="#fff" strokeWidth="2" />
        </svg>
        <span style={{ fontSize: 24, letterSpacing: -0.7 }}>flowchart.lol</span>
      </div>
      <div style={{ display: "flex", position: "absolute", left: 56, top: 190, flexDirection: "column" }}>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 78, fontWeight: 700, letterSpacing: -5, lineHeight: 1.04 }}>
          <span>Flowchart</span><span>Studio</span>
        </div>
        <span style={{ fontSize: 26, color: "#62645f", marginTop: 28, letterSpacing: -0.6 }}>Free flowchart editor.</span>
      </div>
      <span style={{ display: "flex", position: "absolute", left: 57, bottom: 58, fontSize: 20, color: "#62645f" }}>No account. No ads.</span>
      <div style={{ display: "flex", position: "absolute", left: 528, top: 54, width: 616, height: 522, background: "white", border: "1px solid #dedfd9", borderRadius: 20, boxShadow: "0 14px 32px rgba(24, 28, 20, 0.07)", overflow: "hidden" }}>
        <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: "100%", height: 57, alignItems: "center", padding: "0 23px", borderBottom: "1px solid #ebebe6", gap: 11 }}>
          <svg width="20" height="20" viewBox="0 0 20 20"><path d="m10 2 8 8-8 8-8-8Z" fill="none" stroke="#8d9187" strokeWidth="1.6" /></svg>
          <span style={{ fontSize: 17, color: "#4a4e45" }}>Example diagram</span>
          <span style={{ marginLeft: "auto", fontSize: 15, color: "#93978e" }}>100%</span>
        </div>
        <div style={{ display: "flex", position: "absolute", top: 57, width: 616, height: 465 }}>
          <svg width="616" height="465" viewBox="0 0 616 465" style={{ position: "absolute" }}>
            <defs><pattern id="dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1" fill="#e2e4dc" /></pattern></defs>
            <rect width="616" height="465" fill="url(#dots)" />
            <g fill="none" stroke="#8c9185" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M295 86V132M295 188V220M295 332V382" />
              <path d="M391 276H497Q509 276 509 264V172Q509 160 497 160H393" />
            </g>
            <g fill="#8c9185"><path d="m289 124 6 8 6-8Z" /><path d="m289 212 6 8 6-8Z" /><path d="m289 374 6 8 6-8Z" /><path d="m401 154-8 6 8 6Z" /></g>
            <rect x="215" y="42" width="160" height="44" rx="22" fill="#fff" stroke="#72786c" strokeWidth="1.8" />
            <rect x="197" y="132" width="196" height="56" rx="7" fill="#fff" stroke="#72786c" strokeWidth="1.8" />
            <path d="m295 220 96 56-96 56-96-56Z" fill="#292d26" />
            <rect x="215" y="382" width="160" height="44" rx="22" fill="#eef1e9" stroke="#72786c" strokeWidth="1.8" />
          </svg>
          <span style={{ display: "flex", position: "absolute", left: 215, top: 42, width: 160, height: 44, alignItems: "center", justifyContent: "center", fontSize: 22 }}>Start</span>
          <span style={{ display: "flex", position: "absolute", left: 197, top: 132, width: 196, height: 56, alignItems: "center", justifyContent: "center", fontSize: 23 }}>Add steps</span>
          <span style={{ display: "flex", position: "absolute", left: 199, top: 220, width: 192, height: 112, alignItems: "center", justifyContent: "center", fontSize: 23, color: "#fff" }}>Ready?</span>
          <span style={{ display: "flex", position: "absolute", left: 215, top: 382, width: 160, height: 44, alignItems: "center", justifyContent: "center", fontSize: 22 }}>Export</span>
          <span style={{ display: "flex", position: "absolute", left: 310, top: 343, fontSize: 17, color: "#6a7064", background: "white", padding: "0 4px" }}>Yes</span>
          <span style={{ display: "flex", position: "absolute", left: 439, top: 246, fontSize: 17, color: "#6a7064", background: "white", padding: "0 4px" }}>No</span>
          <svg width="35" height="42" viewBox="0 0 35 42" style={{ position: "absolute", left: 378, top: 182 }}>
            <path d="M3 2 30 24 18 26 12 38Z" fill="white" stroke="#292d26" strokeWidth="2.2" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
    </div>,
    size,
  );
}
