// pages/api/ocid.js

// Force this function to run in a different POP than iad1.
// Try one at a time: "sfo1" (US West), "cdg1" (Paris/EU), "hnd1" (Tokyo/APAC).
export const config = {
  runtime: "nodejs",
  regions: ["sfo1"], // <-- change to ["cdg1"] or ["hnd1"] if needed
};

function json(res, status, obj) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).json(obj);
}
const mask = (k) => (k && k.length > 7 ? `${k.slice(0, 3)}…${k.slice(-3)}` : "***");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  const region = process.env.VERCEL_REGION || "unknown";
  try {
    const { bbox, limit = "50", format = "json" } = req.query;
    if (!bbox) return json(res, 400, { error: "Missing bbox query param" });

    // Prefer private server var; fallback to public if needed
    const key = process.env.OCID_KEY || process.env.NEXT_PUBLIC_OCID_KEY;
    if (!key) {
      return json(res, 500, {
        error:
          "OCID API key missing. Set OCID_KEY (preferred) or NEXT_PUBLIC_OCID_KEY in Vercel and redeploy.",
      });
    }

    const url = `https://api.opencellid.org/cell/getInArea?key=${encodeURIComponent(
      key
    )}&BBOX=${encodeURIComponent(bbox)}&limit=${encodeURIComponent(
      String(limit)
    )}&format=${encodeURIComponent(format)}`;

    const MAX_TRIES = 3;
    const TIMEOUT_MS = 20000; // a bit longer

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const controller = new AbortController();
      const to = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        console.log(`[ocid] region=${region} attempt=${attempt} url=${url.replace(key, "[REDACTED]")} key=${mask(key)}`);

        const r = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: { "User-Agent": "flo-tg3-checker/1.0 (server-proxy)" },
          cache: "no-store",
        });

        clearTimeout(to);

        const text = await r.text();
        if (!r.ok) {
          // Pass through upstream code (401/403/429 etc.)
          return json(res, r.status, {
            error: "Upstream responded with error",
            status: r.status,
            statusText: r.statusText,
            region,
            bodySnippet: text.slice(0, 300),
          });
        }

        try {
          return json(res, 200, JSON.parse(text));
        } catch {
          return json(res, 200, { raw: text });
        }
      } catch (err) {
        clearTimeout(to);
        const detail = {
          name: err?.name,
          message: err?.message,
          code: err?.code || err?.cause?.code,
          errno: err?.errno || err?.cause?.errno,
          type: err?.type || err?.cause?.type,
          region,
          attempt,
          timeoutMs: TIMEOUT_MS,
        };
        console.error("[ocid] fetch error", detail);

        // Retry only on likely network errors
        if (
          attempt < MAX_TRIES &&
          ["UND_ERR_CONNECT_TIMEOUT", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND", "ECONNRESET"].includes(
            detail.code
          )
        ) {
          await sleep(400 * attempt);
          continue;
        }
        return json(res, 502, { error: "Upstream error", detail });
      }
    }

    return json(res, 502, { error: "Upstream error (exhausted retries)", region });
  } catch (err) {
    console.error("[ocid] unexpected error:", err);
    return json(res, 500, { error: "Proxy crashed", detail: String(err?.message || err) });
  }
}
