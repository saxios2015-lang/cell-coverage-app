import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [eu2Set, setEu2Set] = useState(new Set());
  const [us2Set, setUs2Set] = useState(new Set());

  // Load IMSI_data_tg3.csv once when the page loads
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then((r) => r.text())
      .then((text) => {
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
      .catch(() => console.log("Could not load IMSI CSV"));
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5 || isNaN(zip)) return;

    setLoading(true);
    setResult(null);

    let hasTg3Support = false;
    let providers = [];
    let counties = [];

    try {
      // 1. OpenCelliD towers
      const ocidRes = await fetch(`/api/cells?zip=${zip}`, { cache: "no-store" });
      let cells = [];
      if (ocidRes.ok) {
        try {
          const j = await ocidRes.json();
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

      // If we already know it works → stop here
      if (hasTg3Support) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have service in this ZIP",
          towers: cells.length,
        });
        setLoading(false);
        return;
      }

      // 2. FCC fallback via Render
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fccRes.ok) {
        const data = await fccRes.json();
        providers = data.providers || [];
        counties = data.counties || [];

        // Simple name-based check for supported networks
        const names = providers.map((p) => (p.provider_name || "").toLowerCase());
        if (
          names.some(
            (n) =>
              n.includes("at&t") ||
              n.includes("verizon") ||
              n.includes("t-mobile") ||
              n.includes("us cellular") ||
              n.includes("gci")
          )
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

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>TG3 ZIP Coverage Checker</h1>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 12, margin: "30px 0" }}>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value.replace(/\D/g, "").slice(0, 5))}
          placeholder="Enter 5-digit ZIP"
          style={{ padding: 12, fontSize: 18, borderRadius: 8, border: "1px solid #ccc", width: 240 }}
        />
        <button
          type="submit"
          disabled={loading || zip.length !== 5}
          style={{
            padding: "12px 32px",
            fontSize: 18,
            background: "#0070f3",
            color: "white",
            border: "none",
            borderRadius: 8,
            cursor: "pointer",
          }}
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {result && (
        <div
          style={{
            fontSize: 24,
            fontWeight: "bold",
            margin: "40px 0 20px",
            color: result.supported ? "#0a9928" : "#c22",
          }}
        >
          {result.message}
        </div>
      )}

      {result?.providers?.length > 0 && (
        <div>
          <h3>Providers found in {zip} (FCC data)</h3>
          {result.counties?.length > 0 && <p><strong>County:</strong> {result.counties.join(", ")}</p>}
          <ul style={{ lineHeight: 1.6 }}>
            {result.providers.map((p, i) => (
              <li key={i}>
                {p.provider_name || "Unknown"} {p.provider_id && `(${p.provider_id})`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
