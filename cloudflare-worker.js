export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (url.pathname === "/") return new Response("SOS Rider V7.2 proxy OK", { status: 200, headers: cors });
    if (url.pathname === "/api/status" && request.method === "GET") {
      return json({ ok: true, version: "V7.2", autocomplete: true, googleRoutesConfigured: !!env.GOOGLE_MAPS_API_KEY }, 200, cors);
    }
    if (url.pathname === "/api/address" && request.method === "GET") {
      const q = (url.searchParams.get("q") || "").trim();
      if (q.length < 3) return json({ type: "FeatureCollection", features: [] }, 200, cors);
      const upstream = new URL("https://photon.komoot.io/api/");
      upstream.searchParams.set("q", q);
      upstream.searchParams.set("limit", "8");
      upstream.searchParams.set("countrycode", "IT");
      upstream.searchParams.set("lat", "44.77");
      upstream.searchParams.set("lon", "10.90");
      upstream.searchParams.set("location_bias_scale", "0.15");
      try {
        const r = await fetch(upstream.toString(), { headers: { "Accept": "application/json", "User-Agent": "SOS-Rider-Carpi-Soliera/1.0" } });
        const body = await r.text();
        return new Response(body, { status: r.status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" } });
      } catch {
        return json({ type: "FeatureCollection", features: [], error: "autocomplete_unavailable" }, 502, cors);
      }
    }
    if (url.pathname === "/api/route" && request.method === "POST") {
      if (!env.GOOGLE_MAPS_API_KEY) return json({ error: "Manca il secret GOOGLE_MAPS_API_KEY nel Worker Cloudflare." }, 500, cors);
      let body;
      try { body = await request.json(); } catch { return json({ error: "Richiesta non valida." }, 400, cors); }
      const origin = String(body.origin || "").trim();
      const destination = String(body.destination || "").trim();
      const allowed = new Set(["BICYCLE", "TWO_WHEELER", "DRIVE"]);
      const mode = allowed.has(body.mode) ? body.mode : "BICYCLE";
      if (!origin || !destination) return json({ error: "Origine e destinazione sono obbligatorie." }, 400, cors);
      const payload = {
        origin: makeWaypoint(origin, body.originLat, body.originLon),
        destination: makeWaypoint(destination, body.destinationLat, body.destinationLon),
        travelMode: mode,
        computeAlternativeRoutes: false,
        regionCode: "IT",
        units: "METRIC"
      };
      if (mode === "DRIVE") payload.routingPreference = "TRAFFIC_AWARE";
      try {
        const r = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Goog-Api-Key": env.GOOGLE_MAPS_API_KEY, "X-Goog-FieldMask": "routes.distanceMeters,routes.duration" },
          body: JSON.stringify(payload)
        });
        const data = await r.json();
        if (!r.ok) return json({ error: data?.error?.message || "Google Routes non disponibile." }, r.status, cors);
        const route = data?.routes?.[0];
        if (!route) return json({ error: "Nessun percorso trovato." }, 404, cors);
        return json({ distanceMeters: route.distanceMeters || 0, duration: route.duration || "0s", mode }, 200, cors);
      } catch {
        return json({ error: "Errore durante il calcolo del percorso." }, 502, cors);
      }
    }
    return new Response("Not found", { status: 404, headers: cors });
  }
};
function makeWaypoint(address, lat, lon) {
  const la = Number(lat), lo = Number(lon);
  if (Number.isFinite(la) && Number.isFinite(lo)) return { location: { latLng: { latitude: la, longitude: lo } } };
  return { address: qualify(address) };
}
function qualify(address) {
  const a = String(address || "").trim();
  return /\b(italia|italy)\b/i.test(a) ? a : `${a}, Italia`;
}
function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), { status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" } });
}
