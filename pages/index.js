import { useState } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [towers, setTowers] = useState([]);
  const [providers, setProviders] = useState([]);
  const [countyNames, setCountyNames] = useState([]);

  // THIS IS THE ONLY LINE THAT MATTERS RIGHT NOW
  const RENDER_BACKEND = "https://cell-coverage-app.onrender.com";

  async function handleSearch(e) {
    e.preventDefault();
    setLoading(true);
    setMessage("");
    setTowers([]);
    setProviders([]);
    setCountyNames([]);

    try {
      // 1) OpenCelliD (still works as relative path)
      const r1 = await fetch(`/api/cells?zip=${encodeURIComponent(zip)}`, {
        cache: "no-store",
      });
      let cells = [];
      try {
        const j1 = await r1.json();
        cells = Array.isArray(j1?.cells) ? j1.cells : [];
      } catch {}
      if (cells.length > 0) {
        setTowers(cells);
        setMessage(`Found ${cells.length} cell${cells.length === 1 ? "" : "s"} near ${zip}.`);
        setLoading(false);
        return;
      }

      // 2) FCC fallback — now points to your real Render backend
      const r2 = await fetch(
        `${RENDER_BACKEND}/api/providers/by-zip?zip=${encodeURIComponent(zip)}`
      );

      if (!r2.ok) {
        setMessage(`Failed to load providers (status ${r2.status}).`);
        setLoading(false);
        return;
      }

      const j2 = await r2.json();
      setProviders(j2.providers || []);
      setCountyNames(j2.counties || []);
      setMessage("No towers via OpenCelliD. These providers serve the ZIP:");
    } catch (err) {
      setMessage(`Error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <h1>ZIP Coverage Check</h1>
      <form onSubmit={handleSearch} style={{ display: "flex", gap: 8 }}>
        <input
          placeholder="Enter ZIP (e.g. 02190)"
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
            padding: "10px 20px",
            borderRadius: 8,
            background: loading ? "#ccc" : "#0070f3",
            color: "white",
            border: "none",
            cursor: loading ? "default" : "pointer",
          }}
        >
          {loading ? "Checking…" : "Check"}
        </button>
      </form>

      {message && <p style={{ marginTop: 20, fontWeight: "bold" }}>{message}</p>}

      {towers.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3>Towers found (OpenCelliD)</h3>
          <ul>
            {towers.slice(0, 30).map((c, i) => (
              <li key={i}>
                {c.radio || "Cell"} @ {Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}
                {c.mcc && c.mnc && ` (MCC/MNC ${c.mcc}/${c.mnc})`}
              </li>
            ))}
          </ul>
        </section>
      )}

      {providers.length > 0 && (
        <section style={{ marginTop: 20 }}>
          <h3>Providers serving {zip}</h3>
          {countyNames.length > 0 && <p>County: {countyNames.join(", ")}</p>}
          <ul>
            {providers.map((p, i) => {
              const name = p.provider_name || p.holding_company || "Unknown";
              const id = p.provider_id || "";
              return <li key={i}>{name} {id && `(${id})`}</li>;
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
