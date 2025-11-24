import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [supportedPlmns, setSupportedPlmns] = useState(new Set());

  // Load IMSI whitelist once
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then((r) => r.text())
      .then((text) => {
        const set = new Set();
        text.split("\n").forEach((line) => {
          const cols = line.split(",");
          if (cols.length < 7) return;
          const plmn = cols[0]?.trim();
          const group = cols[6]?.trim();
          if (plmn && plmn.length === 5 && (group === "EU 2" || group === "US 2")) {
            set.add(plmn);
          }
        });
        setSupportedPlmns(set);
      });
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";
  const OCID_KEY = process.env.NEXT_PUBLIC_OCID_KEY || "";

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5 || isNaN(zip)) return;

    setLoading(true);
    setResult(null);

    let hasTg3Coverage = false;
    let providers = [];
    let counties = [];

    try {
      // 1. Get ZIP center
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&postalcode=${zip}&countrycodes=us&limit=1`
      );
      const places = await geoRes.json();
      if (places.length === 0) throw new Error("ZIP not found");

      const centerLat = parseFloat(places[0].lat);
      const centerLon = parseFloat(places[0].lon);

      // 2. Ultra-safe 25-box fan-out — never hits 4 km² limit
      const offsetKm = 1.8;     // 1.8 km per side → max 3.24 km²
      const gridSize = 5;       // 5×5 = 25 boxes → ~18 km diameter

      const kmPerDegLat = 111.32;
      const kmPerDegLon = 40075 * Math.cos((centerLat * Math.PI) / 180) / 360;

      const deltaLat = offsetKm / kmPerDegLat;
      const deltaLon = offsetKm / kmPerDegLon;

      const allCells = [];

      for (let row = -(gridSize - 1) / 2; row <= (gridSize - 1) / 2; row++) {
        for (let col = -(gridSize - 1) / 2; col <= (gridSize - 1) / 2; col++) {
          const lat1 = centerLat + row * deltaLat;
          const lon1 = centerLon + col * deltaLon;
          const lat2 = lat1 + deltaLat;
          const lon2 = lon1 + deltaLon;

          const url = `https://opencellid.org/cell/getInArea?key=${OCID_KEY}&BBOX=${lat1},${lon1},${lat2},${lon2}&format=json&limit=50`;

          try {
            const res = await fetch(url);
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data.cells)) allCells.push(...data.cells);
            }
          } catch {}
        }
      }

      // 3. Loose 4G + your IMSI = green
      for (const c of allCells) {
        const isLikely4G = !c.radio || c.radio === "LTE" || c.radio === "LTECATM";
        if (!isLikely4G) continue;

        if (c.mcc && c.mnc) {
          const plmn = `${c.mcc}${String(c.mnc).padStart(3, "0")}`;
          if (supportedPlmns.has(plmn)) {
            hasTg3Coverage = true;
            break;
          }
        }
      }

      if (hasTg3Coverage) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have 4G coverage in this ZIP",
        });
        setLoading(false);
        return;
      }

      // 4. FCC fallback
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fccRes.ok) {
        const data = await fccRes.json();
        providers = data.providers || [];
        counties = data.counties || [];
      }
    } catch (err) {
      console.error(err);
    }

    setResult({
      supported: false,
      message: "No TG3 coverage found in this ZIP",
      providers,
      counties,
    });

    setLoading(false);
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>TG3 Coverage Checker (4G Only)</h1>

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
              <h3>Providers in {zip} {result.supported ? "(TG3 supported)" : "(not supported by TG3)"}</h3>
              {result.counties?.length > 0 && <p><strong>County:</strong> {result.counties.join(", ")}</p>}
              <ul style={{ lineHeight: 1.7 }}>
                {result.providers.map((p, i) => (
                  <li key={i}>
                    {p.provider_name || "Unknown"} {p.provider_id && `(${p.provider_id})`}
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
