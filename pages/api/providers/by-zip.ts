// pages/api/providers/by-zip.ts
import type { NextApiRequest, NextApiResponse } from "next";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const base = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!base) return res.status(500).json({ error: "Missing NEXT_PUBLIC_API_BASE_URL" });

    const zip = String(req.query.zip || "").trim();
    const source = String(req.query.source || "unique");
    const q = req.query.q ? `&q=${encodeURIComponent(String(req.query.q))}` : "";

    const url = `${base}/api/providers/by-zip?zip=${encodeURIComponent(zip)}&source=${encodeURIComponent(source)}${q}`;
    const r = await fetch(url, { cache: "no-store" });
    const txt = await r.text();

    res.status(r.status);
    res.setHeader("content-type", "application/json");
    return res.send(txt);
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "internal error" });
  }
}
