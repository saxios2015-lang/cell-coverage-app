export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zip = searchParams.get("zip") ?? "";
  const base = process.env.NEXT_PUBLIC_API_BASE_URL!;
  const url = `${base}/api/providers/by-zip?zip=${encodeURIComponent(zip)}&source=unique`;

  const r = await fetch(url, { cache: "no-store" });
  return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" }});
}
