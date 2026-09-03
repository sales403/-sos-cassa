export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname !== "/api/address") {
      return new Response("SOS Rider address proxy", { status: 200, headers: cors });
    }

    const q = (url.searchParams.get("q") || "").trim();
    if (q.length < 3) return Response.json({ features: [] }, { headers: cors });

    const upstream = new URL("https://photon.komoot.io/api/");
    upstream.searchParams.set("q", q);
    upstream.searchParams.set("limit", "8");
    upstream.searchParams.set("lang", "it");
    upstream.searchParams.set("countrycode", "IT");
    upstream.searchParams.set("lat", "44.77");
    upstream.searchParams.set("lon", "10.90");
    upstream.searchParams.set("zoom", "11");
    upstream.searchParams.set("location_bias_scale", "0.15");
    ["house","street","locality","city"].forEach(x => upstream.searchParams.append("layer", x));

    try {
      const r = await fetch(upstream.toString(), {
        headers: {"Accept":"application/json","User-Agent":"SOS-Rider-Carpi-Soliera/1.0"}
      });
      const body = await r.text();
      return new Response(body, {
        status: r.status,
        headers: {...cors,"Content-Type":"application/json; charset=utf-8","Cache-Control":"public, max-age=60"}
      });
    } catch (e) {
      return Response.json({features:[],error:"upstream_unavailable"},{status:502,headers:cors});
    }
  }
};