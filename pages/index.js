"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";

function DebugBanner({ items = [], sticky = true }) {
  if (!items.length) return null;

  const bg = (level) =>
    level === "error" ? "#fee2e2" : level === "warn" ? "#fef3c7" : "#e0f2fe";
  const border = (level) =>
    level === "error" ? "#ef4444" : level === "warn" ? "#f59e0b" : "#0284c7";

  return (
    <div
      style={{
        position: sticky ? "sticky" : "static",
        top: 0,
        zIndex: 1000,
        width: "100%",
        boxShadow: "0 2px 6px rgba(0,0,0,0.08)",
      }}
    >
      {items.map((it, idx) => (
        <div
          key={idx}
          style={{
            background: bg(it.level),
            borderBottom: `1px solid ${border(it.level)}`,
            padding: "10px 14px",
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace",
            fontSize: 13,
            lineHeight: 1.3,
          }}
        >
          <strong style={{ textTransform: "uppercase", marginRight: 8 }}>
            {it.level}
          </strong>
          <span>{it.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [debugItems, setDebugItems] = useState([]);
  const [supportedPlmns, setSupportedPlmns] = useState(new Set());
  const [zip, setZip] = useState("");
  const [filteredTowers, setFilteredTowers] = useState([]);

  const addDebug = useCallback((level, message) => {
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
      "[DEBUG]",
      message
    );
    setDebugItems((prev) => [...prev, { level, message }]);
  }, []);

  const debugEnabled = useMemo(() => {
    if (typeof window === "undefined") return true;
    return new URLSearchParams(window.location.search).get("debug") === "1";
  }, []);

  // --- CSV Loader with normalization fix ---
  const loadSupportedPlmns = useCallback(async () => {
    try {
      const res = await fetch("/data/IMSI_data_tg3.csv", { cache: "no-store" });
      if (!res.ok) {
        addDebug("error", `CSV fetch failed: ${res.status} ${res.statusText}`);
        return;
      }

      const text = await res.text();
      const set = new Set();
      let parsed = 0;
      for (const line of text.split(/\r?\n/)) {
        if (!line || /^(\s*#|PLMN|MCC)/i.test(line)) continue;
        const cols = line.split(",");
        const plmn = cols[0]?.trim();
        const group = cols[6]?.trim();

        const raw = (plmn || "").replace(/\D/g, "");
        if ((group === "EU 2" || group === "US 2") && (raw.length === 5 || raw.length === 6)) {
          const mcc = raw.slice(0, 3);
          const mnc = raw.slice(3);
          const canonical = mcc + mnc.padStart(3, "0");
          set.add(canonical);
          parsed++;
        }
      }

      setSupportedPlmns(set);
      addDebug(
        set.size ? "info" : "warn",
        `CSV loaded: ${parsed} rows parsed, ${set.size} PLMNs in whitelist (normalized to 6 digits).`
      );
    } catch (e) {
      addDebug("error", `CSV parse error: ${e?.message || e}`);
    }
  }, [addDebug]);

  useEffect(() => {
    loadSupportedPlmns();
  }, [loadSupportedPlmns]);

  // --- Geocoding ---
  const geocodeZip = useCallback(
    async (zip) => {
      try {
        const url = `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`;
        const res = await fetch(url, {
          headers: { "User-Agent": "toast-debug-app/1.0 (email@example.com)" },
        });
        if (!res.ok) throw new Error(`Geocode HTTP ${res.status}`);
        const data = await res.json();
        if (!data.length) {
          addDebug("warn", `No geocode results for ZIP ${zip}`);
          return null;
        }
        const { lat, lon } = data[0];
        addDebug("info", `Geocode success: ZIP ${zip} → lat ${lat}, lon ${lon}`);
        return { lat, lon };
      } catch (err) {
        addDebug("error", `Geocode failed for ZIP ${zip}: ${err?.message}`);
        return null;
      }
    },
    [addDebug]
  );

  // --- Fetch towers from OpenCelliD ---
  const fetchOpenCellId = useCallback(
    async (lat, lon) => {
      try {
        const bbox = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
        const apiKey = process.env.NEXT_PUBLIC_OCID_KEY; // ✅ updated to match your Vercel variable
        const url = `https://api.opencellid.org/cell/getInArea?key=${apiKey}&BBOX=${bbox}&limit=50&format=json`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`OpenCellID HTTP ${res.status}`);
        const data = await res.json();
        const cells = Array.isArray(data?.cells) ? data.cells : data;
        addDebug("info", `OpenCellID returned ${cells.length} towers for bbox ${bbox}`);
        return cells;
      } catch (err) {
        addDebug("error", `OpenCellID fetch failed: ${err?.message}`);
        return [];
      }
    },
    [addDebug]
  );

  // --- Filter towers by PLMN ---
  const filterCellsByPlmn = useCallback(
    (cells) => {
      const before = cells.length;
      const filtered = cells.filter((cell) => {
        const plmn = `${cell.mcc}${String(cell.mnc).padStart(3, "0")}`;
        return supportedPlmns.has(plmn);
      });
      addDebug(
        before ? "info" : "warn",
        `Filter by PLMN: ${before} → ${filtered.length} after whitelist (${supportedPlmns.size} PLMNs).`
      );
      return filtered;
    },
    [supportedPlmns, addDebug]
  );

  // --- Master handler ---
  const handleCheck = useCallback(async () => {
    setFilteredTowers([]);
    setDebugItems([]);
    if (!zip.trim()) {
      addDebug("warn", "Please enter a ZIP code.");
      return;
    }

    const coords = await geocodeZip(zip.trim());
    if (!coords) {
      addDebug("error", "Geocode failed; aborting tower fetch.");
      return;
    }

    const towers = await fetchOpenCellId(coords.lat, coords.lon);
    if (!towers.length) {
      addDebug("warn", "No towers returned from OpenCellID.");
    }

    const filtered = filterCellsByPlmn(towers);
    setFilteredTowers(filtered);

    addDebug(
      filtered.length ? "info" : "warn",
      filtered.length
        ? `✅ Found ${filtered.length} TG3-compatible towers near ${zip}.`
        : "❌ No TG3 towers found (check CSV normalization or bbox range)."
    );
  }, [zip, geocodeZip, fetchOpenCellId, filterCellsByPlmn, addDebug]);

  return (
    <main style={{ padding: 20, fontFamily: "sans-serif" }}>
      {debugEnabled && <DebugBanner items={debugItems} />}

      <h1 style={{ fontSize: 20, marginBottom: 8 }}>FloLive / TG3 Coverage Checker</h1>
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Enter ZIP code (e.g. 02135)"
          style={{
            border: "1px solid #ccc",
            padding: "8px 10px",
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={handleCheck}
          style={{
            background: "#0284c7",
            color: "white",
            border: "none",
            padding: "8px 14px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          Check
        </button>
      </div>

      {filteredTowers.length > 0 && (
        <div>
          <h2 style={{ fontSize: 16, marginBottom: 6 }}>
            Found {filteredTowers.length} matching towers
          </h2>
          <ul style={{ fontSize: 13, lineHeight: 1.4 }}>
            {filteredTowers.slice(0, 10).map((t, i) => (
              <li key={i}>
                MCC: {t.mcc}, MNC: {t.mnc}, LAC: {t.lac}, CID: {t.cid}
              </li>
            ))}
          </ul>
          {filteredTowers.length > 10 && <p>...and more</p>}
        </div>
      )}
    </main>
  );
}
