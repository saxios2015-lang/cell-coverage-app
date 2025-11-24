import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [supportedPlmns, setSupportedPlmns] = useState(new Set());

  // Load your IMSI list once
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then((r) => r.text())
      .then((text) => {
        const set = new Set();
        const lines = text.split("\n");
        for (const line of lines) {
          const cols = line.split(",");
          if (cols.length < 7) continue;
          const plmn = cols[0]?.trim();
          const group = cols[6]?.trim();
          if (plmn && plmn.length === 5 && (group === "EU 2" || group === "US 2")) {
            set.add(plmn);
          }
        }
        setSupportedPlmns(set);
      });
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5 || isNaN(zip)) return;

    setLoading(true);
    setResult(null);

    let hasTg3Coverage = false;
    let fccProviders = [];
    let fccCounties = [];

    try {
      // 1. OpenCelliD — only 4G + supported IMSI = success
      const ocidRes = await fetch(`/api/cells?zip=${zip}`, { cache: "no-store" });
      let cells = [];
      if (ocidRes.ok) {
        try {
          const j = await ocidRes.json();
          cells = Array.isArray(j.cells) ? j.cells : [];
        } catch {}
      }

      for (const cell of cells) {
        const is4G = cell.radio === "LTE" || cell.radio === "LTECATM";
        if (!is4G) continue;

        if (cell.mcc && cell.mnc) {
          const plmn = `${cell.mcc}${String(cell.mnc).padStart(3, "0")}`;
          if (supportedPlmns.has(plmn)) {
            hasTg3Coverage = true;
            break;
          }
        }
      }

      // If we found 4G + supported → we're done
      if (hasTg3Coverage) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have coverage in this ZIP",
        });
        setLoading(false);
        return;
      }

      // 2. No TG3 coverage → fall back to FCC to show who IS there
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fccRes.ok) {
        const data = await fccRes.json();
        fccProviders = data.providers || [];
        fccCounties = data.counties || [];
      }
    } catch (err) {
      console.error(err);
    }

    setResult({
      supported: false,
      message: "Likely no coverage for TG3 in your area",
      providers: fccProviders,
      counties: fccCounties,
    });

    setLoading(false);
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>TG3 Coverage Checker</h1>

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
        <>
          <div
            style={{
              fontSize: 26,
              fontWeight: "bold",
              margin: "40px 0 20px",
              color: result.supported ? "#0a9928" : "#d32f2f",
            }}
          >
            {result.message}
          </div>

          {result.providers?.length > 0 && (
            <div>
              <h3>Providers in {zip} (but not supported by TG3)</h3>
              {result.counties?.length > 0 && <p><strong>County:</strong> {result.counties.join(", ")}</p>}
              <ul style={{ lineHeight: 1.7 }}>
                {result.providers.map((p, i) => (
                  <li key={i}>
                    {p.provider_name || "Unknown provider"} {p.provider_id && `(${p.provider_id})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </main>
  );
}
