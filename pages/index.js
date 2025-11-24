import { useState } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [towers, setTowers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [countyNames, setCountyNames] = useState([]);

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setTowers([]);
    setProviders([]);
    setCountyNames([]);

    try {
      // 1) Try OpenCelliD
      const r1 = await fetch(`/api/cells?zip=${encodeURIComponent(zip)}`, {
        cache: "no-store",
      });
      let cells = [];
      try {
        const j1 = await r1.json();
        cells = Array.isArray(j1?.cells) ? j1.cells : [];
      } catch {
        // ignore parse errors from OCID (HTML/plain-text responses sometimes)
      }

      if (cells.length > 0) {
        setTowers(cells);
        setMessage(`Found ${cells.length} cell${cells.length === 1 ? "" : "s"} near ${zip}.`);
        setLoading(false);
        return;
      }

      // 2) Fallback: providers by ZIP (FastAPI)
      const r2 = await fetch(`/api/providers/by-zip?zip=${encodeURIComponent(zip)}`, {
        cache: "no-store",
      });
      if (!r2.ok) {
        const txt = await r2.text();
        setMessage(`No, no coverage found. Also failed to load providers (status ${r2.status}). ${txt}`);
        setLoading(false);
        return;
      }

      const j2 = await r2.json();
      setProviders(Array.isArray(j2.providers) ? j2.providers : []);
      setCountyNames(Array.isArray(j2.counties) ? j2.counties : []);
      setMessage("No, no coverage found. These are the providers in your zip.");
    } catch (err) {
      setMessage(`Error: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>ZIP Coverage Check</h1>

      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Enter ZIP (e.g. 02139)"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          style={{
            flex: 1,
            padding: 10,
            borderRadius: 8,
            border: "1px solid #ddd",
            fontSize: 16,
          }}
        />
        <button
          disabled={loading}
          style={{
            padding: "10px 16px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: loading ? "#eee" : "#f5f5f5",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {message && <p style={{ marginTop: 16 }}>{message}</p>}

      {/* Towers list (if OpenCelliD returned anything) */}
      {towers.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3>Towers near {zip}</h3>
          <p style={{ fontSize: 12, color: "#666" }}>Tower data © OpenCelliD (ODbL)</p>
          <ul>
            {towers.slice(0, 30).map((c, i) => (
              <li key={i}>
                {(c.radio || "Cell")} @ {Number(c.lat).toFixed(5)},{Number(c.lon).toFixed(5)}
                {c.mcc != null && c.mnc != null ? ` (MCC/MNC ${c.mcc}/${c.mnc})` : ""}
              </li>
            ))}
          </ul>
          {towers.length > 30 && <p>…and {towers.length - 30} more</p>}
        </section>
      )}

      {/* Providers list (fallback) — supports both numbers and objects */}
      {Array.isArray(providers) && providers.length > 0 && (
        <section style={{ marginTop: 16 }}>
          <h3>Providers in {zip}</h3>
          {Array.isArray(countyNames) && countyNames.length > 0 && (
            <p>County: {countyNames.join(", ")}</p>
          )}
          <ul>
            {providers.map((p, i) => {
              const isNumber = typeof p === "number";
              const id = isNumber ? p : (p?.provider_id ?? p?.id);
              const name =
                !isNumber
                  ? (p?.provider_name ||
                     p?.holding_company ||
                     p?.brand_name ||
                     p?.doing_business_as)
                  : null;

              const label = name
                ? `${name}${id ? ` (${id})` : ""}`
                : (id != null ? String(id) : "Unknown provider");

              return <li key={i}>{label}</li>;
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
