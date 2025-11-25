// pages/api/ocid.js

export const config = {
  runtime: "nodejs",
};

function json(res, status, obj) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(status).json(obj);
}

function maskKey(k) {
  return k && k.length > 7 ? `${k.slice(0, 3)}…${k.slice(-3)}` : "***";
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

export default async function handler(req, res) {
  const region = process.env.VERCEL_REGION || "unknown";
  try {
    const { bbox, limit = "50", format = "json" } = req.query;
    if (!bbox) return json(res, 400, { error: "Missing bbox query param" });

    // Prefer server-only key; fall back to NEXT_PUBLIC_ if needed
    const key = process.env.OCID_KEY || process.env.NEXT_PUBLIC_OCID_KEY;
    if (!key) {
      return json(res, 500, {
        error: "OCID API key missing. Set OCID_KEY (preferred) or NEXT_PUBLIC_OCID_KEY in Vercel and redeploy.",
      });
    }

    const url = `https://api.opencellid.org/cell/getInArea?key=${encodeURIComponent(
      key
    )}&BBOX=${encodeURIComponent(bbox)}&limit=${encodeURIComponent(
      String(limit)
    )}&format=${encodeURIComponent(format)}`;

    // Up to 2 retries with tiny backoff (helps occasional network blips)
    const MAX_TRIES = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const controller = new AbortController();
      const timeoutMs = 15000;
      const to = setTimeout(() => controller.abort(), timeoutMs);

      try {
        console.log(`[ocid] region=${region} attempt=${attempt} url=${url.replace(key, "[REDACTED]")} key=${maskKey(key)}`);
        const r = await fetch(url, {
          method: "GET",
          signal: controller.signal,
          headers: { "User-Agent": "flo-tg3-checker/1.0 (server-proxy)" },
          cache: "no-store",
        });
        clearTimeout(to);

        const bodyText = await r.text();
        if (!r.ok) {
          // Pass through provider status + body for clarity (401/403/429/etc.)
          return json(res, r.status, {
            error: "Upstream responded with error",
            status: r.status,
            statusText: r.statusText,
            region,
            bodySnippet: bodyText.slice(0, 300),
          });
        }

        // Try to parse JSON; if not, return text
        try {
          const obj = JSON.parse(bodyText);
          return json(res, 200, obj);
        } catch {
          return json(res, 200, { raw: bodyText });
        }
      } catch (err) {
        clearTimeout(to);
        lastErr = err;
        // Include fine-grained error details back to client for debugging
        const detail = {
          name: err?.name,
          message: err?.message,
          code: err?.code || err?.cause?.code,
          errno: err?.errno || err?.cause?.errno,
          type: err?.type || err?.cause?.type,
          region,
          attempt,
          timeoutMs,
        };
        console.error("[ocid] fetch error", detail);

        // Retry only on network-ish failures
        if (attempt < MAX_TRIES && ["ETIMEDOUT","ENOTFOUND","ECONNRESET","EAI_AGAIN"].includes(detail.code)) {
          await sleep(400 * attempt);
          continue;
        }
        // Return detailed 502
        return json(res, 502, { error: "Upstream error", detail });
      }
    }

    // Shouldn't get here
    return json(res, 502, { error: "Upstream error (exhausted retries)", region, lastErr: String(lastErr) });
  } catch (err) {
    console.error("[ocid] unexpected error:", err);
    return json(res, 500, { error: "Proxy crashed", detail: String(err?.message || err) });
  }
}
