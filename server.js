const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
require("dotenv").config({ override: true });
const { createClient } = require("@supabase/supabase-js");

const PORT = Number(process.env.PORT || 5173);
const ROOT = __dirname;
const DEFAULT_WINERY_ID = process.env.WINERY_ID || "d37461d4-bf09-4f45-9e36-35d49baf84a8";
const DWS_BASE_URL = process.env.DWS_BASE_URL || "https://api-dws.divinea.com/api";
const REPORT_EMAIL = process.env.REPORT_EMAIL || "cantinatredaniele@gmail.com";
function normalizeHttpUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

const supabaseUrl = normalizeHttpUrl(process.env.SUPABASE_URL);
const supabase =
  supabaseUrl && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;

let cachedDwsToken = "";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function requireSupabase(res) {
  if (supabase) return true;
  sendJson(res, 503, { message: "Supabase non configurato sul server." });
  return false;
}

async function proxyPublicConfig(req, res) {
  sendJson(res, 200, {
    wineryId: DEFAULT_WINERY_ID,
    reportEmail: REPORT_EMAIL,
    hasSupabase: Boolean(supabase),
    hasServerDwsLogin: Boolean(process.env.DWS_EMAIL && process.env.DWS_PASSWORD)
  });
}

async function proxyOperatorLogin(req, res) {
  try {
    const body = await readBody(req);
    const pin = String(body.pin || "").trim();
    const allowedPins = String(process.env.OPERATOR_PIN_CODES || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!allowedPins.length) {
      sendJson(res, 200, { ok: true, mode: "open" });
      return;
    }

    if (allowedPins.includes(pin)) {
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 401, { message: "PIN non valido." });
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function getServerDwsToken() {
  if (cachedDwsToken) return cachedDwsToken;
  if (!process.env.DWS_EMAIL || !process.env.DWS_PASSWORD) return "";

  const upstream = await fetch(`${DWS_BASE_URL}/account/authenticate?lang=it`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.DWS_EMAIL,
      base64password: Buffer.from(process.env.DWS_PASSWORD, "utf8").toString("base64")
    })
  });
  const payload = await readUpstreamPayload(upstream);
  if (!upstream.ok) throw new Error(`Login DWS server HTTP ${upstream.status}`);
  const token = findToken(payload);
  if (!token) throw new Error("Token DWS server non trovato.");
  cachedDwsToken = token;
  return cachedDwsToken;
}

async function readUpstreamPayload(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Payload troppo grande."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("JSON non valido."));
      }
    });
    req.on("error", reject);
  });
}

function cleanBaseUrl(value) {
  const fallback = "https://api-crm.divinea.com/api";
  const raw = String(value || fallback).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return fallback;
    return raw.replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function findToken(value) {
  const tokenKeys = new Set([
    "token",
    "accessToken",
    "access_token",
    "jwt",
    "idToken",
    "id_token",
    "bearerToken",
    "bearer_token",
    "authorization"
  ]);

  if (!value || typeof value !== "object") return "";

  const stack = [value];
  const seen = new Set();
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    for (const [key, entry] of Object.entries(current)) {
      if (tokenKeys.has(key) && typeof entry === "string" && entry.length > 20) {
        return entry.replace(/^Bearer\s+/i, "");
      }
      if (entry && typeof entry === "object") stack.push(entry);
    }
  }

  return "";
}

function describeShape(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 2) return typeof value;
  if (Array.isArray(value)) return `array(${value.length})`;

  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 20)
      .map(([key, entry]) => [key, entry && typeof entry === "object" ? describeShape(entry, depth + 1) : typeof entry])
  );
}

function safeDetail(value) {
  if (!value || typeof value !== "object") return value;
  const clone = JSON.parse(JSON.stringify(value));
  const redactKeys = new Set(["token", "accessToken", "access_token", "jwt", "idToken", "id_token", "bearerToken", "bearer_token", "authorization"]);
  const stack = [clone];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    Object.keys(current).forEach((key) => {
      if (redactKeys.has(key)) current[key] = "[redacted]";
      else if (current[key] && typeof current[key] === "object") stack.push(current[key]);
    });
  }
  return clone;
}

async function proxyLogin(req, res) {
  try {
    const body = await readBody(req);
    const dwsBase = cleanDwsBaseUrl(body.dwsBase);
    const email = String(body.email || "").trim();
    const password = String(body.password || "");

    if (!email || !password) {
      sendJson(res, 400, { message: "Email e password DWS sono obbligatorie." });
      return;
    }

    const upstream = await fetch(`${dwsBase}/account/authenticate?lang=it`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ email, base64password: Buffer.from(password, "utf8").toString("base64") })
    });

    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, { message: `DWS login HTTP ${upstream.status}`, detail: payload });
      return;
    }

    const token = findToken(payload);
    if (!token) {
      sendJson(res, 502, {
        message: "Login DWS riuscito, ma token non trovato nella risposta.",
        shape: describeShape(payload)
      });
      return;
    }

    sendJson(res, 200, { ...payload, token });
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function proxyScheduling(req, res) {
  try {
    const body = await readBody(req);
    const dwsBase = cleanBaseUrl(body.dwsBase);
    const wineryId = String(body.wineryId || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();

    if (!wineryId || !dateFrom || !dateTo) {
      sendJson(res, 400, { message: "Winery ID e date sono obbligatori." });
      return;
    }

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
      "accept-language": "it",
      "User-Agent": "VignaCheckinDashboard/1.0"
    };
    if (body.apiKey) {
      headers.APIKey = body.apiKey;
    }
    headers["X-DWS-WINERY"] = wineryId;

    const requestBody = {
      startTime: dateFrom,
      endTime: dateTo,
      states: ["confirmed", "draft", "waiting", "completed"],
      wineryId,
      lang: "it"
    };

    const upstream = await fetch(`${dwsBase}/v2/reservations/query?lang=it`, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody)
    });
    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        message: `CRM reservations/query HTTP ${upstream.status}`,
        detail: safeDetail(payload),
        request: {
          url: `${dwsBase}/v2/reservations/query?lang=it`,
          body: requestBody,
          auth: body.apiKey ? "APIKey" : "none"
        }
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function proxyExperiences(req, res) {
  try {
    const body = await readBody(req);
    const companyId = String(body.wineryId || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const apiKey = String(body.apiKey || "").trim();
    const dwsBase = cleanBaseUrl(body.dwsBase);

    if (!companyId || !dateFrom || !dateTo) {
      sendJson(res, 400, { message: "Company ID e date sono obbligatori." });
      return;
    }

    const startdate = `${dateFrom}T00:00:00.000Z`;
    const enddate = `${dateTo}T24:00:00.000Z`;
    const params = new URLSearchParams({
      page: "1",
      per_page: "9999",
      company_ids: companyId,
      lang: "it",
      startdate,
      enddate,
      includeArchived: "true",
      includeInactive: "true",
      include_archived: "true",
      include_inactive: "true",
      includeInvisible: "true",
      include_invisible: "true"
    });

    const upstream = await fetch(`https://api.divinea.com/api/v2/experiences?${params}`, {
      headers: {
        Accept: "application/json",
        "accept-language": "it",
        "User-Agent": "VignaCheckinDashboard/1.0"
      }
    });
    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        message: `Public experiences HTTP ${upstream.status}`,
        detail: safeDetail(payload),
        request: { url: `https://api.divinea.com/api/v2/experiences?${params}` }
      });
      return;
    }

    const publicItems = Array.isArray(payload.data) ? payload.data : [];
    const crmItems = apiKey ? await fetchInactiveCrmExperiences({ dwsBase, apiKey, wineryId: companyId, dateFrom, dateTo }) : [];
    const merged = mergeExperiences(publicItems, crmItems);

    sendJson(res, 200, { ...payload, data: merged, total: merged.length });
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function proxyExperienceDetail(req, res) {
  try {
    const body = await readBody(req);
    const experienceId = String(body.experienceId || "").trim();
    if (!experienceId) {
      sendJson(res, 400, { message: "experienceId obbligatorio." });
      return;
    }

    const upstream = await fetch(`https://api.divinea.com/api/v2/experiences/${experienceId}?lang=it`, {
      headers: {
        Accept: "application/json",
        "accept-language": "it",
        "User-Agent": "VignaCheckinDashboard/1.0"
      }
    });
    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        message: `Public experience detail HTTP ${upstream.status}`,
        detail: safeDetail(payload)
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function proxyEventsByDate(req, res) {
  try {
    const body = await readBody(req);
    const dwsBase = cleanDwsBaseUrl(body.dwsBase);
    const wineryId = String(body.wineryId || "").trim();
    const dateFrom = String(body.dateFrom || "").trim();
    const dateTo = String(body.dateTo || "").trim();
    const bearerToken = String(body.bearerToken || "").replace(/^Bearer\s+/i, "").trim() || (await getServerDwsToken());

    if (!wineryId || !dateFrom || !dateTo || !bearerToken) {
      sendJson(res, 400, { message: "Bearer token, wineryId e date sono obbligatori per la ricerca eventi DWS." });
      return;
    }

    const params = new URLSearchParams({
      page: "0",
      count: "999999",
      wineryId,
      startTime: dateFrom,
      endTime: dateTo,
      lang: "it"
    });
    ["confirmed", "draft", "waiting", "completed"].forEach((state) => params.append("state", state));

    const upstream = await fetch(`${dwsBase}/scheduling/page?${params}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        "accept-language": "it",
        "User-Agent": "VignaCheckinDashboard/1.0"
      }
    });
    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        message: `DWS eventi per data HTTP ${upstream.status}`,
        detail: safeDetail(payload)
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function proxyReservationsByExperience(req, res) {
  try {
    const body = await readBody(req);
    const dwsBase = cleanDwsBaseUrl(body.dwsBase);
    const wineryId = String(body.wineryId || "").trim();
    const experienceId = String(body.experienceId || "").trim();
    const bearerToken = String(body.bearerToken || "").replace(/^Bearer\s+/i, "").trim() || (await getServerDwsToken());

    if (!wineryId || !experienceId || !bearerToken) {
      sendJson(res, 400, { message: "Bearer token, wineryId ed experienceId sono obbligatori." });
      return;
    }

    const params = new URLSearchParams({
      page: "0",
      count: "999999",
      wineryId,
      experienceId,
      lang: "it"
    });
    ["confirmed", "draft", "waiting", "completed"].forEach((state) => params.append("state", state));

    const upstream = await fetch(`${dwsBase}/scheduling/page?${params}`, {
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        Accept: "application/json",
        "accept-language": "it",
        "User-Agent": "VignaCheckinDashboard/1.0"
      }
    });
    const payload = await readUpstreamPayload(upstream);

    if (!upstream.ok) {
      sendJson(res, upstream.status, {
        message: `DWS scheduling/page HTTP ${upstream.status}`,
        detail: safeDetail(payload)
      });
      return;
    }

    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function upsertEventState(req, res) {
  if (!requireSupabase(res)) return;
  try {
    const body = await readBody(req);
    const experienceId = String(body.experienceId || "").trim();
    const eventName = String(body.eventName || "").trim();
    const eventDate = body.eventDate || null;
    const bookings = Array.isArray(body.bookings) ? body.bookings : [];
    const arrived = Array.isArray(body.arrived) ? body.arrived : [];

    if (!experienceId || !eventName) {
      sendJson(res, 400, { message: "experienceId ed eventName sono obbligatori." });
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from("checkin_events")
      .upsert(
        {
          experience_id: experienceId,
          event_name: eventName,
          event_date: eventDate,
          status: body.status || "open"
        },
        { onConflict: "experience_id,event_date" }
      )
      .select()
      .single();

    if (eventError) throw eventError;

    const rows = [
      ...bookings.map((payload) => ({ event_id: eventRow.id, dws_id: payload.dwsId || payload.id, section: "bookings", payload, deleted_at: null })),
      ...arrived.map((payload) => ({ event_id: eventRow.id, dws_id: payload.dwsId || payload.id, section: "arrived", payload, deleted_at: null }))
    ];

    const activeIds = rows.map((row) => row.dws_id).filter(Boolean);
    let deleteQuery = supabase.from("checkin_reservations").update({ deleted_at: new Date().toISOString() }).eq("event_id", eventRow.id);
    if (activeIds.length) deleteQuery = deleteQuery.not("dws_id", "in", `(${activeIds.map((id) => `"${String(id).replace(/"/g, '\\"')}"`).join(",")})`);
    const { error: deleteError } = await deleteQuery;
    if (deleteError) throw deleteError;

    if (rows.length) {
      const { error: reservationsError } = await supabase.from("checkin_reservations").upsert(rows, { onConflict: "event_id,dws_id" });
      if (reservationsError) throw reservationsError;
    }

    sendJson(res, 200, { ok: true, event: eventRow });
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

async function getEventState(req, res) {
  if (!requireSupabase(res)) return;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const experienceId = url.searchParams.get("experienceId");
    const eventDate = url.searchParams.get("eventDate");

    let query = supabase.from("checkin_events").select("*").eq("experience_id", experienceId).order("created_at", { ascending: false }).limit(1);
    if (eventDate) query = query.eq("event_date", eventDate);

    const { data: events, error: eventError } = await query;
    if (eventError) throw eventError;
    const eventRow = events?.[0];
    if (!eventRow) {
      sendJson(res, 200, { event: null, bookings: [], arrived: [] });
      return;
    }

    const { data: reservations, error: reservationsError } = await supabase
      .from("checkin_reservations")
      .select("*")
      .eq("event_id", eventRow.id)
      .is("deleted_at", null);
    if (reservationsError) throw reservationsError;

    sendJson(res, 200, {
      event: eventRow,
      bookings: reservations.filter((row) => row.section === "bookings").map((row) => row.payload),
      arrived: reservations.filter((row) => row.section === "arrived").map((row) => row.payload)
    });
  } catch (error) {
    sendJson(res, 500, { message: error.message });
  }
}

function cleanDwsBaseUrl(value) {
  const fallback = "https://api-dws.divinea.com/api";
  const raw = String(value || fallback).trim();
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.hostname !== "localhost") return fallback;
    if (url.hostname.includes("api-crm")) return fallback;
    if (url.hostname === "api.divinea.com") return fallback;
    return raw.replace(/\/+$/, "").replace(/\/scheduling\/page$/i, "");
  } catch {
    return fallback;
  }
}

function mergeExperiences(publicItems, crmItems) {
  const map = new Map();
  [...publicItems, ...crmItems].forEach((item) => {
    if (!item?.id) return;
    map.set(String(item.id), { ...(map.get(String(item.id)) || {}), ...item });
  });
  return [...map.values()];
}

async function fetchInactiveCrmExperiences({ dwsBase, apiKey, wineryId, dateFrom, dateTo }) {
  const queries = italianDateSearchTerms(dateFrom, dateTo);
  const found = [];

  for (const fullTextSearch of queries) {
    const upstream = await fetch(`${dwsBase}/v2/experiences/query`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        APIKey: apiKey,
        "X-DWS-WINERY": wineryId
      },
      body: JSON.stringify({
        fullTextSearch,
        includeArchived: true,
        includeInactive: true,
        wineryId
      })
    });

    if (!upstream.ok) continue;
    const payload = await readUpstreamPayload(upstream);
    const items = Array.isArray(payload) ? payload : payload.data || payload.content || [];
    items.forEach((item) => found.push({ ...item, _source: "crm-inactive" }));
  }

  return found;
}

function italianDateSearchTerms(dateFrom, dateTo) {
  const terms = new Set();
  const months = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
  const start = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);

  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const day = d.getUTCDate();
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    terms.add(`${day} ${month} ${year}`);
    terms.add(`${day} ${capitalize(month)} ${year}`);
    terms.add(`${String(day).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${year}`);
    terms.add(`${year}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }

  return [...terms];
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const absolutePath = path.resolve(ROOT, `.${requestedPath}`);

  if (!absolutePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(absolutePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const contentType = MIME_TYPES[path.extname(absolutePath)] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(content);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = requestUrl.pathname.replace(/\/+$/, "") || "/";

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/config") {
    proxyPublicConfig(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/operator-login") {
    proxyOperatorLogin(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/event-state") {
    upsertEventState(req, res);
    return;
  }

  if (req.method === "GET" && pathname === "/api/event-state") {
    getEventState(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/login") {
    proxyLogin(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/scheduling") {
    proxyScheduling(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/experiences") {
    proxyExperiences(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/experience-detail") {
    proxyExperienceDetail(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/events-by-date") {
    proxyEventsByDate(req, res);
    return;
  }

  if (req.method === "POST" && pathname === "/api/reservations-by-experience") {
    proxyReservationsByExperience(req, res);
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    serveStatic(req, res);
    return;
  }

  sendJson(res, 405, { message: "Metodo non supportato." });
});

server.listen(PORT, () => {
  console.log(`Vigna Check-in Dashboard: http://localhost:${PORT}`);
});
