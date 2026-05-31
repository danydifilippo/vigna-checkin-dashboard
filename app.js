const STORAGE_KEY = "vigna-checkin-dashboard-v2";
const REPORT_EMAIL = "cantinatredaniele@gmail.com";
const EMAILJS_SERVICE_ID = "service_cz94q8t";
const EMAILJS_TEMPLATE_ID = "template_ua752cz";
const EMAILJS_PUBLIC_KEY = "617iOJS1t_89uMo7S";

const defaultConfig = {
  dwsEmail: "",
  dwsPassword: "",
  bearerToken: "",
  apiKey: "",
  wineryId: "d37461d4-bf09-4f45-9e36-35d49baf84a8",
  dwsBase: "https://api-crm.divinea.com/api"
};

const columns = [
  ["nominativo", "Nominativo", "text"],
  ["note", "Note", "textarea"],
  ["adultiPrenotati", "Adulti Prenotati", "number"],
  ["bambiniPrenotati", "Bambini Prenotati", "number"],
  ["altroPrenotati", "Altro Prenotati", "number"],
  ["adulti", "Adulti", "number"],
  ["bambini", "Bambini", "number"],
  ["altro", "Altro", "number"],
  ["prenotati", "Prenotati", "computed"],
  ["arrivati", "Arrivati", "computed"],
  ["daPagare", "Da Pagare", "money"],
  ["sconto", "Sconto", "number"],
  ["extra", "Extra", "number"],
  ["bottiglie", "Bottiglie", "number"],
  ["paypal", "PAYPAL", "moneyInput"],
  ["cash", "Cash", "moneyInput"],
  ["pos", "POS", "moneyInput"],
  ["pagato", "PAGATO", "money"],
  ["ancoraDaPagare", "Ancora Da Pagare", "money"],
  ["arrivatiAction", "Arrivati?", "action"],
  ["stato", "Stato", "state"]
];

const numericKeys = new Set([
  "adultiPrenotati",
  "bambiniPrenotati",
  "altroPrenotati",
  "adulti",
  "bambini",
  "altro",
  "sconto",
  "extra",
  "bottiglie",
  "paypal",
  "cash",
  "pos"
]);

const state = loadState();
let eventsByDate = [];
let modalContext = { rowId: null, collection: null };
let reservationSearch = "";
let publicConfig = {};

const $ = (selector) => document.querySelector(selector);

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    const config = { ...defaultConfig, ...(parsed?.config || {}) };
    if (String(config.dwsBase || "").includes("api-dws.divinea.com")) {
      config.dwsBase = defaultConfig.dwsBase;
    }
    return {
      config,
      bookings: parsed?.bookings || [],
      arrived: parsed?.arrived || [],
      eventData: parsed?.eventData || {},
      currentEvent: parsed?.currentEvent || null
    };
  } catch {
    return { config: { ...defaultConfig }, bookings: [], arrived: [], eventData: {}, currentEvent: null };
  }
}

function saveState() {
  const cleanConfig = { ...state.config, dwsPassword: "" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, config: cleanConfig }));
}

function persistCurrentEventData() {
  if (!state.currentEvent?.id) return;
  state.eventData[state.currentEvent.id] = {
    bookings: state.bookings,
    arrived: state.arrived,
    currentEvent: state.currentEvent
  };
}

function saveAndPersist() {
  persistCurrentEventData();
  saveState();
  syncCurrentEventState();
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config");
    const config = await parseJsonResponse(response);
    if (!response.ok) return;
    publicConfig = config;
    if (config.wineryId && (!state.config.wineryId || state.config.wineryId === defaultConfig.wineryId)) {
      state.config.wineryId = config.wineryId;
      saveState();
    }
    fillSettings();
  } catch {
    // Local static fallback: keep saved/default settings.
  }
}

async function fetchSharedEventState(event) {
  const eventDate = $("#dateFrom").value || state.currentEvent?.date || dateToday();
  const params = new URLSearchParams({ experienceId: event.id, eventDate });
  const response = await fetch(`/api/event-state?${params}`);
  const payload = await parseJsonResponse(response);
  if (!response.ok) return null;
  return payload;
}

async function syncCurrentEventState() {
  if (!state.currentEvent?.id || !publicConfig.hasSupabase) return;
  try {
    const response = await fetch("/api/event-state", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        experienceId: state.currentEvent.id,
        eventName: state.currentEvent.title,
        eventDate: state.currentEvent.date || $("#dateFrom").value || dateToday(),
        bookings: state.bookings,
        arrived: state.arrived,
        status: "open"
      })
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      console.warn("Sync Supabase fallito", payload);
      setNotice(`Attenzione: salvataggio cloud non riuscito (${payload.message || response.status}).`, true);
    }
  } catch {
    setNotice("Attenzione: salvataggio cloud non riuscito. Controlla connessione/Supabase.", true);
  }
}

function numberValue(value) {
  const numeric = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(numeric) ? numeric : 0;
}

function centsToEuro(cents) {
  return numberValue(cents) / 100;
}

function euro(value) {
  return numberValue(value).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}

function plainEuro(value) {
  return numberValue(value).toFixed(2).replace(".", ",");
}

function dateToday() {
  return new Date().toISOString().slice(0, 10);
}

function findToken(value) {
  const tokenKeys = new Set(["token", "accessToken", "access_token", "jwt", "idToken", "id_token", "bearerToken", "bearer_token", "authorization"]);
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

async function loginDws() {
  const email = $("#dwsEmail").value.trim();
  const password = $("#dwsPassword").value;
  if (!email || !password) throw new Error("Inserisci email e password DWS.");

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ dwsBase: state.config.dwsBase, email, password })
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || `Login non riuscito: HTTP ${response.status}`);
  const token = findToken(payload);
  if (!token) throw new Error("Token non trovato nella risposta DWS.");

  state.config.dwsEmail = email;
  state.config.dwsPassword = "";
  state.config.bearerToken = token;
  $("#bearerToken").value = token;
  saveState();
  fillSettings();
  render();
}

async function fetchExperiences(dateFrom, dateTo) {
  if (state.config.bearerToken || publicConfig.hasServerDwsLogin) {
    return fetchDwsEventsByDate(dateFrom, dateTo);
  }

  const response = await fetch("/api/experiences", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      wineryId: state.config.wineryId,
      apiKey: state.config.apiKey,
      dwsBase: state.config.dwsBase,
      dateFrom,
      dateTo
    })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = payload.detail ? ` Dettaglio: ${JSON.stringify(payload.detail).slice(0, 500)}` : "";
    throw new Error(`${payload.message || `Errore ricerca esperienze: HTTP ${response.status}`}.${detail}`);
  }
  return payload;
}

async function fetchDwsEventsByDate(dateFrom, dateTo) {
  const [dwsResponse, publicResponse] = await Promise.all([
    fetch("/api/events-by-date", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        dwsBase: state.config.dwsBase,
        bearerToken: state.config.bearerToken,
        wineryId: state.config.wineryId,
        dateFrom,
        dateTo
      })
    }),
    fetch("/api/experiences", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        wineryId: state.config.wineryId,
        apiKey: state.config.apiKey,
        dwsBase: state.config.dwsBase,
        dateFrom,
        dateTo
      })
    })
  ]);

  const payload = await parseJsonResponse(dwsResponse);
  if (!dwsResponse.ok) {
    const detail = payload.detail ? ` Dettaglio: ${JSON.stringify(payload.detail).slice(0, 500)}` : "";
    throw new Error(`${payload.message || `Errore ricerca eventi DWS: HTTP ${dwsResponse.status}`}.${detail}`);
  }

  const publicPayload = await parseJsonResponse(publicResponse);
  const publicExperiences = publicResponse.ok ? arrayFromPayload(publicPayload) : [];
  const publicById = new Map(publicExperiences.map((experience) => [String(experience.id), experience]));
  const events = normalizeDwsEvents(arrayFromPayload(payload)).map((event) => ({
    ...event,
    raw: publicById.get(event.id) || event.raw || {}
  }));

  return { data: events, total: arrayFromPayload(payload).length };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function fetchExperienceDetail(experienceId) {
  const response = await fetch("/api/experience-detail", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ experienceId })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) return null;
  if (Array.isArray(payload?.data)) return payload.data[0] || null;
  if (Array.isArray(payload)) return payload[0] || null;
  return payload?.data || payload;
}

function buildSchedulingParams(dateFrom, dateTo) {
  const params = new URLSearchParams({
    page: "0",
    count: "999999",
    wineryId: state.config.wineryId,
    startTime: dateFrom,
    endTime: dateTo,
    lang: "it"
  });
  ["confirmed", "draft", "waiting", "completed"].forEach((status) => params.append("state", status));
  return params;
}

function arrayFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  return payload?.content || payload?.data || payload?.items || payload?.reservations || payload?.schedules || [];
}

function normalizeExperienceEvents(experiences) {
  return experiences
    .filter((experience) => experience._source === "dws-scheduling" || experience._source === "crm-inactive" || isEventExperience(experience))
    .map((experience) => ({
      id: String(experience.id || ""),
      title: experience.title || experience.title_translations?.it || "Esperienza senza titolo",
      price: experience.price ? `${experience.price_symbol || "€"}${experience.price}` : "",
      duration: formatDuration(experience.duration),
      priority: Number(experience.priority || 0),
      cover: experience.cover?.s || experience.cover?.m || "",
      source: experience._source || "public",
      raw: experience,
      reservations: experience.reservations || []
    }))
    .filter((event) => event.id)
    .sort((a, b) => a.priority - b.priority || a.title.localeCompare(b.title, "it"));
}

function normalizeDwsEvents(reservations) {
  const map = new Map();
  reservations.forEach((reservation) => {
    if (String(reservation.state || "").toLowerCase() === "removed") return;
    const id = String(reservation.experienceId || reservation.experience?.id || reservation.experience_id || "");
    if (!id) return;
    const title =
      reservation.experienceTitleIt ||
      reservation.experienceTitle ||
      reservation.experience?.title_translations?.it ||
      reservation.experience?.title ||
      "Evento senza titolo";

    if (!map.has(id)) {
      map.set(id, {
        id,
        title,
        _source: "dws-scheduling",
        raw: {},
        reservations: []
      });
    }
    map.get(id).reservations.push(reservation);
  });
  return [...map.values()];
}

function formatDuration(duration) {
  if (!duration) return "";
  if (typeof duration === "number") return `${Math.round(duration / 60)} min`;
  return String(duration);
}

function isEventExperience(experience) {
  return (experience.tags || []).some((tag) => {
    const categoryCode = String(tag?.category?.code || "").toLowerCase();
    const name = String(tag?.name || "").toLowerCase();
    return categoryCode === "exptype" && name === "evento";
  });
}

function labelTitle(label) {
  return String(
    label?.title_translations?.it ||
      label?.titleTranslations?.it ||
      label?.title ||
      label?.label ||
      label?.name ||
      label?.priceLabelTitle ||
      ""
  );
}

function labelKind(label) {
  const title = labelTitle(label).toLowerCase();
  if (title.includes("adulti") || title.includes("adulto") || title.includes("vino")) return "adulti";
  if (title.includes("bambini") || title.includes("bambino") || title.includes("bambin")) return "bambini";
  return "altro";
}

function parseEuroString(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^\d,.-]/g, "").replace(",", ".");
  return numberValue(cleaned);
}

function labelPriceEuro(label) {
  const cents =
    label?.price_cents ??
    label?.priceCents ??
    label?.unitPriceCents ??
    label?.amountCentsPerUnit ??
    label?.amount_cents_per_unit;
  if (cents !== undefined && cents !== null && cents !== "") return centsToEuro(cents);
  return parseEuroString(label?.price ?? label?.priceEur ?? label?.unitPrice ?? label?.amountPerUnit);
}

function labelQuantity(label) {
  const direct =
    label?.quantity ??
    label?.qty ??
    label?.count ??
    label?.totalQuantity ??
    label?.total_quantity ??
    label?.reservedQuantity ??
    label?.reserved_quantity ??
    label?.selectedQuantity ??
    label?.selected_quantity ??
    label?.quantitySelected ??
    label?.quantity_selected ??
    label?.number ??
    label?.value;
  if (direct !== undefined && direct !== null && direct !== "") return numberValue(direct);

  const nested =
    label?.reservation?.quantity ??
    label?.reservationPrice?.quantity ??
    label?.priceLabel?.quantity ??
    label?.data?.quantity;
  return numberValue(nested);
}

function firstNumberFrom(source, keys) {
  for (const key of keys) {
    const value = key.split(".").reduce((acc, part) => acc?.[part], source);
    if (value !== undefined && value !== null && value !== "") {
      const number = numberValue(value);
      if (number > 0) return number;
    }
  }
  return 0;
}

function reservationGuestQuantities(reservation) {
  const bambini = firstNumberFrom(reservation, [
    "children",
    "childrens",
    "childrenQuantity",
    "children_quantity",
    "childQuantity",
    "child_quantity",
    "numberOfChildren",
    "number_of_children",
    "kids",
    "kidsQuantity",
    "kids_quantity"
  ]);
  let adulti = firstNumberFrom(reservation, [
    "adults",
    "adulti",
    "adultsQuantity",
    "adults_quantity",
    "adultQuantity",
    "adult_quantity",
    "numberOfAdults",
    "number_of_adults"
  ]);
  const totale = firstNumberFrom(reservation, [
    "people",
    "guests",
    "participants",
    "participantCount",
    "participant_count",
    "peopleQuantity",
    "people_quantity",
    "quantity",
    "pax",
    "totalPeople",
    "total_people",
    "numberOfParticipants",
    "number_of_participants"
  ]);
  if (!adulti && totale > bambini) adulti = totale - bambini;
  return { adulti, bambini };
}

function normalizeLabelKey(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function labelCategoryFromTitle(title) {
  return String(title || "").toLowerCase().includes("bambin") ? "bambini" : "adulti";
}

function createPriceLabel(title, price, source = "event") {
  const cleanTitle = String(title || "").trim();
  if (!cleanTitle) return null;
  return {
    key: normalizeLabelKey(cleanTitle),
    title: cleanTitle,
    category: labelCategoryFromTitle(cleanTitle),
    quantityPren: 0,
    quantityArr: 0,
    price: numberValue(price),
    source
  };
}

function buildEventPriceLabels(eventRaw = {}) {
  const labels = [];
  const baseTitle = eventRaw.price01_label || eventRaw.price1_label || eventRaw.price_label;
  if (baseTitle || eventRaw.price) {
    const base = createPriceLabel(baseTitle || "Adulti", parseEuroString(eventRaw.price), "base");
    if (base) labels.push(base);
  }

  for (let index = 2; index <= 10; index += 1) {
    const padded = String(index).padStart(2, "0");
    const label = eventRaw[`price${padded}_label`] || eventRaw[`price${index}_label`];
    const active = eventRaw[`price${padded}_active`] ?? eventRaw[`price${index}_active`];
    const price = eventRaw[`price${padded}`] ?? eventRaw[`price${index}`];
    if (!label || String(active) === "false") continue;
    const item = createPriceLabel(label, parseEuroString(price), `price${padded}`);
    if (item) labels.push(item);
  }

  [...(eventRaw.experience_price_labels || eventRaw.experiencePriceLabels || []), ...(eventRaw.experience_price_extras || eventRaw.experiencePriceExtras || [])].forEach((label) => {
    const item = createPriceLabel(labelTitle(label), labelPriceEuro(label), "experience");
    if (item) labels.push(item);
  });

  return mergeLabelRows(labels);
}

function stripHtml(value) {
  const div = document.createElement("div");
  div.innerHTML = String(value || "");
  return div.textContent.replace(/\s+/g, " ").trim();
}

function eventDescription(event) {
  const raw = event.raw || {};
  const text =
    raw.description_translations?.it ||
    raw.descriptionTranslations?.it ||
    raw.description ||
    raw.short_description_translations?.it ||
    raw.shortDescriptionTranslations?.it ||
    raw.short_description ||
    raw.shortDescription ||
    raw.subtitle_translations?.it ||
    raw.subtitle ||
    "";
  return stripHtml(text);
}

function eventPriceLabels(event) {
  const labels = buildEventPriceLabels(event.raw || {});
  if (labels.length) return labels;
  if (!event.price) return [];
  return [createPriceLabel("Ingresso", parseEuroString(event.price), "summary")].filter(Boolean);
}

async function enrichEventsWithDetails(events) {
  return Promise.all(
    events.map(async (event) => {
      const detail = await fetchExperienceDetail(event.id).catch(() => null);
      if (!detail) return event;
      return {
        ...event,
        price: event.price || (detail.price ? `${detail.price_symbol || "€"}${detail.price}` : ""),
        duration: event.duration || formatDuration(detail.duration),
        raw: { ...(event.raw || {}), ...detail }
      };
    })
  );
}

function mergeLabelRows(labels) {
  const map = new Map();
  labels.forEach((label) => {
    if (!label?.key) return;
    const existing = map.get(label.key);
    if (!existing) {
      map.set(label.key, { ...label });
      return;
    }
    existing.quantityPren += numberValue(label.quantityPren);
    existing.quantityArr += numberValue(label.quantityArr);
    if (numberValue(label.price) > 0) existing.price = numberValue(label.price);
    if (label.category === "bambini") existing.category = "bambini";
  });
  return [...map.values()];
}

function getCurrentEventLabels() {
  const currentRaw =
    state.currentEvent?.raw ||
    eventsByDate.find((event) => event.id === state.currentEvent?.id)?.raw ||
    {};
  const labels = buildEventPriceLabels(currentRaw);
  if (labels.length) return labels;
  const sample = [...state.bookings, ...state.arrived].find((row) => Array.isArray(row.labels) && row.labels.length);
  return sample ? sample.labels.map((label) => ({ ...label, quantityPren: 0, quantityArr: 0 })) : [];
}

function upgradeRowLabels(row, eventRaw = {}) {
  const eventLabels = buildEventPriceLabels(eventRaw);
  if (!eventLabels.length) return row;

  const currentLabels = Array.isArray(row.labels) ? row.labels : [];
  let labels = mergeLabelRows([...eventLabels, ...currentLabels.map((label) => ({ ...label }))]);

  if (!currentLabels.length) {
    const firstAdult = labels.find((label) => label.category !== "bambini");
    const firstChild = labels.find((label) => label.category === "bambini");
    if (firstAdult) {
      firstAdult.quantityPren = numberValue(row.adultiPrenotati);
      firstAdult.quantityArr = numberValue(row.adulti);
    }
    if (firstChild) {
      firstChild.quantityPren = numberValue(row.bambiniPrenotati);
      firstChild.quantityArr = numberValue(row.bambini);
    }
  }

  labels = mergeLabelRows(labels);
  return {
    ...row,
    labels,
    adultiPrenotati: labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0),
    bambiniPrenotati: labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0),
    adulti: labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0),
    bambini: labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0)
  };
}

function eventPriceFallbacks(eventRaw = {}) {
  const prices = { adulti: parseEuroString(eventRaw.price), bambini: 0, altro: 0 };
  const labels = [
    ...(eventRaw.experience_price_labels || eventRaw.experiencePriceLabels || []),
    ...(eventRaw.reservationPriceLabels || eventRaw.reservation_price_labels || [])
  ];
  labels.forEach((label) => {
    const kind = labelKind(label);
    const price = labelPriceEuro(label);
    if (price > 0) prices[kind] = price;
  });
  return prices;
}

function mergePrices(...priceSets) {
  return priceSets.reduce(
    (acc, prices) => {
      if (!prices) return acc;
      ["adulti", "bambini", "altro"].forEach((key) => {
        if (numberValue(prices[key]) > 0) acc[key] = numberValue(prices[key]);
      });
      return acc;
    },
    { adulti: 0, bambini: 0, altro: 0 }
  );
}

function collectReservationPrices(reservations = []) {
  const prices = { adulti: 0, bambini: 0, altro: 0 };
  reservations.forEach((reservation) => {
    const labels = [
      ...(reservation.reservationPriceLabels || reservation.reservation_price_labels || []),
      ...(reservation.priceLabels || reservation.price_labels || []),
      ...(reservation.labels || []),
      ...(reservation.items || []),
      ...(reservation.experiencePrices || reservation.experience_prices || []),
      ...(reservation.experiencePriceLabels || reservation.experience_price_labels || [])
    ];

    labels.forEach((label) => {
      const kind = labelKind(label);
      const price = labelPriceEuro(label);
      if (price > 0) prices[kind] = price;
    });
  });
  return prices;
}

function createRow(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    dwsId: "",
    nominativo: "",
    note: "",
    adultiPrenotati: 0,
    bambiniPrenotati: 0,
    altroPrenotati: 0,
    adulti: "",
    bambini: "",
    altro: "",
    prices: { adulti: 0, bambini: 0, altro: 0 },
    sconto: "",
    extra: "",
    bottiglie: "",
    paypal: "",
    cash: "",
    pos: "",
    stato: "Confermato",
    sourceState: "confirmed",
    ...overrides
  };
}

function normalizeReservation(reservation, eventTitle, eventRaw = {}, eventPrices = {}) {
  const fallbackPrices = mergePrices(eventPriceFallbacks(eventRaw), eventPrices);
  const dynamicLabels = buildEventPriceLabels(eventRaw);
  const row = createRow({
    id: String(reservation.id || reservation.reservationId || crypto.randomUUID()),
    dwsId: String(reservation.id || reservation.reservationId || ""),
    nominativo: reservation.masterContactName || reservation.master_contact_name || reservation.contactName || "",
    note: reservation.message || reservation.notes || reservation.otherData?.message || "",
    paypal:
      reservation.otherData?.paid === true || String(reservation.otherData?.paid) === "true"
        ? centsToEuro(reservation.otherData?.paidTotalCents || reservation.grossTotalCents)
        : "",
    stato: reservation.state === "confirmed" ? "Confermato" : reservation.state || "Confermato",
    sourceState: reservation.state,
    eventTitle,
    prices: fallbackPrices,
    labels: dynamicLabels
  });

  const labels = [
    ...(reservation.reservationPriceLabels || reservation.reservation_price_labels || []),
    ...(reservation.priceLabels || reservation.price_labels || []),
    ...(reservation.labels || []),
    ...(reservation.items || []),
    ...(reservation.experiencePrices || reservation.experience_prices || []),
    ...(reservation.experiencePriceLabels || reservation.experience_price_labels || [])
  ];

  labels.forEach((label) => {
    const quantity = labelQuantity(label);
    const kind = labelKind(label);
    const price = labelPriceEuro(label);
    if (price > 0) row.prices[kind] = price;

    const title = labelTitle(label) || (kind === "bambini" ? "Bambini" : "Adulti");
    const dynamicLabel = createPriceLabel(title, price || row.prices[kind], "reservation");
    if (dynamicLabel) {
      dynamicLabel.quantityPren = quantity > 0 ? quantity : 0;
      row.labels.push(dynamicLabel);
    }

    if (quantity <= 0) return;

    if (kind === "adulti") row.adultiPrenotati += quantity;
    if (kind === "bambini") row.bambiniPrenotati += quantity;
    if (kind === "altro") row.altroPrenotati += quantity;
  });

  row.labels = mergeLabelRows(row.labels);
  const guestQuantities = reservationGuestQuantities(reservation);
  const currentAdults = row.labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0);
  const currentChildren = row.labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0);
  if (guestQuantities.adulti > currentAdults) {
    const adultLabel = row.labels.find((label) => label.category !== "bambini");
    if (adultLabel) adultLabel.quantityPren += guestQuantities.adulti - currentAdults;
  }
  if (guestQuantities.bambini > currentChildren) {
    const childLabel = row.labels.find((label) => label.category === "bambini");
    if (childLabel) childLabel.quantityPren += guestQuantities.bambini - currentChildren;
  }
  row.labels = mergeLabelRows(row.labels);
  row.adultiPrenotati = row.labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0);
  row.bambiniPrenotati = row.labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0);

  return row;
}

function computeRow(row) {
  if (Array.isArray(row.labels) && row.labels.length) {
    const prenotati = row.labels.reduce((sum, label) => sum + numberValue(label.quantityPren), 0);
    const arrivati = row.labels.reduce((sum, label) => sum + numberValue(label.quantityArr), 0);
    const daPagare =
      row.labels.reduce((sum, label) => sum + numberValue(label.quantityArr) * numberValue(label.price), 0) +
      numberValue(row.extra) +
      numberValue(row.bottiglie) -
      numberValue(row.sconto);
    const pagato = numberValue(row.paypal) + numberValue(row.cash) + numberValue(row.pos);
    return { prenotati, arrivati, daPagare, pagato, ancoraDaPagare: daPagare - pagato };
  }

  const adulti = numberValue(row.adulti);
  const bambini = numberValue(row.bambini);
  const altro = numberValue(row.altro);
  const pagato = numberValue(row.paypal) + numberValue(row.cash) + numberValue(row.pos);
  const daPagare =
    adulti * numberValue(row.prices?.adulti) +
    bambini * numberValue(row.prices?.bambini) +
    altro * numberValue(row.prices?.altro) +
    numberValue(row.extra) +
    numberValue(row.bottiglie) -
    numberValue(row.sconto);

  return {
    prenotati: numberValue(row.adultiPrenotati) + numberValue(row.bambiniPrenotati) + numberValue(row.altroPrenotati),
    arrivati: adulti + bambini + altro,
    daPagare,
    pagato,
    ancoraDaPagare: daPagare - pagato
  };
}

function importEvent(eventId) {
  const event = eventsByDate.find((item) => item.id === eventId);
  if (!event) return;
  loadReservationsForEvent(event);
}

async function loadReservationsForEvent(event) {
  setNotice(`Caricamento prenotazioni per "${event.title}"...`);

  try {
    persistCurrentEventData();
    const savedEvent = state.eventData[event.id] || {};
    const sharedEvent = publicConfig.hasSupabase ? await fetchSharedEventState(event).catch(() => null) : null;
    const savedSource = sharedEvent?.event ? sharedEvent : savedEvent;
    const payload = await fetchReservationsByExperience(event.id);
    const detail = await fetchExperienceDetail(event.id);
    const eventRaw = { ...(event.raw || {}), ...(detail || {}) };
    const savedArrived = (savedSource.arrived || []).map((row) => upgradeRowLabels(row, eventRaw));
    const savedBookings = (savedSource.bookings || []).map((row) => upgradeRowLabels(row, eventRaw));
    const savedManualBookings = savedBookings.filter((row) => !row.dwsId);
    const reservations = arrayFromPayload(payload);
    const eventPrices = mergePrices(eventPriceFallbacks(eventRaw), collectReservationPrices(reservations));
    const stateCounts = countReservationStates(reservations);
    const arrivedIds = new Set(savedArrived.map((row) => row.dwsId || row.id).filter(Boolean));
    const rows = reservations
      .filter((reservation) => String(reservation.state || "").toLowerCase() !== "removed")
      .filter((reservation) => !arrivedIds.has(String(reservation.id || reservation.reservationId || "")))
      .map((reservation) => normalizeReservation(reservation, event.title, eventRaw, eventPrices));

    state.currentEvent = {
      id: event.id,
      title: event.title,
      date: $("#dateFrom").value || dateToday(),
      raw: eventRaw
    };
    state.bookings = [...savedManualBookings, ...rows];
    state.arrived = savedArrived;
    saveAndPersist();
    setNotice(
      rows.length
        ? `Importate ${rows.length} prenotazioni per "${event.title}" escluse removed. Stati: ${formatStateCounts(stateCounts)}.`
        : `Nessuna prenotazione importabile per "${event.title}". Ricevute ${reservations.length} righe totali: ${formatStateCounts(stateCounts)}.`
    );
    render();
  } catch (error) {
    state.currentEvent = {
      id: event.id,
      title: event.title,
      date: $("#dateFrom").value || dateToday(),
      raw: event.raw || {}
    };
    saveAndPersist();
    render();
    setNotice(error.message, true);
  }
}

function countReservationStates(reservations) {
  return reservations.reduce((acc, reservation) => {
    const key = reservation.state || "senza stato";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

function formatStateCounts(counts) {
  const entries = Object.entries(counts);
  if (!entries.length) return "nessuna riga ricevuta da DWS";
  return entries.map(([stateName, count]) => `${stateName}: ${count}`).join(", ");
}

async function fetchReservationsByExperience(experienceId) {
  if (!state.config.bearerToken && !publicConfig.hasServerDwsLogin) {
    throw new Error("Inserisci il Bearer token DWS in Configurazione per importare le prenotazioni.");
  }

  const response = await fetch("/api/reservations-by-experience", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      dwsBase: state.config.dwsBase,
      bearerToken: state.config.bearerToken,
      wineryId: state.config.wineryId,
      experienceId
    })
  });

  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    const detail = payload.detail ? ` Dettaglio: ${JSON.stringify(payload.detail).slice(0, 500)}` : "";
    throw new Error(`${payload.message || `Errore prenotazioni: HTTP ${response.status}`}.${detail}`);
  }
  return payload;
}

function updateField(rowId, collection, key, value) {
  const row = state[collection].find((item) => item.id === rowId);
  if (!row) return;
  row[key] = numericKeys.has(key) ? numberValue(value) : value;
  saveAndPersist();
  render();
}

function moveToArrived(rowId) {
  const index = state.bookings.findIndex((row) => row.id === rowId);
  if (index < 0) return;
  const [row] = state.bookings.splice(index, 1);
  row.stato = "Arrivati";
  if (Array.isArray(row.labels) && row.labels.length) {
    row.labels = row.labels.map((label) => ({
      ...label,
      quantityArr: numberValue(label.quantityArr) || numberValue(label.quantityPren)
    }));
    row.adulti = row.labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0);
    row.bambini = row.labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0);
  }
  if (!numberValue(row.adulti)) row.adulti = row.adultiPrenotati;
  if (!numberValue(row.bambini)) row.bambini = row.bambiniPrenotati;
  if (!numberValue(row.altro)) row.altro = row.altroPrenotati;
  state.arrived.unshift(row);
  saveAndPersist();
  render();
}

function moveToBookings(rowId) {
  const index = state.arrived.findIndex((row) => row.id === rowId);
  if (index < 0) return;
  const [row] = state.arrived.splice(index, 1);
  row.stato = "Confermato";
  state.bookings.push(row);
  saveAndPersist();
  render();
}

function cardPaymentLabel(row) {
  const paypal = numberValue(row.paypal);
  if (paypal > 0) return { text: `PayPal ${euro(paypal)}`, paid: true };
  return { text: "PayPal no", paid: false };
}

function cardLabelRows(row, collection) {
  if (Array.isArray(row.labels) && row.labels.length) {
    return row.labels
      .map((label) => {
        const value = collection === "arrived" ? numberValue(label.quantityArr) : numberValue(label.quantityPren);
        return `<div><strong>${value}</strong><span>${escapeHtml(label.title)}</span></div>`;
      })
      .join("");
  }

  const suffix = collection === "arrived" ? "arr." : "pren.";
  const adulti = collection === "arrived" ? numberValue(row.adulti) : numberValue(row.adultiPrenotati);
  const bambini = collection === "arrived" ? numberValue(row.bambini) : numberValue(row.bambiniPrenotati);
  return `
    <div><strong>${adulti}</strong><span>Adulti ${suffix}</span></div>
    <div><strong>${bambini}</strong><span>Bambini ${suffix}</span></div>
  `;
}

function renderReservationCards(selector, rows, collection) {
  const wrap = $(selector);
  wrap.innerHTML = "";
  const filteredRows = rows
    .filter((row) => !reservationSearch || String(row.nominativo || "").toLowerCase().includes(reservationSearch))
    .sort((a, b) => String(a.nominativo || "").localeCompare(String(b.nominativo || ""), "it", { sensitivity: "base" }));

  if (!filteredRows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-card";
    empty.textContent = reservationSearch ? "Nessun risultato per questa ricerca" : collection === "bookings" ? "Nessuna prenotazione importata" : "Nessun arrivato";
    wrap.appendChild(empty);
    return;
  }

  filteredRows.forEach((row) => {
    const computed = computeRow(row);
    const payment = cardPaymentLabel(row);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `reservation-card ${collection === "arrived" ? "arrived" : ""}`;
    button.innerHTML = `
      <div class="card-top">
        <div>
          <div class="guest-name">${escapeHtml(row.nominativo || "Senza nome")}</div>
          ${row.note ? `<small>${escapeHtml(row.note).slice(0, 90)}</small>` : ""}
        </div>
        <span class="payment-badge ${payment.paid ? "paid" : ""}">${escapeHtml(payment.text)}</span>
      </div>
      <div class="guest-grid">
        ${cardLabelRows(row, collection)}
      </div>
      <div class="card-money">
        <div><span>Arrivati</span><strong>${computed.arrivati}</strong></div>
        <div><span>Da pagare</span><strong>${euro(computed.daPagare)}</strong></div>
        <div><span>Ancora</span><strong>${euro(computed.ancoraDaPagare)}</strong></div>
      </div>
    `;
    button.addEventListener("click", () => openReservationModal(row.id, collection));
    wrap.appendChild(button);
  });
}

function addManualReservation() {
  if (!state.currentEvent?.id) {
    setNotice("Seleziona prima un evento, poi puoi aggiungere prenotazioni manuali.", true);
    return;
  }

  const row = createRow({
    nominativo: "Nuova prenotazione",
    eventTitle: state.currentEvent.title,
    stato: collectionLabel("bookings"),
    labels: getCurrentEventLabels()
  });
  state.bookings.unshift(row);
  saveAndPersist();
  render();
  openReservationModal(row.id, "bookings");
}

function collectionLabel(collection) {
  return collection === "arrived" ? "Arrivati" : "Confermato";
}

function openReservationModal(rowId, collection) {
  const row = state[collection].find((item) => item.id === rowId);
  if (!row) return;

  modalContext = { rowId, collection };
  $("#modalTitle").textContent = row.nominativo || "Prenotazione";
  $("#m-nominativo").value = row.nominativo || "";
  $("#m-note").value = row.note || "";
  $("#m-adultiPrenotati").value = row.adultiPrenotati ?? "";
  $("#m-bambiniPrenotati").value = row.bambiniPrenotati ?? "";
  $("#m-adulti").value = row.adulti ?? "";
  $("#m-bambini").value = row.bambini ?? "";
  $("#m-priceAdulti").value = row.prices?.adulti ?? "";
  $("#m-priceBambini").value = row.prices?.bambini ?? "";
  $("#m-sconto").value = row.sconto ?? "";
  $("#m-extra").value = row.extra ?? "";
  $("#m-bottiglie").value = row.bottiglie ?? "";
  $("#m-paypal").value = row.paypal ?? "";
  $("#m-cash").value = row.cash ?? "";
  $("#m-pos").value = row.pos ?? "";
  $("#modalCheckin").style.display = collection === "bookings" ? "" : "none";
  $("#modalBack").style.display = collection === "arrived" ? "" : "none";
  renderModalLabels(row);
  updateModalTotals();
  $("#reservationModal").classList.add("open");
  $("#reservationModal").setAttribute("aria-hidden", "false");
}

function renderModalLabels(row) {
  const wrap = $("#m-labels");
  wrap.innerHTML = "";
  const hasLabels = Array.isArray(row.labels) && row.labels.length;
  document.querySelectorAll(".legacy-counts").forEach((element) => {
    element.style.display = hasLabels ? "none" : "";
  });
  if (!hasLabels) return;

  row.labels.forEach((label, index) => {
    const div = document.createElement("div");
    div.className = "label-row";
    div.innerHTML = `
      <div class="label-row-title">
        ${escapeHtml(label.title)}
        <span>${label.category === "bambini" ? "Bambini" : "Adulti"} - ${euro(label.price)}</span>
      </div>
      <label>Prenotati <input data-label-index="${index}" data-label-field="quantityPren" type="number" step="1" value="${numberValue(label.quantityPren)}" /></label>
      <label>Arrivati <input data-label-index="${index}" data-label-field="quantityArr" type="number" step="1" value="${numberValue(label.quantityArr)}" /></label>
      <label>Prezzo <input data-label-index="${index}" data-label-field="price" type="number" step="0.01" value="${numberValue(label.price)}" /></label>
    `;
    wrap.appendChild(div);
  });
}

function readModalLabels() {
  const row = state[modalContext.collection]?.find((item) => item.id === modalContext.rowId);
  if (!row?.labels?.length) return null;
  const labels = row.labels.map((label) => ({ ...label }));
  document.querySelectorAll("[data-label-index]").forEach((input) => {
    const index = Number(input.dataset.labelIndex);
    const field = input.dataset.labelField;
    labels[index][field] = numberValue(input.value);
  });
  return labels;
}

function closeReservationModal() {
  $("#reservationModal").classList.remove("open");
  $("#reservationModal").setAttribute("aria-hidden", "true");
  modalContext = { rowId: null, collection: null };
}

function readModalValues() {
  const labels = readModalLabels();
  if (labels) {
    return {
      nominativo: $("#m-nominativo").value,
      note: $("#m-note").value,
      labels,
      adultiPrenotati: labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0),
      bambiniPrenotati: labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityPren), 0),
      altroPrenotati: 0,
      adulti: labels.filter((label) => label.category !== "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0),
      bambini: labels.filter((label) => label.category === "bambini").reduce((sum, label) => sum + numberValue(label.quantityArr), 0),
      altro: 0,
      prices: {
        adulti: numberValue(labels.find((label) => label.category !== "bambini")?.price),
        bambini: numberValue(labels.find((label) => label.category === "bambini")?.price),
        altro: 0
      },
      sconto: numberValue($("#m-sconto").value),
      extra: numberValue($("#m-extra").value),
      bottiglie: numberValue($("#m-bottiglie").value),
      paypal: numberValue($("#m-paypal").value),
      cash: numberValue($("#m-cash").value),
      pos: numberValue($("#m-pos").value)
    };
  }

  return {
    nominativo: $("#m-nominativo").value,
    note: $("#m-note").value,
    adultiPrenotati: numberValue($("#m-adultiPrenotati").value),
    bambiniPrenotati: numberValue($("#m-bambiniPrenotati").value),
    altroPrenotati: 0,
    adulti: numberValue($("#m-adulti").value),
    bambini: numberValue($("#m-bambini").value),
    altro: 0,
    prices: {
      adulti: numberValue($("#m-priceAdulti").value),
      bambini: numberValue($("#m-priceBambini").value),
      altro: 0
    },
    sconto: numberValue($("#m-sconto").value),
    extra: numberValue($("#m-extra").value),
    bottiglie: numberValue($("#m-bottiglie").value),
    paypal: numberValue($("#m-paypal").value),
    cash: numberValue($("#m-cash").value),
    pos: numberValue($("#m-pos").value)
  };
}

function updateModalTotals() {
  const base = readModalValues();
  const computed = computeRow(base);
  $("#m-prenotatiTot").textContent = computed.prenotati;
  $("#m-arrivatiTot").textContent = computed.arrivati;
  $("#m-daPagare").textContent = euro(computed.daPagare);
  $("#m-pagato").textContent = euro(computed.pagato);
  $("#m-ancora").textContent = euro(computed.ancoraDaPagare);
}

function saveModalValues() {
  const row = state[modalContext.collection]?.find((item) => item.id === modalContext.rowId);
  if (!row) return;
  Object.assign(row, readModalValues());
  saveAndPersist();
  render();
}

function deleteCurrentReservation() {
  const row = state[modalContext.collection]?.find((item) => item.id === modalContext.rowId);
  if (!row) return;

  const nominativo = row.nominativo || "questa prenotazione";
  if (!confirm(`Sei sicuro di voler eliminare la prenotazione di ${nominativo}?`)) return;

  state[modalContext.collection] = state[modalContext.collection].filter((item) => item.id !== modalContext.rowId);
  saveAndPersist();
  closeReservationModal();
  render();
}

function renderEvents() {
  const wrap = $("#eventsList");
  wrap.innerHTML = "";

  eventsByDate.forEach((event) => {
    const description = eventDescription(event);
    const labels = eventPriceLabels(event);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "event-card";
    button.innerHTML = `
      <strong>${escapeHtml(event.title)}</strong>
      <div class="event-meta">
        ${event.price ? `<span class="pill">${escapeHtml(event.price)}</span>` : ""}
        ${event.duration ? `<span class="pill cyan">${escapeHtml(event.duration)}</span>` : ""}
        ${event.source === "crm-inactive" ? `<span class="pill">disattivato/CRM</span>` : ""}
      </div>
      ${description ? `<p class="event-description">${escapeHtml(description).slice(0, 220)}</p>` : ""}
      ${
        labels.length
          ? `<div class="event-price-list">${labels
              .map(
                (label) => `
                  <div>
                    <span>${escapeHtml(label.title)}</span>
                    <strong>${euro(label.price)}</strong>
                  </div>
                `
              )
              .join("")}</div>`
          : ""
      }
      <small>Apri dettaglio prenotazioni</small>
    `;
    button.addEventListener("click", () => importEvent(event.id));
    wrap.appendChild(button);
  });
}

function renderTable(selector, rows, collection) {
  const table = $(selector);
  table.innerHTML = "";

  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  columns.forEach(([, label]) => {
    const th = document.createElement("th");
    th.textContent = label;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = columns.length;
    td.textContent = "Nessuna riga presente";
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const computed = computeRow(row);

    columns.forEach(([key, , type]) => {
      const td = document.createElement("td");
      if (type === "action") {
        const button = document.createElement("button");
        button.type = "button";
        button.className = collection === "bookings" ? "ok-btn" : "back-btn";
        button.textContent = collection === "bookings" ? "OK" : "Indietro";
        button.addEventListener("click", () => (collection === "bookings" ? moveToArrived(row.id) : moveToBookings(row.id)));
        td.appendChild(button);
      } else if (type === "computed") {
        td.textContent = computed[key];
        td.className = "number";
      } else if (type === "money") {
        td.textContent = euro(computed[key]);
        td.className = "money";
      } else if (type === "state") {
        const chip = document.createElement("span");
        chip.className = "state-chip";
        chip.textContent = row[key] || "";
        td.appendChild(chip);
      } else if (type === "textarea") {
        const textarea = document.createElement("textarea");
        textarea.value = row[key] || "";
        textarea.addEventListener("change", (event) => updateField(row.id, collection, key, event.target.value));
        td.appendChild(textarea);
      } else {
        const input = document.createElement("input");
        input.type = type === "number" || type === "moneyInput" ? "number" : "text";
        input.step = type === "number" || type === "moneyInput" ? "0.01" : "";
        input.value = row[key] ?? "";
        input.addEventListener("change", (event) => updateField(row.id, collection, key, event.target.value));
        td.appendChild(input);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
}

function renderTotals() {
  const totals = [...state.bookings, ...state.arrived].reduce(
    (acc, row) => {
      const computed = computeRow(row);
      acc.righe += 1;
      acc.prenotati += computed.prenotati;
      acc.arrivati += computed.arrivati;
      acc.daPagare += computed.daPagare;
      acc.sconto += numberValue(row.sconto);
      acc.extra += numberValue(row.extra);
      acc.bottiglie += numberValue(row.bottiglie);
      acc.paypal += numberValue(row.paypal);
      acc.cash += numberValue(row.cash);
      acc.pos += numberValue(row.pos);
      acc.pagato += computed.pagato;
      acc.ancora += computed.ancoraDaPagare;
      return acc;
    },
    { righe: 0, prenotati: 0, arrivati: 0, daPagare: 0, sconto: 0, extra: 0, bottiglie: 0, paypal: 0, cash: 0, pos: 0, pagato: 0, ancora: 0 }
  );

  $("#totalsTable").innerHTML = `
    <thead><tr>
      <th>Righe</th><th>Prenotati</th><th>Arrivati</th><th>Da Pagare</th><th>Sconto</th><th>Extra</th>
      <th>Bottiglie</th><th>PAYPAL</th><th>Cash</th><th>POS</th><th>PAGATO</th><th>Ancora Da Pagare</th>
    </tr></thead>
    <tbody><tr>
      <td>${totals.righe}</td><td>${totals.prenotati}</td><td>${totals.arrivati}</td>
      <td class="money">${euro(totals.daPagare)}</td><td class="money">${euro(totals.sconto)}</td>
      <td class="money">${euro(totals.extra)}</td><td class="money">${euro(totals.bottiglie)}</td>
      <td class="money">${euro(totals.paypal)}</td><td class="money">${euro(totals.cash)}</td>
      <td class="money">${euro(totals.pos)}</td><td class="money">${euro(totals.pagato)}</td>
      <td class="money">${euro(totals.ancora)}</td>
    </tr></tbody>
  `;

  $("#statBookings").textContent = state.bookings.length;
  $("#statArrived").textContent = state.arrived.length;
  $("#statPeople").textContent = totals.prenotati;
  $("#statDue").textContent = euro(totals.daPagare);
}

function allReportRows() {
  return [
    ...state.bookings.map((row) => ({ ...row, sezione: "Prenotazioni" })),
    ...state.arrived.map((row) => ({ ...row, sezione: "Arrivati" }))
  ];
}

function reportSummary() {
  return allReportRows().reduce(
    (acc, row) => {
      const computed = computeRow(row);
      acc.righe += 1;
      acc.adultiPrenotati += numberValue(row.adultiPrenotati);
      acc.bambiniPrenotati += numberValue(row.bambiniPrenotati);
      acc.adulti += numberValue(row.adulti);
      acc.bambini += numberValue(row.bambini);
      acc.daPagare += computed.daPagare;
      acc.paypal += numberValue(row.paypal);
      acc.cash += numberValue(row.cash);
      acc.pos += numberValue(row.pos);
      acc.pagato += computed.pagato;
      acc.ancora += computed.ancoraDaPagare;
      return acc;
    },
    { righe: 0, adultiPrenotati: 0, bambiniPrenotati: 0, adulti: 0, bambini: 0, daPagare: 0, paypal: 0, cash: 0, pos: 0, pagato: 0, ancora: 0 }
  );
}

function buildReportText() {
  const eventName = state.currentEvent?.title || "Evento non selezionato";
  const eventDate = state.currentEvent?.date || $("#dateFrom").value || dateToday();
  const summary = reportSummary();
  const lines = [
    `Riepilogo evento: ${eventName}`,
    `Data: ${eventDate}`,
    "",
    `Righe: ${summary.righe}`,
    `Adulti prenotati: ${summary.adultiPrenotati}`,
    `Bambini prenotati: ${summary.bambiniPrenotati}`,
    `Adulti arrivati: ${summary.adulti}`,
    `Bambini arrivati: ${summary.bambini}`,
    `Da pagare: ${euro(summary.daPagare)}`,
    `PayPal: ${euro(summary.paypal)}`,
    `Cash: ${euro(summary.cash)}`,
    `POS: ${euro(summary.pos)}`,
    `Pagato: ${euro(summary.pagato)}`,
    `Ancora da pagare: ${euro(summary.ancora)}`,
    "",
    "Dettaglio prenotazioni:"
  ];

  allReportRows().forEach((row) => {
    const computed = computeRow(row);
    lines.push(
      [
        row.sezione,
        row.nominativo || "Senza nome",
        `stato ${row.stato || ""}`,
        `prenotati A:${numberValue(row.adultiPrenotati)} B:${numberValue(row.bambiniPrenotati)}`,
        `arrivati A:${numberValue(row.adulti)} B:${numberValue(row.bambini)}`,
        `da pagare ${euro(computed.daPagare)}`,
        `pagato ${euro(computed.pagato)}`,
        `ancora ${euro(computed.ancoraDaPagare)}`,
        row.note ? `note: ${row.note}` : ""
      ]
        .filter(Boolean)
        .join(" | ")
    );
  });

  return lines.join("\n");
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function buildReportCsv() {
  const headers = [
    "Sezione",
    "Nominativo",
    "Note",
    "Adulti Prenotati",
    "Bambini Prenotati",
    "Adulti",
    "Bambini",
    "Prezzo Adulto",
    "Prezzo Bambino",
    "Da Pagare",
    "Sconto",
    "Extra",
    "Bottiglie",
    "PAYPAL",
    "Cash",
    "POS",
    "PAGATO",
    "Ancora Da Pagare",
    "Stato"
  ];

  const rows = allReportRows().map((row) => {
    const computed = computeRow(row);
    return [
      row.sezione,
      row.nominativo,
      row.note,
      numberValue(row.adultiPrenotati),
      numberValue(row.bambiniPrenotati),
      numberValue(row.adulti),
      numberValue(row.bambini),
      plainEuro(row.prices?.adulti),
      plainEuro(row.prices?.bambini),
      plainEuro(computed.daPagare),
      plainEuro(row.sconto),
      plainEuro(row.extra),
      plainEuro(row.bottiglie),
      plainEuro(row.paypal),
      plainEuro(row.cash),
      plainEuro(row.pos),
      plainEuro(computed.pagato),
      plainEuro(computed.ancoraDaPagare),
      row.stato
    ];
  });

  return [headers, ...rows].map((row) => row.map(csvEscape).join(";")).join("\r\n");
}

function reportFileName() {
  const eventName = (state.currentEvent?.title || "evento").toLowerCase().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "");
  const eventDate = state.currentEvent?.date || dateToday();
  return `report-${eventDate}-${eventName || "evento"}.csv`;
}

function downloadReportCsv() {
  if (!state.currentEvent?.id) {
    setNotice("Seleziona un evento prima di scaricare il report.", true);
    return;
  }

  const blob = new Blob([`\uFEFF${buildReportCsv()}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = reportFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

async function sendReportEmail() {
  const eventName = state.currentEvent?.title || "Evento non selezionato";
  const eventDate = state.currentEvent?.date || $("#dateFrom").value || dateToday();
  const response = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        subject: `Riepilogo evento: ${eventName}`,
        event_name: eventName,
        date: eventDate,
        report: buildReportText(),
        to_email: REPORT_EMAIL
      }
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Invio email non riuscito: HTTP ${response.status} ${message}`);
  }
}

async function closeAndSendReport() {
  if (!state.currentEvent?.id) {
    setNotice("Seleziona un evento prima di chiuderlo.", true);
    return;
  }

  const eventName = state.currentEvent.title;
  const confirmed = confirm(`Sei sicuro di voler chiudere l'evento e di inviare report a ${REPORT_EMAIL}?`);
  if (!confirmed) return;

  try {
    setNotice("Creazione report e invio email in corso...");
    downloadReportCsv();
    await sendReportEmail();
    delete state.eventData[state.currentEvent.id];
    state.bookings = [];
    state.arrived = [];
    state.currentEvent = null;
    saveState();
    render();
    setNotice(`Evento "${eventName}" chiuso. Report inviato a ${REPORT_EMAIL}.`);
  } catch (error) {
    setNotice(error.message, true);
  }
}

function render() {
  $("#bookingCount").textContent = `${state.bookings.length} righe`;
  $("#arrivedCount").textContent = `${state.arrived.length} righe`;
  $("#currentEventTitle").textContent = state.currentEvent?.title || "Seleziona un evento";
  $("#authStatus").textContent = state.config.bearerToken ? "Bearer token presente" : "Non collegato";
  renderEvents();
  renderReservationCards("#bookingsCards", state.bookings, "bookings");
  renderReservationCards("#arrivedCards", state.arrived, "arrived");
  renderTable("#bookingsTable", state.bookings, "bookings");
  renderTable("#arrivedTable", state.arrived, "arrived");
  renderTotals();
}

function fillSettings() {
  Object.entries(state.config).forEach(([key, value]) => {
    const input = $(`#${key}`);
    if (input) input.value = key === "dwsPassword" ? "" : value;
  });
}

function readSettings() {
  state.config = {
    dwsEmail: $("#dwsEmail").value.trim(),
    dwsPassword: $("#dwsPassword").value,
    bearerToken: $("#bearerToken").value.trim(),
    apiKey: $("#apiKey").value.trim(),
    wineryId: $("#wineryId").value.trim(),
    dwsBase: $("#dwsBase").value.trim()
  };
  saveState();
  render();
}

function setNotice(message, isError = false) {
  $("#notice").textContent = message;
  $("#notice").classList.toggle("error", isError);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = String(value ?? "");
  return div.innerHTML;
}

function bindEvents() {
  $("#settingsToggle").addEventListener("click", () => $("#settingsPanel").classList.toggle("hidden"));

  $("#settingsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    readSettings();
    setNotice("Configurazione salvata.");
  });

  $("#loginBtn").addEventListener("click", async () => {
    readSettings();
    setNotice("Login DWS in corso...");
    try {
      await loginDws();
      setNotice("Login DWS completato. Per la ricerca CRM verra usata la API Key.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  $("#eventSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    readSettings();
    setNotice("Ricerca eventi in corso...");
    try {
      const payload = await fetchExperiences($("#dateFrom").value, $("#dateTo").value);
      eventsByDate = await enrichEventsWithDetails(normalizeExperienceEvents(arrayFromPayload(payload)));
      renderEvents();
      setNotice(eventsByDate.length ? `Trovate ${eventsByDate.length} esperienze. Clicca un titolo per selezionare l'evento.` : "Nessuna esperienza trovata per questa data.");
    } catch (error) {
      setNotice(error.message, true);
    }
  });

  $("#clearData").addEventListener("click", () => {
    if (!confirm("Vuoi svuotare prenotazioni e arrivati?")) return;
    state.bookings = [];
    state.arrived = [];
    state.currentEvent = null;
    saveState();
    render();
  });
  $("#addBooking").addEventListener("click", addManualReservation);
  $("#reservationSearch").addEventListener("input", (event) => {
    reservationSearch = event.target.value.trim().toLowerCase();
    renderReservationCards("#bookingsCards", state.bookings, "bookings");
    renderReservationCards("#arrivedCards", state.arrived, "arrived");
  });
  $("#downloadReport").addEventListener("click", downloadReportCsv);
  $("#closeAndSendReport").addEventListener("click", closeAndSendReport);

  $("#modalClose").addEventListener("click", closeReservationModal);
  $("#reservationModal").addEventListener("click", (event) => {
    if (event.target === $("#reservationModal")) closeReservationModal();
  });
  $("#reservationForm").addEventListener("input", updateModalTotals);
  $("#reservationForm").addEventListener("submit", (event) => {
    event.preventDefault();
    saveModalValues();
    closeReservationModal();
  });
  $("#modalCheckin").addEventListener("click", () => {
    saveModalValues();
    const rowId = modalContext.rowId;
    closeReservationModal();
    moveToArrived(rowId);
  });
  $("#modalBack").addEventListener("click", () => {
    saveModalValues();
    const rowId = modalContext.rowId;
    closeReservationModal();
    moveToBookings(rowId);
  });
  $("#modalDelete").addEventListener("click", deleteCurrentReservation);
}

$("#dateFrom").value = dateToday();
$("#dateTo").value = dateToday();
loadPublicConfig().finally(() => {
  fillSettings();
  bindEvents();
  render();
});
