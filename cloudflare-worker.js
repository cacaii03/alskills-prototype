/**
 * ALSKILL CORS Proxy (Cloudflare Worker)
 *
 * Purpose:
 * - Allow browser-based frontends (e.g., GitHub Pages) to call a Google Apps Script Web App
 *   without CORS/preflight failures.
 *
 * How it works:
 * - Responds to OPTIONS preflight with Access-Control-Allow-* headers.
 * - For GET/POST, forwards the request to the Google Apps Script /exec URL.
 * - Adds permissive CORS headers to the response.
 *
 * IMPORTANT:
 * - This is a simple demo proxy. If you need stricter security, restrict origins
 *   and add authentication (API key / signed token).
 */

export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const target = (env && env.GAS_WEBAPP_URL)
      ? env.GAS_WEBAPP_URL
      : "https://script.google.com/macros/s/AKfycbzbWmKwqpiwLxqI_HUhMAnpVe1rckO8ocGJeWtc7CRonFQd4kjQYGsQFCEBNYBtOGMfYg/exec";

    const url = new URL(request.url);
    const forwardUrl = new URL(target);

    // Forward query params to GAS for GET routes (action=...&course=...)
    url.searchParams.forEach((value, key) => {
      forwardUrl.searchParams.set(key, value);
    });

    // Forward request
    const init = {
      method: request.method,
      headers: { "Content-Type": request.headers.get("Content-Type") || "application/json" }
    };
    if (request.method === "POST") {
      init.body = await request.text();
    }

    const upstream = await fetch(forwardUrl.toString(), init);
    const text = await upstream.text();

    // Preserve upstream status, add CORS
    const headers = new Headers(upstream.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => headers.set(k, v));
    headers.set("Content-Type", "application/json; charset=utf-8");

    return new Response(text, { status: upstream.status, headers });
  }
};

