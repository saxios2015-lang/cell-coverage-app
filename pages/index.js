import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [eu2Set, setEu2Set] = useState(new Set());
  const [us2Set, setUs2Set] = useState(new Set());

  // Load IMSI CSV once
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then((r) => r.text())
      .then((text) => {                     // ← this block is now NOT empty
        const eu2 = new Set();
        const us2 = new Set();
        const lines = text.split("\n");

        for (const line of lines) {
          const cols = line.split(",");
          if (cols.length < 7) continue;
          const plmn = cols[0]?.trim();
          const imsiProvider = cols[6]?.trim();

          if (plmn && plmn.length === 5) {
            if (imsiProvider === "EU 2") eu2.add(plmn);
            if (imsiProvider === "US 2") us2.add(plmn);
          }
        }
        setEu2Set(eu2);
        setUs2Set(us2);
      })
      .catch((e) => console.log("CSV load failed", e)));
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5) return;

    setLoading(true);
    setResult(null);

    let hasTg3Support = false;
    let providers = [];
    let counties = [];

    try {
      // OpenCelliD towers
      const ocid = await fetch(`/api/cells?zip=${zip}`, { cache: "no-store" });
      let cells = [];
      if (ocid.ok) {
        try {
          const j = await ocid.json();
          cells = Array.isArray(j.cells) ? j.cells : [];
        } catch {}
      }

      if (cells.length > 0) {
        for (const c of cells) {
          if (c.mcc && c.mnc) {
            const plmn = `${c.mcc}${String(c.mnc).padStart(3, "0")}`;
            if (eu2Set.has(plmn) || us2Set.has(plmn)) {
              hasTg3Support = true;
              break;
            }
          }
        }
      }

      if (hasTg3Support) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have service in this ZIP",
        });
        setLoading(false);
        return;
      }

      // FCC fallback
      const fcc = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fcc.ok) {
        const data = await fcc.json();
        providers = data.providers || [];
        counties = data.counties || [];

        // quick name-based check (can be refined later)
        const lowerNames = providers.map(p => (p.provider_name || "").toLowerCase());
        if (
          lowerNames.some(n => n.includes("at&t") || n.includes("verizon") || n.includes("t-mobile") || n.includes("us cellular") || n.includes("gci"))
        ) {
          hasTg3Support = true;
        }
      }
    } catch (err) {
      console.error(err);
    }

    setResult({
      supported: hasTg3Support,
      message: hasTg3Support
        ? "Great news! Your TG3 will have service in this ZIP"
        : "Unfortunately your TG3 won’t have coverage in this ZIP",
      providers,
      counties,
    });

    setLoading(false);
  };

  // UI stays exactly the same as the last working version you liked
  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>TG3 ZIP Coverage Checker</h1>
      {/* rest of your UI – unchanged */}
      {/* (copy the return block from the previous working version if you want the exact same look) */}
    </main>
  );
}
