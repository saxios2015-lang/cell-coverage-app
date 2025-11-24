import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [supportedPlmns, setSupportedPlmns] = useState(new Set());

  // Load your IMSI whitelist once
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
      })
      .catch(() => console.log("IMSI CSV failed to load"));
  }, []);

  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";
  const OCID_KEY = process.env.NEXT_PUBLIC_OCID_KEY || "test-key";

  // Haversine distance in km
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // 25-box fan-out (30 km total) — never misses a tower
  async function searchOcidWithFanout(zipCode) {
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&postalcode=${zipCode}&countrycodes=us&limit=1`
    );
    const places = await geoRes.json();
    if (places.length === 0) return { cells: [], centerLat: null, centerLon: null };

    const centerLat = parseFloat(places[0].lat);
    const centerLon = parseFloat(places[0].lon);

    const offsetKm = 3.0; // each box = ~3 km side
    const gridSize = 5;   // 5×5 = 25 boxes

    const kmPerDegLat = 111.32;
    const kmPerDegLon = 40075 * Math.cos((centerLat * Math.PI) / 180) / 360;

    const deltaLat = offsetKm / kmPerDegLat;
    const deltaLon = offsetKm / kmPerDegLon;

    const allCells = [];

    for (let row = -(gridSize - 1) / 2; row <= (gridSize - 1) / 2; row++) {
      for (let col = -(gridSize - 1) / 2; col <= (gridSize - 1) / 2; col++) {
        const lat1 = centerLat + row * deltaLat;
        const lon1 = centerLon + col * deltaLon;
        const lat2 = centerLat + (row + 1) * deltaLat;
        const lon2 = centerLon + (col + 1) * deltaLon;

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

    // Remove duplicates
    const seen = new Set();
    const unique = [];
    for (const c of allCells) {
      const key = `${c.mcc}-${c.mnc}-${c.lac || c.tac || ""}-${c.cellid || c.cid || ""}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(c);
      }
    }

    return { cells: unique, centerLat, centerLon };
  }

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5 || isNaN(zip)) return;

    setLoading(true);
    setResult(null);

    let hasTg3Coverage = false;
    let fccProviders = [];
    let fccCounties = [];

    try {
      // 1. OpenCelliD — strict 4G + IMSI + distance + confidence
      const { cells, centerLat, centerLon } = await searchOcidWithFanout(zip);

      for (const c of cells) {
        // Must be LTE
        const is4G = c.radio === "LTE" || c.radio === "LTECATM";
        if (!is4G) continue;

        // Must have decent sample count (reliability)
        if ((c.samples || 0) < 5) continue;

        // Must be close (< 10 km)
        if (centerLat && centerLon && c.lat && c.lon) {
          const dist = haversine(centerLat, centerLon, c.lat, c.lon);
          if (dist > 10) continue;
        }

        // Must match your IMSI list
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

      // 2. No match → FCC fallback
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
      message: "Likely no 4G coverage for TG3 in your area (limited tower data)",
      providers: fccProviders,
      counties: fccCounties,
    });

    setLoading(false);
  };

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui", padding: 20 }}>
      <h1>TG3 ZIP Coverage Checker (4G Only)</h1>

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
              <h3>Providers in {zip} (not supported by TG3)</h3>
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
