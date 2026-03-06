/* ─────────────────────────────────────────
   PAX CRM Board — app.js
   Features:
   - Kanban with HTML5 drag-and-drop → updates status
   - Stats bar (pipeline, won, per-column counts)
   - Structured items [{name,qty,unit_price}] with live price recalc
   - Fetch button on card + re-fetch after first fetch
   - Editable items in drawer (qty, price, name, add/delete row)
   - Images grid in drawer
   - Notes indicator dot on card
   - Status badge with column colour
───────────────────────────────────────── */

const CARDS_KEY    = "pax_crm_cards_v2";
const SETTINGS_KEY = "pax_crm_settings_v2";

const DEFAULT_SETTINGS = {
  theme: "light",
  autoOpenDrawer: true,
  currency: "GBP",
  columns: [
    { id:"new",       name:"New",       color:"#2563eb", icon:"🆕" },
    { id:"quoted",    name:"Quoted",    color:"#f59e0b", icon:"🧾" },
    { id:"scheduled", name:"Scheduled", color:"#8b5cf6", icon:"📅" },
    { id:"won",       name:"Won",       color:"#10b981", icon:"✅" },
  ],
  fields: {
    phone:         true,
    postcode:      true,
    pax_code:      true,
    schedule_date: true,
    budget:        true,
    address:       false,
    notes:         true,
  },
};

const FIELD_DEFS = [
  { key:"phone",         label:"Phone",    type:"text",     placeholder:"07...",       desc:"Customer phone" },
  { key:"postcode",      label:"Postcode", type:"text",     placeholder:"WD23 3EA",    desc:"Customer postcode" },
  { key:"pax_code",      label:"PAX Code", type:"text",     placeholder:"VSQWPG",      desc:"IKEA PAX design code" },
  { key:"schedule_date", label:"Date",     type:"date",     placeholder:"",            desc:"Install / visit date" },
  { key:"budget",        label:"Budget",   type:"number",   placeholder:"1200",        desc:"Estimated budget (£)" },
  { key:"address",       label:"Address",  type:"text",     placeholder:"Street/City", desc:"Optional address" },
  { key:"notes",         label:"Notes",    type:"textarea", placeholder:"Notes...",    desc:"Internal notes" },
];

/* ─── State ─── */
let settings   = loadSettings();
let cards      = loadCards();
let selectedId = null;
let searchQuery = "";
let dragId     = null;   // card id being dragged

applyTheme(settings.theme);
ensureCardsCompatible();

/* ─── DOM refs ─── */
const elBoard        = document.getElementById("board");
const elDrawer       = document.getElementById("drawer");
const elDrawerBody   = document.getElementById("drawerBody");
const elDrawerSub    = document.getElementById("drawerSub");
const tplCard        = document.getElementById("cardTpl");
const elSearch       = document.getElementById("search");
const elSettingsModal= document.getElementById("settingsModal");
const elColumnsList  = document.getElementById("columnsList");
const elFieldToggles = document.getElementById("fieldToggles");
const elStatsBar     = document.getElementById("statsBar");

wireTopbar();
renderAll();

/* ═══════════════════════════════════════
   STORAGE
═══════════════════════════════════════ */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    return mergeDeep(structuredClone(DEFAULT_SETTINGS), JSON.parse(raw) || {});
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
function saveSettings(next) {
  settings = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function loadCards() {
  try {
    const raw = localStorage.getItem(CARDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}
function saveCards(next) {
  cards = next;
  localStorage.setItem(CARDS_KEY, JSON.stringify(cards));
}
function mergeDeep(target, src) {
  for (const k of Object.keys(src || {})) {
    if (src[k] && typeof src[k] === "object" && !Array.isArray(src[k])) {
      target[k] = mergeDeep(target[k] || {}, src[k]);
    } else {
      target[k] = src[k];
    }
  }
  return target;
}
function structuredClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
function uid() {
  return "c_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return currencySymbol(settings.currency) + v.toFixed(2);
}
function currencySymbol(code) {
  const c = String(code || "GBP").toUpperCase();
  return c === "EUR" ? "€" : c === "USD" ? "$" : "£";
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}
function timeSince(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function byId(id) { return cards.find(c => c.id === id); }

function ensureCardsCompatible() {
  const firstCol = settings.columns?.[0]?.id || "new";
  const valid    = new Set((settings.columns || []).map(c => c.id));
  let changed    = false;
  cards = cards.map(c => {
    const next = { ...c };
    if (!next.id)             { next.id = uid(); changed = true; }
    if (!valid.has(next.status)) { next.status = firstCol; changed = true; }
    if (!("notes"         in next)) next.notes         = "";
    if (!("budget"        in next)) next.budget         = "";
    if (!("address"       in next)) next.address        = "";
    if (!("schedule_date" in next)) next.schedule_date  = "";
    if (!Array.isArray(next.items)) next.items = [];
    return next;
  });
  if (changed) saveCards(cards);
}

/* ─── Theme ─── */
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}

/* ═══════════════════════════════════════
   ITEMS — structured data helpers
   items: [{name, qty, unit_price}]
═══════════════════════════════════════ */

/**
 * Parse a legacy items_text string into structured items.
 * Handles lines like:  "PAX frame 236cm × 2    £310.00"
 * or:                  "KOMPLEMENT shelf × 4    48.00"
 */
function parseItemsText(text) {
  const lines = (text || "").split("\n");
  const result = [];
  for (const line of lines) {
    // Skip separator / total lines
    if (line.includes("──") || /^\s*TOTAL/i.test(line)) continue;
    // Match: NAME × QTY   £PRICE  (price = line total)
    const m = line.match(/^(.+?)\s*[×x]\s*(\d+)\s+£?([\d,.]+)/i);
    if (!m) continue;
    const name       = m[1].trim();
    const qty        = parseInt(m[2], 10);
    const lineTotal  = parseFloat(m[3].replace(",", ""));
    if (!name || !qty || !lineTotal) continue;
    result.push({ name, qty, unit_price: Math.round((lineTotal / qty) * 100) / 100 });
  }
  return result;
}

/**
 * Normalise whatever the server returns into [{name,qty,unit_price}].
 */
function normaliseItems(serverItems, itemsText) {
  if (Array.isArray(serverItems) && serverItems.length > 0 &&
      "unit_price" in serverItems[0]) {
    return serverItems;
  }
  if (Array.isArray(serverItems) && serverItems.length > 0 &&
      "price" in serverItems[0]) {
    // server might use {name, qty, price}
    return serverItems.map(i => ({
      name:       i.name || "",
      qty:        Number(i.qty)   || 1,
      unit_price: Number(i.price) || 0,
    }));
  }
  // Fallback: parse items_text
  return parseItemsText(itemsText);
}

/** Recalculate ikea_total and item_count from items array. */
function recalcFromItems(id) {
  const card = byId(id);
  if (!card || !Array.isArray(card.items)) return;
  const total = card.items.reduce((s, it) => s + (it.qty || 0) * (it.unit_price || 0), 0);
  const count = card.items.reduce((s, it) => s + (it.qty || 0), 0);
  patchCard(id, {
    ikea_total:  Math.round(total * 100) / 100,
    item_count:  count,
  });
}

/* ═══════════════════════════════════════
   STATS BAR
═══════════════════════════════════════ */
function renderStats() {
  if (!elStatsBar) return;
  const cols = settings.columns || [];

  const pipeline = cards
    .filter(c => c.status !== cols[cols.length - 1]?.id)
    .reduce((s, c) => s + (parseFloat(c.budget) || 0), 0);
  const wonVal = cards
    .filter(c => c.status === cols[cols.length - 1]?.id)
    .reduce((s, c) => s + (parseFloat(c.budget) || 0), 0);

  const sym = currencySymbol(settings.currency);
  const parts = [];

  parts.push(`<div class="statItem"><span class="statN">${cards.length}</span><span class="statL">Total</span></div>`);
  parts.push(`<div class="statDivider"></div>`);

  for (const col of cols) {
    const n = cards.filter(c => c.status === col.id).length;
    parts.push(`<div class="statItem">
      <span class="statN" style="color:${escapeAttr(col.color)}">${n}</span>
      <span class="statL">${escapeHtml(col.icon ? col.icon + " " + col.name : col.name)}</span>
    </div>`);
  }

  parts.push(`<div class="statDivider"></div>`);
  parts.push(`<div class="statItem pipeline"><span class="statN">${sym}${pipeline.toLocaleString("en-GB",{minimumFractionDigits:0,maximumFractionDigits:0})}</span><span class="statL">Pipeline</span></div>`);
  parts.push(`<div class="statItem wonStat"><span class="statN">${sym}${wonVal.toLocaleString("en-GB",{minimumFractionDigits:0,maximumFractionDigits:0})}</span><span class="statL">Won</span></div>`);

  elStatsBar.innerHTML = parts.join("");
}

/* ═══════════════════════════════════════
   RENDERING
═══════════════════════════════════════ */
function filteredCards() {
  const q = (searchQuery || "").trim().toLowerCase();
  if (!q) return cards;
  return cards.filter(c => {
    const hay = [c.customer_name, c.phone, c.postcode, c.pax_code,
                 c.notes, c.address, c.schedule_date, c.budget]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

function renderAll() {
  renderBoard();
  renderDrawer();
  renderStats();
}

function renderBoard() {
  elBoard.innerHTML = "";
  const cols = settings.columns || [];
  const list = filteredCards();

  for (const col of cols) {
    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.style.setProperty("--accent", col.color || "#2563eb");

    const inCol = list.filter(c => c.status === col.id);

    colEl.innerHTML = `
      <div class="colHead">
        <div class="colTitle">
          <span class="dot"></span>
          <span>${escapeHtml(col.icon ? `${col.icon} ${col.name}` : col.name)}</span>
        </div>
        <div class="colCount">${inCol.length}</div>
      </div>
      <div class="colBody" data-col="${escapeAttr(col.id)}"></div>
    `;

    const body = colEl.querySelector(".colBody");

    /* ── Drop target ── */
    body.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      body.classList.add("dragOver");
    });
    body.addEventListener("dragleave", e => {
      if (!body.contains(e.relatedTarget)) body.classList.remove("dragOver");
    });
    body.addEventListener("drop", e => {
      e.preventDefault();
      body.classList.remove("dragOver");
      if (!dragId) return;
      const current = byId(dragId);
      if (!current || current.status === col.id) return;
      patchCard(dragId, { status: col.id });
      renderBoard();
      renderStats();
      if (selectedId === dragId) renderDrawer();
    });

    if (inCol.length === 0) {
      body.innerHTML = `<div class="empty">Drop a lead here</div>`;
    }

    for (const card of inCol) {
      const node = tplCard.content.firstElementChild.cloneNode(true);

      /* Accent dot */
      node.querySelector(".accentDot").style.background = col.color || "#2563eb";

      /* Selected state */
      if (card.id === selectedId) node.classList.add("selected");

      /* Drag */
      node.addEventListener("dragstart", e => {
        dragId = card.id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        setTimeout(() => node.classList.add("dragging"), 0);
      });
      node.addEventListener("dragend", () => {
        dragId = null;
        node.classList.remove("dragging");
        document.querySelectorAll(".colBody").forEach(b => b.classList.remove("dragOver"));
      });

      /* Customer name */
      const elCustomer = node.querySelector(".customer");
      elCustomer.value = card.customer_name || "";
      elCustomer.addEventListener("input", () => {
        patchCard(card.id, { customer_name: elCustomer.value });
      });

      /* Status badge */
      const badge = node.querySelector(".cardBadge");
      badge.textContent = col.icon ? `${col.icon} ${col.name}` : col.name;
      badge.style.background = hexAlpha(col.color, 0.12);
      badge.style.color = col.color || "var(--brand)";

      /* Notes dot */
      if (card.notes && card.notes.trim()) {
        const dot = document.createElement("div");
        dot.className = "notesDot";
        dot.title = "Has notes";
        node.appendChild(dot);
      }

      /* Dynamic field rows */
      const elFields = node.querySelector(".fields");
      elFields.innerHTML = "";
      for (const def of FIELD_DEFS) {
        if (!settings.fields?.[def.key]) continue;
        if (def.key === "notes") continue; // notes in drawer only
        const row = document.createElement("div");
        row.className = "fieldRow";
        row.innerHTML = `
          <label>${escapeHtml(def.label)}</label>
          ${def.type === "textarea"
            ? `<textarea data-k="${def.key}" placeholder="${escapeHtml(def.placeholder||"")}" rows="2"></textarea>`
            : `<input data-k="${def.key}" type="${def.type}" placeholder="${escapeHtml(def.placeholder||"")}" />`
          }
        `;
        const input = row.querySelector("[data-k]");
        input.value = (card[def.key] ?? "");
        input.addEventListener("input", () => patchCard(card.id, { [def.key]: input.value }));
        elFields.appendChild(row);
      }

      /* Meta section — only visible when fetch data exists */
      const metaEl = node.querySelector(".meta");
      const hasFetch = card.ikea_total != null;
      if (hasFetch) {
        metaEl.classList.remove("hidden");
        node.querySelector(".total").textContent   = money(card.ikea_total);
        node.querySelector(".count").textContent   = String(card.item_count ?? "");
        node.querySelector(".fetched").textContent = timeSince(card.last_fetched);
      } else {
        metaEl.classList.add("hidden");
      }

      /* Fetch button label */
      const btnFetch = node.querySelector(".fetch");
      if (hasFetch) {
        btnFetch.textContent = "↻ Re-fetch";
        btnFetch.classList.remove("primary");
        btnFetch.classList.add("secondary");
      } else {
        btnFetch.textContent = "⚡ Fetch";
      }

      /* Open button */
      const btnOpen = node.querySelector(".open");
      const elErr   = node.querySelector(".error");

      btnOpen.addEventListener("click", () => openDrawer(card.id));
      node.addEventListener("dblclick", () => openDrawer(card.id));
      node.addEventListener("keydown", e => { if (e.key === "Enter") openDrawer(card.id); });

      /* Fetch handler */
      btnFetch.addEventListener("click", async (e) => {
        e.stopPropagation();
        elErr.classList.add("hidden");
        elErr.textContent = "";
        const current = byId(card.id);
        const pax = String(current?.pax_code || "").trim().toUpperCase();
        if (!pax) {
          elErr.textContent = "Enter a PAX code first.";
          elErr.classList.remove("hidden");
          return;
        }
        btnFetch.disabled = true;
        btnFetch.textContent = "Fetching…";
        try {
          const data = await fetchPax(pax);
          const normItems = normaliseItems(data.items, data.items_text);
          patchCard(card.id, {
            pax_code:    pax,
            ikea_total:  data.total,
            item_count:  data.item_count,
            items_text:  data.items_text || "",
            images:      data.images || [],
            items:       normItems,
            last_fetched: Date.now(),
          });
          renderBoard();
          renderStats();
          if (settings.autoOpenDrawer) openDrawer(card.id);
        } catch (err) {
          elErr.textContent = String(err?.message || err);
          elErr.classList.remove("hidden");
        } finally {
          btnFetch.disabled = false;
          btnFetch.textContent = hasFetch ? "↻ Re-fetch" : "⚡ Fetch";
        }
      });

      body.appendChild(node);
    }

    elBoard.appendChild(colEl);
  }
}

/* ═══════════════════════════════════════
   DRAWER
═══════════════════════════════════════ */
function renderDrawer() {
  if (!selectedId) {
    elDrawerBody.innerHTML = `
      <div style="text-align:center;padding:40px 20px;color:var(--muted)">
        <div style="font-size:36px;margin-bottom:12px">👈</div>
        <div style="font-weight:700;margin-bottom:4px">No lead selected</div>
        <div style="font-size:13px">Click any card to open details</div>
      </div>`;
    return;
  }

  const card = byId(selectedId);
  if (!card) return;

  elDrawerSub.textContent = card.customer_name || "(Unnamed lead)";

  const cols         = settings.columns || [];
  const statusOptions = cols.map(c =>
    `<option value="${c.id}">${escapeHtml((c.icon ? c.icon + " " : "") + c.name)}</option>`
  ).join("");

  const fieldsHtml = FIELD_DEFS.map(def => {
    if (!settings.fields?.[def.key]) return "";
    const val = card[def.key] ?? "";
    if (def.key === "notes") {
      return `
        <div class="drawerSection">
          <div class="drawerSectionTitle">${escapeHtml(def.label)}</div>
          <textarea id="f_notes" rows="4" placeholder="${escapeHtml(def.placeholder||"")}">${escapeHtml(val)}</textarea>
        </div>`;
    }
    return `
      <div class="dField">
        <div class="dLabel">${escapeHtml(def.label)}</div>
        <input id="f_${def.key}" type="${def.type}" value="${escapeAttr(val)}" placeholder="${escapeAttr(def.placeholder||"")}" />
      </div>`;
  }).join("");

  const hasFetch  = card.ikea_total != null;
  const images    = (card.images || []).slice(0, 16);

  elDrawerBody.innerHTML = `
    <!-- BASICS -->
    <div class="drawerSection">
      <div class="drawerSectionTitle">Basics</div>
      <div class="dField">
        <div class="dLabel">Customer name</div>
        <input id="f_customer_name" value="${escapeAttr(card.customer_name || "")}" placeholder="Customer name" />
      </div>
      <div class="dField">
        <div class="dLabel">Status</div>
        <select id="f_status">${statusOptions}</select>
      </div>
    </div>

    <!-- DYNAMIC FIELDS -->
    <div class="drawerSection" id="drawerFieldsSection">
      <div class="drawerSectionTitle">Details</div>
      ${fieldsHtml}
    </div>

    <!-- IKEA FETCH -->
    <div class="drawerSection">
      <div class="drawerSectionTitle">IKEA PAX Items</div>

      <div class="dField">
        <div class="dLabel">PAX Design Code</div>
        <div style="display:flex;gap:8px">
          <input id="f_pax_code"
            value="${escapeAttr(card.pax_code || "")}"
            placeholder="VSQWPG"
            style="font-family:ui-monospace,'Cascadia Code',monospace;letter-spacing:2px;font-weight:700"
          />
          <button class="btn mini primary" id="btnDrawerFetch" style="white-space:nowrap">
            ${hasFetch ? "↻ Re-fetch" : "⚡ Fetch"}
          </button>
        </div>
      </div>

      ${hasFetch ? buildFetchSummaryHtml(card) : `
        <div class="noFetchPlaceholder">
          No items yet — enter a PAX code and click ⚡ Fetch
        </div>`}

      <!-- Items editor (shown when data exists) -->
      ${hasFetch ? `<div id="itemsEditorWrap">${buildItemsEditorHtml(card.id)}</div>` : ""}

      <!-- Fetch clear -->
      ${hasFetch ? `
        <div style="margin-top:8px">
          <button class="btn mini danger" id="btnDrawerClear">Clear fetch data</button>
        </div>` : ""}

      <!-- Images -->
      ${images.length > 0 ? `
        <div style="margin-top:14px">
          <div class="drawerSectionTitle">Product images</div>
          <div class="imagesGrid">
            ${images.map(im => `
              <div class="imgWrap">
                <img
                  src="${escapeAttr(im.url)}"
                  alt="${escapeAttr(im.filename || "image")}"
                  title="${escapeAttr(im.filename || im.url)}"
                  loading="lazy"
                  onclick="window.open('${escapeAttr(im.url)}','_blank')"
                />
                <div class="imgName">${escapeHtml(im.filename || "")}</div>
              </div>
            `).join("")}
          </div>
        </div>` : ""}

      <div class="error hidden" id="drawerErr"></div>
    </div>
  `;

  /* Wire status dropdown */
  const fStatus = document.getElementById("f_status");
  fStatus.value = card.status;
  fStatus.addEventListener("change", () => {
    patchCard(card.id, { status: fStatus.value });
    renderBoard();
    renderStats();
  });

  /* Wire customer name */
  const fCust = document.getElementById("f_customer_name");
  fCust.addEventListener("input", () => {
    patchCard(card.id, { customer_name: fCust.value });
    elDrawerSub.textContent = fCust.value || "(Unnamed lead)";
  });

  /* Wire dynamic fields */
  for (const def of FIELD_DEFS) {
    if (!settings.fields?.[def.key]) continue;
    const el = document.getElementById("f_" + def.key);
    if (!el) continue;
    el.addEventListener("input", () => patchCard(card.id, { [def.key]: el.value }));
  }

  /* Wire PAX code input */
  const fPax = document.getElementById("f_pax_code");
  fPax.addEventListener("input", () =>
    patchCard(card.id, { pax_code: fPax.value.trim().toUpperCase() })
  );

  /* Wire drawer fetch button */
  document.getElementById("btnDrawerFetch")?.addEventListener("click", async () => {
    const err = document.getElementById("drawerErr");
    err.classList.add("hidden");
    err.textContent = "";
    const pax = String(byId(card.id)?.pax_code || "").trim().toUpperCase();
    if (!pax) {
      err.textContent = "Enter a PAX code first.";
      err.classList.remove("hidden");
      return;
    }
    const btn = document.getElementById("btnDrawerFetch");
    btn.disabled = true;
    btn.textContent = "Fetching…";
    try {
      const data = await fetchPax(pax);
      const normItems = normaliseItems(data.items, data.items_text);
      patchCard(card.id, {
        pax_code:     pax,
        ikea_total:   data.total,
        item_count:   data.item_count,
        items_text:   data.items_text || "",
        images:       data.images || [],
        items:        normItems,
        last_fetched: Date.now(),
      });
      renderDrawer();
      renderBoard();
      renderStats();
    } catch (e) {
      err.textContent = String(e?.message || e);
      err.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "↻ Re-fetch";
    }
  });

  /* Wire clear button */
  document.getElementById("btnDrawerClear")?.addEventListener("click", () => {
    patchCard(card.id, {
      ikea_total: null, item_count: null,
      items_text: "", images: [], items: [],
      last_fetched: null,
    });
    renderDrawer();
    renderBoard();
    renderStats();
  });

  /* Wire items editor events */
  if (hasFetch) wireItemsEditor(card.id);
}

/* ─── Fetch summary boxes ─── */
function buildFetchSummaryHtml(card) {
  return `
    <div class="fetchSummary">
      <div class="fetchBox green">
        <div class="fetchBoxLabel">IKEA Total</div>
        <div class="fetchBoxVal" id="drawerIkeaTotal">${escapeHtml(money(card.ikea_total))}</div>
      </div>
      <div class="fetchBox blue">
        <div class="fetchBoxLabel">Items (units)</div>
        <div class="fetchBoxVal" id="drawerIkeaCount">${escapeHtml(String(card.item_count ?? ""))}</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px">
      Last fetched: ${escapeHtml(fmtDate(card.last_fetched))}
      — edit quantities or prices below; totals update live
    </div>`;
}

/* ─── Items editor HTML ─── */
function buildItemsEditorHtml(cardId) {
  const card  = byId(cardId);
  const items = card?.items || [];

  const rows = items.map((item, idx) => `
    <tr data-idx="${idx}">
      <td><input class="nameInput" type="text" value="${escapeAttr(item.name)}" placeholder="Item name" /></td>
      <td><input class="qtyInput"  type="number" min="0" step="1" value="${item.qty}" /></td>
      <td><input class="priceInput" type="number" min="0" step="0.01" value="${item.unit_price.toFixed(2)}" /></td>
      <td class="lineTotal" id="lt_${idx}">£${(item.qty * item.unit_price).toFixed(2)}</td>
      <td><button class="delItemBtn" title="Remove item">✕</button></td>
    </tr>
  `).join("");

  const grandTotal = (card?.ikea_total || 0).toFixed(2);

  return `
    <div class="itemsEditor">
      <table class="itemsTable">
        <thead>
          <tr>
            <th>Item / Description</th>
            <th>Qty</th>
            <th>Unit £</th>
            <th class="right">Line</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="itemsTbody">
          ${rows}
        </tbody>
      </table>
      <button class="addItemBtn" id="addItemBtn">+ Add custom item</button>
      <div class="itemsTotalBar">
        <div class="itemsTotalLabel">TOTAL (all items)</div>
        <div class="itemsGrandTotal" id="itemsGrandTotal">£${grandTotal}</div>
      </div>
    </div>`;
}

/* ─── Wire items editor events ─── */
function wireItemsEditor(cardId) {
  const tbody = document.getElementById("itemsTbody");
  if (!tbody) return;

  function updateLineTotals() {
    const card = byId(cardId);
    if (!card) return;
    let grand = 0;
    (card.items || []).forEach((item, idx) => {
      const line = item.qty * item.unit_price;
      grand += line;
      const ltEl = document.getElementById(`lt_${idx}`);
      if (ltEl) ltEl.textContent = `£${line.toFixed(2)}`;
    });
    card.ikea_total = Math.round(grand * 100) / 100;
    card.item_count = (card.items || []).reduce((s,it) => s + (it.qty||0), 0);
    saveCards(cards);

    const gtEl = document.getElementById("itemsGrandTotal");
    if (gtEl) gtEl.textContent = `£${grand.toFixed(2)}`;
    const sumEl = document.getElementById("drawerIkeaTotal");
    if (sumEl) sumEl.textContent = money(card.ikea_total);
    const cntEl = document.getElementById("drawerIkeaCount");
    if (cntEl) cntEl.textContent = String(card.item_count ?? "");
  }

  /* Input delegation on tbody */
  tbody.addEventListener("input", e => {
    const tr  = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const idx  = parseInt(tr.dataset.idx, 10);
    const card = byId(cardId);
    if (!card || !card.items[idx]) return;

    if (e.target.classList.contains("nameInput")) {
      card.items[idx].name = e.target.value;
      saveCards(cards);
    } else if (e.target.classList.contains("qtyInput")) {
      card.items[idx].qty = Math.max(0, parseInt(e.target.value, 10) || 0);
      updateLineTotals();
    } else if (e.target.classList.contains("priceInput")) {
      card.items[idx].unit_price = Math.max(0, parseFloat(e.target.value) || 0);
      updateLineTotals();
    }
  });

  /* Delete delegation */
  tbody.addEventListener("click", e => {
    if (!e.target.classList.contains("delItemBtn")) return;
    const tr  = e.target.closest("tr[data-idx]");
    if (!tr) return;
    const idx  = parseInt(tr.dataset.idx, 10);
    const card = byId(cardId);
    if (!card) return;
    card.items.splice(idx, 1);
    recalcFromItems(cardId);
    // Re-render just the items editor
    const wrap = document.getElementById("itemsEditorWrap");
    if (wrap) {
      wrap.innerHTML = buildItemsEditorHtml(cardId);
      wireItemsEditor(cardId);
    }
    // Update summary boxes
    const c2 = byId(cardId);
    const sumEl = document.getElementById("drawerIkeaTotal");
    if (sumEl) sumEl.textContent = money(c2.ikea_total);
    const cntEl = document.getElementById("drawerIkeaCount");
    if (cntEl) cntEl.textContent = String(c2.item_count ?? "");
    renderBoard();
    renderStats();
  });

  /* Add item button */
  document.getElementById("addItemBtn")?.addEventListener("click", () => {
    const card = byId(cardId);
    if (!card) return;
    card.items.push({ name: "", qty: 1, unit_price: 0 });
    saveCards(cards);
    const wrap = document.getElementById("itemsEditorWrap");
    if (wrap) {
      wrap.innerHTML = buildItemsEditorHtml(cardId);
      wireItemsEditor(cardId);
      // Focus the new row's name input
      const rows = wrap.querySelectorAll(".nameInput");
      rows[rows.length - 1]?.focus();
    }
  });
}

/* ═══════════════════════════════════════
   PATCH / CRUD
═══════════════════════════════════════ */
function patchCard(id, patch) {
  const idx = cards.findIndex(c => c.id === id);
  if (idx < 0) return;
  cards[idx] = { ...cards[idx], ...patch };
  saveCards(cards);
}

/* ═══════════════════════════════════════
   DRAWER CONTROLS
═══════════════════════════════════════ */
function openDrawer(id) {
  selectedId = id;
  elDrawer.classList.remove("hidden");
  renderDrawer();
  renderBoard(); // re-render to show selected border
}
function closeDrawer() {
  selectedId = null;
  elDrawer.classList.add("hidden");
  elDrawerSub.textContent = "Select a card";
  renderDrawer();
  renderBoard();
}

/* ═══════════════════════════════════════
   API
═══════════════════════════════════════ */
async function fetchPax(pax_code) {
  const r = await fetch("/scrape", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pax_code }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

/* ═══════════════════════════════════════
   TOPBAR WIRING
═══════════════════════════════════════ */
function wireTopbar() {
  /* New lead */
  document.getElementById("btnAdd").addEventListener("click", () => {
    const firstCol = settings.columns?.[0]?.id || "new";
    const card = {
      id: uid(), status: firstCol,
      customer_name: "", phone: "", postcode: "",
      pax_code: "", schedule_date: "", budget: "", address: "", notes: "",
      ikea_total: null, item_count: null,
      items_text: "", images: [], items: [],
      last_fetched: null,
    };
    saveCards([card, ...cards]);
    renderBoard();
    renderStats();
    openDrawer(card.id);
  });

  /* Export */
  document.getElementById("btnExport").addEventListener("click", () => {
    downloadJson("pax-crm-export.json", { settings, cards });
  });

  /* Import */
  document.getElementById("fileImport").addEventListener("change", async e => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const parsed = JSON.parse(await f.text());
      if (parsed && typeof parsed === "object") {
        if (parsed.settings) saveSettings(mergeDeep(structuredClone(DEFAULT_SETTINGS), parsed.settings));
        if (Array.isArray(parsed.cards)) saveCards(parsed.cards);
        applyTheme(settings.theme);
        ensureCardsCompatible();
        renderAll();
      }
    } catch {}
    e.target.value = "";
  });

  /* Reset */
  document.getElementById("btnReset").addEventListener("click", () => {
    if (!confirm("Reset everything? This clears all local data.")) return;
    localStorage.removeItem(CARDS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    settings = structuredClone(DEFAULT_SETTINGS);
    cards    = [];
    applyTheme(settings.theme);
    renderAll();
    closeDrawer();
  });

  /* Search */
  elSearch.addEventListener("input", () => {
    searchQuery = elSearch.value;
    renderBoard();
  });

  /* Drawer close */
  document.getElementById("btnCloseDrawer").addEventListener("click", closeDrawer);

  /* Settings */
  document.getElementById("btnSettings").addEventListener("click", openSettings);
  document.getElementById("btnCloseSettings").addEventListener("click", closeSettings);
  document.getElementById("btnCancelSettings").addEventListener("click", closeSettings);
  document.getElementById("btnSaveSettings").addEventListener("click", () => {
    saveSettings(settingsDraft);
    applyTheme(settings.theme);
    ensureCardsCompatible();
    renderAll();
    closeSettings();
  });
}

/* ═══════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════ */
let settingsDraft = null;

function openSettings() {
  settingsDraft = structuredClone(settings);
  document.getElementById("autoOpenDrawer").checked = !!settingsDraft.autoOpenDrawer;
  document.getElementById("currency").value          = settingsDraft.currency || "GBP";

  document.getElementById("toggleTheme").onclick = () => {
    settingsDraft.theme = settingsDraft.theme === "dark" ? "light" : "dark";
    applyTheme(settingsDraft.theme);
  };
  document.getElementById("autoOpenDrawer").onchange = e => {
    settingsDraft.autoOpenDrawer = !!e.target.checked;
  };
  document.getElementById("currency").onchange = e => {
    settingsDraft.currency = e.target.value;
  };
  document.getElementById("btnAddColumn").onclick = () => {
    const id = "col_" + Math.random().toString(16).slice(2, 8);
    settingsDraft.columns.push({ id, name: "New column", color: "#2563eb", icon: "🧩" });
    renderColumnsEditor();
  };

  renderColumnsEditor();
  renderFieldToggles();
  elSettingsModal.classList.remove("hidden");
}

function closeSettings() {
  applyTheme(settings.theme);
  elSettingsModal.classList.add("hidden");
  settingsDraft = null;
}

function renderColumnsEditor() {
  elColumnsList.innerHTML = "";
  (settingsDraft.columns || []).forEach((c, idx) => {
    const row = document.createElement("div");
    row.className = "colRow";
    row.innerHTML = `
      <input type="text" value="${escapeAttr(c.name || "")}" placeholder="Column name" />
      <input type="color" value="${escapeAttr(c.color || "#2563eb")}" />
      <button class="iconBtn" title="Move up">↑</button>
      <button class="iconBtn" title="Move down">↓</button>
      <button class="iconBtn" title="Delete">🗑</button>
    `;
    const [nameEl, colorEl, upBtn, downBtn, delBtn] = row.querySelectorAll("input,button");
    const cols = settingsDraft.columns;

    nameEl.addEventListener("input",  () => { c.name  = nameEl.value; });
    colorEl.addEventListener("input", () => { c.color = colorEl.value; });

    upBtn.addEventListener("click", () => {
      if (idx <= 0) return;
      [cols[idx-1], cols[idx]] = [cols[idx], cols[idx-1]];
      renderColumnsEditor();
    });
    downBtn.addEventListener("click", () => {
      if (idx >= cols.length - 1) return;
      [cols[idx+1], cols[idx]] = [cols[idx], cols[idx+1]];
      renderColumnsEditor();
    });
    delBtn.addEventListener("click", () => {
      if (cols.length <= 1) { alert("Need at least 1 column."); return; }
      if (!confirm(`Delete column "${c.name}"? Cards will move to the first column.`)) return;
      const [removed] = cols.splice(idx, 1);
      saveCards(cards.map(card =>
        card.status === removed.id ? { ...card, status: cols[0].id } : card
      ));
      renderColumnsEditor();
    });

    elColumnsList.appendChild(row);
  });
}

function renderFieldToggles() {
  elFieldToggles.innerHTML = "";
  FIELD_DEFS.forEach(def => {
    const wrap = document.createElement("div");
    wrap.className = "toggleRow";
    const checked = !!settingsDraft.fields?.[def.key];
    wrap.innerHTML = `
      <div class="toggleText">
        <div class="name">${escapeHtml(def.label)}</div>
        <div class="desc">${escapeHtml(def.desc || "")}</div>
      </div>
      <label class="switch">
        <input type="checkbox" ${checked ? "checked" : ""} />
        <span class="slider"></span>
      </label>
    `;
    wrap.querySelector("input").addEventListener("change", e => {
      settingsDraft.fields[def.key] = !!e.target.checked;
    });
    elFieldToggles.appendChild(wrap);
  });
}

/* ═══════════════════════════════════════
   UTILITIES
═══════════════════════════════════════ */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a    = Object.assign(document.createElement("a"), {
    href:     URL.createObjectURL(blob),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Convert hex colour + alpha to rgba string */
function hexAlpha(hex, alpha) {
  if (!hex || !hex.startsWith("#")) return `rgba(37,99,235,${alpha})`;
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll("\n"," "); }
