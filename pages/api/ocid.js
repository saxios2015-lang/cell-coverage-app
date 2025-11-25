// pages/api/ocid.js

export const config = {
  runtime: "nodejs", // ensure Node runtime (not Edge)
};

export default async function handler(req, res) {
  try {
    const { bbox, limit = "50", format = "json" } = req.query;

    if (!bbox) {
      return res.status(400).json({ error: "Missing bbox query param" });
    }

    // Prefer server-only OCID_KEY; fall back to NEXT_PUBLIC_OCID_KEY
    const key = process.env.OCID_KEY || process.env.NEXT_PUBLIC_OCID_KEY;

    if (!key) {
      // Nothing sensitive here—just a helpful message
      return res.status(500).json({
        error:
          "OCID API key missing. Set OCID_KEY (preferred) or NEXT_PUBLIC_OCID_KEY in Vercel and redeploy.",
      });
    }

    const masked = key.length > 7 ? key.slice(0, 3) + "…" + key.slice(-3) : "***";
    console.log("[ocid] using key:", masked);

    const url = `https://api.opencellid.org/cell/getInArea?key=${encodeURIComponent(
      key
    )}&BBOX=${encodeURIComponent(bbox)}&limit=${encodeURIComponent(
      String(limit)
    )}&format=${encodeURIComponent(format)}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 15000);

    const upstream = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: { "User-Agent": "flo-tg3-checker/1.0 (server-proxy)" },
      cache: "no-store",
    }).catch((err) => {
      throw new Error(`Fetch error: ${err.message}`);
    });

    clearTimeout(t);

    const bodyText = await upstream.text();
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.status(upstream.status);

    try {
      const json = JSON.parse(bodyText);
      return res.json(json);
    } catch {
      return res.send(bodyText);
    }
  } catch (err) {
    console.error("[ocid] error:", err);
    return res
      .status(502)
      .json({ error: "Upstream error", detail: String(err.message || err) });
  }
}
