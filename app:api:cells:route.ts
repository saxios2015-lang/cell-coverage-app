import zipcodes from "zipcodes";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get("zip") ?? "";
  const key = process.env.NEXT_PUBLIC_OPENCELLID_API_KEY!;
  const z = zipcodes.lookup(zip);
  if (!z) return new Response(JSON.stringify({ cells: [] }), { status: 200 });

  const bbox = `${z.latitude - 0.05},${z.longitude - 0.05},${z.latitude + 0.05},${z.longitude + 0.05}`;
  const url = `https://opencellid.org/api/cell/getInBounds?key=${key}&bbox=${bbox}&format=json`;
  const r = await fetch(url, { cache: "no-store" });
  const data = await r.json();
  return new Response(JSON.stringify(data), { status: 200 });
}
