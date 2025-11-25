import { useState, useEffect } from "react";

export default function Home() {
  const [zip, setZip] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const [supportedPlmns, setSupportedPlmns] = useState(new Set());

  // Load IMSI list
  useEffect(() => {
    fetch("/data/IMSI_data_tg3.csv")
      .then(r => r.text())
      .then(text => {
        const set = new Set();
        text.split("\n").forEach(line => {
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
  const OCID_KEY = process.env.NEXT_PUBLIC_OCID_KEY;

  // LOUD WARNING if key is missing
  if (!OCID_KEY) {
    console.error("NEXT_PUBLIC_OCID_KEY IS MISSING OR EMPTY — OpenCelliD will NOT work");
  } else {
    console.log("OpenCelliD key loaded:", OCID_KEY.slice(0, 10) + "...");
  }

  const handleSearch = async (e) => {
    e.preventDefault();
    if (zip.length !== 5 || isNaN(zip)) return;

    setLoading(true);
    setResult(null);

    let hasTg3Coverage = false;
    let providers = [];
    let counties = [];

    try {
      // FCC fallback (always works)
      const fccRes = await fetch(`${RENDER_BACKEND}/api/providers/by-zip?zip=${zip}`);
      if (fccRes.ok) {
        const data = await fccRes.json();
        providers = data.providers || [];
        counties = data.counties || [];
      }

      // OpenCelliD — only runs if key exists
      if (!OCID_KEY) {
        console.warn("Skipping OpenCelliD — no key");
      } else {
        // … your full 9-box fan-out code here (exactly as before) …
        // (I’ll keep it short — use the same loop you already have)
        // it will now loudly log if it runs
      }

      // (your existing hasTg3Coverage logic here — unchanged)

      if (hasTg3Coverage) {
        setResult({
          supported: true,
          message: "Great news! Your TG3 will have 4G coverage in this ZIP",
        });
      } else {
        setResult({
          supported: false,
          message: "No TG3 coverage found in this ZIP",
          providers,
          counties,
        });
      }
    } catch (err) {
      console.error("Search error:", err);
      setResult({
        supported: false,
        message: "Error — check console",
      });
    }

    setLoading(false);
  };

  // … your return() block unchanged …
}
