"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";

/** --- Debug Banner --- */
function DebugBanner({ items = [] }) {
  if (!items.length) return null;
  const bg = (level) =>
    level === "error" ? "#fee2e2" : level === "warn" ? "#fef3c7" : "#e0f2fe";
  const border = (level) =>
    level === "error" ? "#ef4444" : level === "warn" ? "#f59e0b" : "#0284c7";
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 1000 }}>
      {items.map((it, i) => (
        <div
          key={i}
          style={{
            background: bg(it.level),
            borderBottom: `1px solid ${border(it.level)}`,
            padding: "8px 12px",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace",
            fontSize: 13,
          }}
        >
          <b style={{ marginRight: 6 }}>{it.level.toUpperCase()}:</b>
          <span>{it.message}</span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [debug, setDebug] = useState([]);
  const [plmns, setPlmns] = useState(new Set());
  const [zip, setZip] = useState("");
  const [filtered, setFiltered] = useState([]);

  const log = useCallback((level, msg) => {
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](`[${level.toUpperCase()}]`, msg);
    setDebug((p) => [...p, { level, message: msg }]);
  }, []);

  /* ---------- PLMN whitelist loader (auto-detects delimiter) ---------- */
  const detectDelimiter = (text) => {
    const commaCount = (text.match(/,/g) || []).length;
    const tabCount = (text.match(/\t/g) || []).length;
    return tabCount > commaCount ? "\t" : ",";
  };

  const loadPLMNs = useCallback(async () => {
    try {
      const res = await fetch("/data/IMSI_data_tg3.csv", { cache: "no-store" });
      if (!res.ok) {
        log("error", `Failed to fetch /data/IMSI_data_tg3.csv: ${res.status} ${res.statusText}`);
        return;
      }
      const text = await res.text();
      const delim = detectDelimiter(text);
      log("info", `Detected delimiter: ${delim === "\t" ? "TAB" : "COMMA"}`);

      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const set = new Set();

      // Very lenient parse: look for a group column containing "US 2" or "EU 2" and a 5–6 digit MCCMNC cell.
      for (const line of lines) {
        const cols = line.split(delim).map((c) => c.trim());
        const providerCell = cols.find((c) => /(US\s*2|EU\s*2)/i.test(c));
        const mccmncCell = cols.find((c) => /^\d{5,6}$/.test(c));
        if (!providerCell || !mccmncCell) continue;

        const mcc = mccmncCell.slice(0, 3);
        const mnc = mccmncCell.slice(3);
        const canonical = mcc + mnc.padStart(3, "0"); // normalize to 6-digit MCC+MNC
        set.add(canonical);
      }

      setPlmns(set);
      log("info", `Loaded ${set.size} PLMNs`);
      if (!set.size) {
        log("warn", "Whitelist ended up empty — check the TSV/CSV structure or ‘IMSI Provider’ values.");
      }
    } catch (e) {
      log("error", `Parse error: ${e?.message || e}`);
    }
  }, [log]);

  useEffect(() => {
    loadPLMNs();
  }, [loadPLMNs]);

  /* ---------- Geocoding ---------- */
  const geocodeZip = async (zipCode) => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${zipCode}&country=US&format=json&limit=1`,
        { headers: { "User-Agent": "flo-tg3-checker/1.0 (debug@toast.com)" } }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (!j.length) throw new Error("no result");
      const { lat, lon } = j[0];
      log("info", `Geocode ${zipCode} → lat ${lat}, lon ${lon}`);
      return { lat, lon };
    } catch (e) {
      log("error", `Geocode failed: ${e.message}`);
      return null;
    }
  };

  /* ---------- OpenCelliD fetch with strong diagnostics ---------- */
  const fetchOpenCellId = useCallback(
    async (lat, lon) => {
      try {
        const key = process.env.NEXT_PUBLIC_OCID_KEY; // must be set in Vercel env
        if (!key) {
          log("error", "Environment variable NEXT_PUBLIC_OCID_KEY is missing/empty (set it in Vercel → Settings → Environment Variables).");
          return [];
        }

        const bbox = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
        const url = `https://api.opencellid.org/cell/getInArea?key=${key}&BBOX=${bbox}&limit=50&format=json`;
        const safeUrl = url.replace(key, "[REDACTED]");
        const maskedKey = key.length > 7 ? key.slice(0, 3) + "…" + key.slice(-3) : "***";
        log("info", `OpenCellID URL: ${safeUrl} (key ${maskedKey})`);

        const res = await fetch(url, { cache: "no-store" });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          log("error", `OpenCellID HTTP ${res.status} ${res.statusText}. Body: ${body.slice(0, 200)}…`);
          return [];
        }

        let data;
        try {
          data = await res.json();
        } catch {
          const body = await res.text().catch(() => "");
          log("error", `OpenCellID returned non-JSON. Body: ${body.slice(0, 200)}…`);
          return [];
        }

        const cells = Array.isArray(data?.cells) ? data.cells : Array.isArray(data) ? data : [];
        log("info", `OpenCellID returned ${cells.length} towers for bbox ${bbox}`);
        return cells;
      } catch (e) {
        log("error", `OpenCellID fetch failed: ${e?.message || e}`);
        return [];
      }
    },
    [log]
  );

  /* ---------- Filter by PLMN ---------- */
  const filterCellsByPlmn = (cells) => {
    const before = cells.length;
    const filtered = cells.filter((t) =>
      plmns.has(`${t.mcc}${String(t.mnc).padStart(3, "0")}`)
    );
    log("info", `Filter by PLMN: ${before} → ${filtered.length} after whitelist (${plmns.size} PLMNs).`);
    if (plmns.size === 0) {
      log("error", "PLMN whitelist is empty — check parsing/group filter.");
    }
    return filtered;
  };

  /* ---------- Button handler ---------- */
  const handleCheck = async () => {
    setFiltered([]);
    setDebug([]); // clear banner for a fresh run
    if (!zip.trim()) return log("warn", "Enter a ZIP code first.");
    const coords = await geocodeZip(zip.trim());
    if (!coords) return;
    const towers = await fetchOpenCellId(coords.lat, coords.lon);
    const filteredTowers = filterCellsByPlmn(towers);
    setFiltered(filteredTowers);
    log(filteredTowers.length ? "info" : "warn", `Found ${filteredTowers.length} matching towers`);
  };

  return (
    <main style={{ padding: 20, fontFamily: "sans-serif" }}>
      <DebugBanner items={debug} />

      <h1 style={{ fontSize: 36, margin: "12px 0 16px" }}>FloLive / TG3 Coverage Checker</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          placeholder="Enter ZIP (e.g. 02135)"
          style={{ border: "1px solid #ccc", padding: 8, borderRadius: 6 }}
        />
        <button
          onClick={handleCheck}
          style={{
            background: "#0284c7",
            color: "#fff",
            border: "none",
            borderRadius: 6,
            padding: "8px 14px",
            cursor: "pointer",
          }}
        >
          Check
        </button>
      </div>

      {filtered.length > 0 && (
        <div>
          <h2 style={{ fontSize: 18, marginBottom: 8 }}>{filtered.length} matching towers</h2>
          <ul style={{ fontSize: 13, lineHeight: 1.5 }}>
            {filtered.slice(0, 10).map((t, i) => (
              <li key={i}>
                MCC: {t.mcc}, MNC: {t.mnc}, LAC: {t.lac}, CID: {t.cid}
              </li>
            ))}
          </ul>
          {filtered.length > 10 && <p>…and more</p>}
        </div>
      )}

      <p style={{ marginTop: 20, fontSize: 12, color: "#666" }}>
        Tip: add <code>/public/favicon.ico</code> to silence the favicon 404.
      </p>
    </main>
  );
}
