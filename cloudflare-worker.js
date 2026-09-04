export default {
  async fetch(request) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });

    if (url.pathname === "/") {
      return new Response("SOS Rider V8 autocomplete proxy OK", { status: 200, headers: cors });
    }

    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({ ok: true, version: "V8", autocomplete: true, googleKeyRequired: false }, 200, cors);
    }

    if (url.pathname === "/api/address" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 3) return json({ type: "FeatureCollection", features: [] }, 200, cors);

      try {
        const primary = await photon(q);
        let features = primary.features || [];

        // Se Photon trova poco, prova una ricerca più contestualizzata sulla provincia.
        if (features.length < 5 && !/\b(modena|carpi|soliera|limidi|sozzigalli|cortile)\b/i.test(q)) {
          const fallback = await photon(`${q}, Modena, Emilia-Romagna`);
          features = mergeFeatures(features, fallback.features || []);
        }

        return json({ type: "FeatureCollection", features: features.slice(0, 8) }, 200, cors, {
          "Cache-Control": "public, max-age=60"
        });
      } catch {
        return json({ type: "FeatureCollection", features: [], error: "autocomplete_unavailable" }, 502, cors);
      }
    }

    return new Response("Not found", { status: 404, headers: cors });
  }
};

async function photon(q) {
  const upstream = new URL("https://photon.komoot.io/api/");
  upstream.searchParams.set("q", q);
  upstream.searchParams.set("limit", "8");
  upstream.searchParams.set("countrycode", "IT");
  upstream.searchParams.set("lat", "44.77");
  upstream.searchParams.set("lon", "10.90");
  upstream.searchParams.set("location_bias_scale", "0.12");
  const r = await fetch(upstream.toString(), {
    headers: { "Accept": "application/json", "User-Agent": "SOS-Rider-Carpi-Soliera/1.0" }
  });
  if (!r.ok) throw new Error("Photon unavailable");
  return await r.json();
}

function mergeFeatures(a, b) {
  const out = [], seen = new Set();
  for (const f of [...a, ...b]) {
    const c = f?.geometry?.coordinates || [];
    const p = f?.properties || {};
    const key = `${p.osm_type || ""}:${p.osm_id || ""}:${c[0] || ""}:${c[1] || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

function json(obj, status, cors, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, ...extra, "Content-Type": "application/json; charset=utf-8" }
  });
}
