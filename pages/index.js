"use client";
import React, { useCallback, useEffect, useMemo, useState } from "react";

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
            fontFamily: "monospace",
            fontSize: 13,
          }}
        >
          <b>{it.level.toUpperCase()}:</b> {it.message}
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
    console.log(`[${level.toUpperCase()}]`, msg);
    setDebug((p) => [...p, { level, message: msg }]);
  }, []);

  const detectDelimiter = (text) => {
    const commaCount = (text.match(/,/g) || []).length;
    const tabCount = (text.match(/\t/g) || []).length;
    return tabCount > commaCount ? "\t" : ",";
  };

  const loadPLMNs = useCallback(async () => {
    try {
      const res = await fetch("/data/IMSI_data_tg3.csv", { cache: "no-store" });
      if (!res.ok) {
        log("error", `Failed to fetch file: ${res.status}`);
        return;
      }
      const text = await res.text();
      const delim = detectDelimiter(text);
      log("info", `Detected delimiter: ${delim === "\t" ? "TAB" : "COMMA"}`);
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const set = new Set();
      for (const line of lines) {
        const cols = line.split(delim).map((c) => c.trim());
        const provider = cols.find((c) => /(US\s*2|EU\s*2)/i.test(c));
        const mccmnc = cols.find((c) => /^\d{5,6}$/.test(c));
        if (provider && mccmnc) {
          const mcc = mccmnc.slice(0, 3);
          const mnc = mccmnc.slice(3);
          set.add(mcc + mnc.padStart(3, "0"));
        }
      }
      setPlmns(set);
      log("info", `Loaded ${set.size} PLMNs`);
    } catch (e) {
      log("error", `Parse error: ${e.message}`);
    }
  }, [log]);

  useEffect(() => {
    loadPLMNs();
  }, [loadPLMNs]);

  const geocodeZip = async (zip) => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/search?postalcode=${zip}&country=US&format=json&limit=1`
      );
      const j = await r.json();
      if (!j.length) throw new Error("no result");
      const { lat, lon } = j[0];
      log("info", `Geocode ${zip} → lat ${lat}, lon ${lon}`);
      return { lat, lon };
    } catch (e) {
      log("error", `Geocode failed: ${e.message}`);
      return null;
    }
  };

  const fetchOCID = async (lat, lon) => {
    try {
      const key = process.env.NEXT_PUBLIC_OCID_KEY;
      if (!key) {
        log("error", "NEXT_PUBLIC_OCID_KEY missing");
        return [];
      }
      const bbox = `${lon - 0.01},${lat - 0.01},${lon + 0.01},${lat + 0.01}`;
      const url = `https://api.opencellid.org/cell/getInArea?key=${key}&BBOX=${bbox}&limit=50&format=json`;
      const r = await fetch(url);
      const j = await r.json();
      const cells = Array.isArray(j?.cells) ? j.cells : j;
      log("info", `OpenCellID returned ${cells.length} towers`);
      return cells;
    } catch (e) {
      log("error", `OpenCellID error: ${e.message}`);
      return [];
    }
  };

  const handleCheck = async () => {
    setFiltered([]);
    setDebug([]);
    if (!zip.trim()) return log("warn", "Enter a ZIP code first.");
    const coords = await geocodeZip(zip);
    if (!coords) return;
    const towers = await fetchOCID(coords.lat, coords.lon);
    const filteredTowers = towers.filter((t) =>
      plmns.has(`${t.mcc}${String(t.mnc).padStart(3, "0")}`)
    );
    setFiltered(filteredTowers);
    log(
      filteredTowers.length ? "info" : "warn",
      `Found ${filteredTowers.length} matching towers`
    );
  };

  return (
    <main style={{ padding: 20, fontFamily: "sans-serif" }}>
      <DebugBanner items={debug} />
      <h1>FloLive / TG3 Coverage Checker</h1>
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
          }}
        >
          Check
        </button>
      </div>

      {filtered.length > 0 && (
        <div>
          <h2>{filtered.length} matching towers</h2>
          <ul>
            {filtered.slice(0, 10).map((t, i) => (
              <li key={i}>
                MCC: {t.mcc}, MNC: {t.mnc}, LAC: {t.lac}, CID: {t.cid}
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
