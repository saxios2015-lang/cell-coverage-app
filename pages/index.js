import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [supportedPlmns, setSupportedPlmns] = useState(new Set());

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
      // FCC fallback
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fccRes.ok) {
        const data = await fccRes.json();
        providers = data.providers || [];
        counties = data.counties || [];
      }

      // OpenCelliD fan-out (9 boxes for speed, recalculate lon per box)
      if (OCID_KEY) {
        const geo = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&postalcode=${zip}&countrycodes=us&limit=1`
        );
        const place = (await geo.json())[0];
        if (place) {
          const lat = parseFloat(place.lat);
          const lon = parseFloat(place.lon);
          const d = 2.5;

          let allCells = 0;
          for (let r = -1; r <= 1; r++) {
            for (let c = -1; c <= 1; c++) {
              // Recalculate lon delta for this box's lat
              const kmPerDegLon = 40075 * Math.cos(((lat + r * (d / 111.32)) * Math.PI) / 180) / 360;
              const lat1 = lat + r * (d / 111.32);
              const lon1 = lon + c * (d / kmPerDegLon);
              const lat2 = lat1 + (d / 111.32);
              const lon2 = lon1 + (d / kmPerDegLon);

              const url = `https://opencellid.org/cell/getInArea?key=${OCID_KEY}&BBOX=${lat1},${lon1},${lat2},${lon2}&format=json&limit=50`;
              const res = await fetch(url);
              if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.cells)) {
                  allCells += data.cells.length;
                  for (const cell of data.cells) {
                    const isLTE = !cell.radio || cell.radio === "LTE" || cell.radio === "LTECATM" || cell.radio === "NR";
                    if (!isLTE) continue;
                    if (cell.mcc && cell.mnc) {
                      const plmn = `${cell.mcc}${String(cell.mnc).padStart(3, "0")}`;
                      if (supportedPlmns.has(plmn)) {
                        hasTg3Coverage = true;
                        break;
                      }
                    }
                  }
                }
              } else {
                console.log("OCID error:", await res.text());  // Log errors
              }
              if (hasTg3Coverage) break;
            }
            if (hasTg3Coverage) break;
          }
          console.log(`OCID found ${allCells} towers for ${zip}`);  // Debug
        }
      }
    } catch (err) {
      console.error(err);
    }

    setResult({
      supported: hasTg3Coverage,
      message: hasTg3Coverage
        ? "Great news! Your TG3 will have 4G coverage in this ZIP"
        : "No TG3 coverage found in this ZIP",
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
