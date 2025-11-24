import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  // These will be filled once at startup
  const [supportedEu2, setSupportedEu2] = useState<Set<string>>(new Set());
  const [supportedUs2, setSupportedUs2] = useState<Set<string>>(new Set());

  // Load the CSV once when the page loads
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then((r) => r.text())
      .then((text) => {
        const lines = text.split("\n");
        const eu2 = new Set<string>();
        const us2 = new Set<string>();

        for (const line of lines) {
          const cols = line.split(",");
          if (cols.length < 7) continue;
          const plmn = cols[0].trim();
          const imsiProvider = cols[6]?.trim();

          if (!plmn || plmn.length !== 5) continue;

          if (imsiProvider === "EU 2") eu2.add(plmn);
          if (imsiProvider === "US 2") us2.add(plmn);
        }

        setSupportedEu2(eu2);
        setSupportedUs2(us2);
      });
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!zip.trim()) return;

    setLoading(true);
    setResult(null);

    try {
      // 1. Try OpenCelliD
      const ocidRes = await fetch(`/api/cells?zip=${zip}`, { cache: "no-store" });
      let cells: any[] = [];
      if (ocidRes.ok) {
        try {
          const j = await ocidRes.json();
          cells = Array.isArray(j?.cells) ? j.cells : [];
        } catch {}
      }

      // Check if any tower matches our supported IMSI groups
      let hasTg3Support = false;
      if (cells.length > 0) {
        for (const c of cells) {
          if (!c.mcc || !c.mnc) continue;
          const plmn = `${c.mcc}${String(c.mnc).padStart(3, "0")}`;
          if (supportedEu2.has(plmn) || supportedUs2.has(plmn)) {
            hasTg3Support = true;
            break;
          }
        }
      }

      if (hasTg3Support) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have service in this ZIP",
          towers: cells.length,
          providers: [],
        });
        setLoading(false);
        return;
      }

      // 2. No towers or no match → fall back to our Render FCC fallback
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (!fccRes.ok) {
        setResult({
          supported: false,
          message: "Unfortunately your TG3 won’t have coverage in this ZIP",
        });
        setLoading(false);
        return;
      }

      const data = await fccRes.json();

      // Check if any of the returned providers belongs to EU2 or US2
      for (const p of data.providers) {
        const name = p.provider_name?.toLowerCase() || "";
        // Very rough name matching – you can improve later
        const matched = Array.from(supportedEu2).concat(Array.from(supportedUs2))
          .some(plmn => {
            const row = lines.find(l => l.startsWith(plmn));
            if (!row) return false;
            const operator = row.split(",")[5]?.toLowerCase() || "";
            return operator.includes(name) || name.includes(operator);
          });
        if (matched) {
          hasTg3Support = true;
          break;
        }
      }

      setResult({
        supported: hasTg3Support,
        message: hasTg3Support
          ? "Great news! Your TG3 will have service in this ZIP"
          : "Unfortunately your TG3 won’t have coverage in this ZIP",
        providers: data.providers || [],
        counties: data.counties || [],
      });

    } catch (err) {
      setResult({
        supported: false,
        message: "Something went wrong – try again",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>ZIP Coverage Check for TG3</h1>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 10, marginBottom: 30 }}>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Enter 5-digit ZIP"
          maxLength={5}
          style={{ padding: 12, fontSize: 18, borderRadius: 8, border: "1px solid #ccc", width: 200 }}
        />
        <button
          type="submit"
          disabled={loading || zip.length !== 5}
          style={{
            padding: "12px 24px",
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
        <div style={{ fontSize: 20, fontWeight: "bold", marginBottom: 20, color: result.supported ? "green" : "red" }}>
          {result.message}
        </div>
      )}

      {result?.providers?.length > 0 && (
        <div>
          <h3>Providers found in {zip} (FCC data)</h3>
          {result.counties?.length > 0 && <p>County: {result.counties.join(", ")}</p>}
          <ul>
            {result.providers.map((p: any, i: number) => (
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
