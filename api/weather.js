// /api/weather: current conditions in San Francisco for the /map city.
// Open-Meteo, no key. Cached 30 min at the edge. Returns a small, stable shape.
module.exports = async function handler(req, res) {
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "public, s-maxage=1800, stale-while-revalidate=3600");
  try {
    const u = "https://api.open-meteo.com/v1/forecast?latitude=37.7749&longitude=-122.4194&current=temperature_2m,cloud_cover,precipitation,wind_speed_10m,is_day,weather_code&timezone=America%2FLos_Angeles";
    const r = await fetch(u); if (!r.ok) throw new Error("open-meteo " + r.status);
    const j = await r.json(); const c = j.current || {};
    const code = c.weather_code ?? 0;
    const fog = code === 45 || code === 48 ? 1 : Math.min(1, (c.cloud_cover || 0) / 100) * 0.6;
    const rain = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) ? 1 : 0;
    res.end(JSON.stringify({ tempC: c.temperature_2m, tempF: c.temperature_2m != null ? Math.round(c.temperature_2m * 9 / 5 + 32) : null, cloud: c.cloud_cover, wind: c.wind_speed_10m, isDay: !!c.is_day, code, fog, rain, at: c.time }));
  } catch (e) {
    res.statusCode = 200;
    res.end(JSON.stringify({ tempC: null, tempF: null, cloud: 30, wind: 10, isDay: null, code: 0, fog: 0.25, rain: 0, error: String(e.message || e) }));
  }
};
