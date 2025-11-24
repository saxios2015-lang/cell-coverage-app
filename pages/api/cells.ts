// pages/api/cells.ts
import type { NextApiRequest, NextApiResponse } from "next";
import zipcodes from "zipcodes";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const zip = String(req.query.zip || "").trim();
    if (!zip) return res.status(400).json({ error: "zip required" });

    const key = process.env.NEXT_PUBLIC_OPENCELLID_API_KEY;
    if (!key) return res.status(500).json({ error: "Missing NEXT_PUBLIC_OPENCELLID_API_KEY" });

    const z = zipcodes.lookup(zip);
    if (!z) return res.status(404).json({ error: "unknown zip" });

    // quick bbox: ~5km
    const km = 5;
    const dLat = km / 111;
    const dLon = km / (111 * Math.cos((z.latitude * Math.PI) / 180));
    const bbox = `${z.latitude - dLat},${z.longitude - dLon},${z.latitude + dLat},${z.longitude + dLon}`;

    // NOTE: confirm the exact OCID endpoint you use; this is representative
    const url = `https://opencellid.org/api/cell/getInBounds?key=${encodeURIComponent(
      key
    )}&bbox=${bbox}&format=json`;

    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return res.status(r.status).json({ error: `OpenCelliD ${r.status}` });

    const data = await r.json();
    return res.status(200).json({ zip, cells: Array.isArray(data?.cells) ? data.cells : [] });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || "internal error" });
  }
}
