/* ═══════════════════════════════════════════════════════════
   PAX CRM Board — app.js
   Features: Kanban + Table view, drag-and-drop, editable items,
   activity log, priority flags, deposit tracking, per-column totals,
   overdue highlighting, templates, custom fields, stats bar
═══════════════════════════════════════════════════════════ */

const CARDS_KEY    = "pax_crm_cards_v3";
const SETTINGS_KEY = "pax_crm_settings_v3";

/* ─── Default settings ─── */
const DEFAULT_SETTINGS = {
  theme:          "light",
  autoOpenDrawer: true,
  currency:       "GBP",
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
    email:         false,
    assigned_to:   true,
    deposit:       true,
    lead_source:   false,
    job_type:      true,
    priority:      true,
  },
  customFields:  [], // [{id, label, type, placeholder}]
  templates: [
    {
      id:"tpl_standard", name:"🔧 Standard Supply & Fit",
      defaults:{ job_type:"Supply & Fit", priority:"normal", lead_source:"Google" }
    },
    {
      id:"tpl_fitonly", name:"🛠 Fit Only",
      defaults:{ job_type:"Fit Only", priority:"normal" }
    },
    {
      id:"tpl_design", name:"📐 Design Consult",
      defaults:{ job_type:"Design Consult", priority:"low", status:"new" }
    },
  ],
};

/* ─── Built-in field definitions ─── */
const FIELD_DEFS = [
  { key:"phone",         label:"Phone",       type:"tel",      placeholder:"07…",         desc:"Customer phone number",     cardShow:true },
  { key:"email",         label:"Email",       type:"email",    placeholder:"name@…",      desc:"Customer email address",    cardShow:false },
  { key:"postcode",      label:"Postcode",    type:"text",     placeholder:"WD23 3EA",    desc:"Installation postcode",     cardShow:true },
  { key:"pax_code",      label:"PAX Code",    type:"text",     placeholder:"VSQWPG",      desc:"IKEA PAX design code",      cardShow:true },
  { key:"schedule_date", label:"Install date",type:"date",     placeholder:"",            desc:"Scheduled install date",    cardShow:true },
  { key:"budget",        label:"Budget",      type:"number",   placeholder:"1200",        desc:"Customer budget (£)",       cardShow:false },
  { key:"address",       label:"Address",     type:"text",     placeholder:"Street/City", desc:"Installation address",      cardShow:false },
  { key:"assigned_to",   label:"Assigned",    type:"text",     placeholder:"Your name",   desc:"Team member assigned",      cardShow:true },
  { key:"deposit",       label:"Deposit",     type:"number",   placeholder:"200",         desc:"Deposit amount received",   cardShow:false },
  { key:"lead_source",   label:"Source",      type:"select",   options:["","Google","Facebook","Referral","Instagram","Checkatrade","Other"], desc:"Where lead came from", cardShow:false },
  { key:"job_type",      label:"Job type",    type:"select",   options:["","Supply & Fit","Fit Only","Design Consult","Measure Only","Other"], desc:"Type of job", cardShow:true },
  { key:"priority",      label:"Priority",    type:"select",   options:["normal","urgent","low"], desc:"Lead priority level", cardShow:false },
  { key:"notes",         label:"Notes",       type:"textarea", placeholder:"Notes…",      desc:"Internal notes (drawer only)", cardShow:false },
];

/* ─── Priority config ─── */
const PRIORITY_CFG = {
  urgent: { label:"🔴 Urgent", cls:"urgent" },
  normal: { label:"🔵 Normal", cls:"normal" },
  low:    { label:"⚪ Low",    cls:"low"    },
};

/* ═══════════════════════════════════════
   STATE
═══════════════════════════════════════ */
let settings    = loadSettings();
let cards       = loadCards();
let selectedId  = null;
let searchQuery = "";
let dragId      = null;
let currentView = "board";  // "board" | "table"
let activeDrawerTab = "details";
let tableSortKey = "customer_name";
let tableSortAsc = true;

applyTheme(settings.theme);
ensureCardsCompatible();

/* ─── DOM refs ─── */
const elBoard      = document.getElementById("board");
const elDrawer     = document.getElementById("drawer");
const elDrawerBody = document.getElementById("drawerBody");
const elDrawerSub  = document.getElementById("drawerSub");
const tplCard      = document.getElementById("cardTpl");
const elSearch     = document.getElementById("search");
const elStatsBar   = document.getElementById("statsBar");
const elBoardWrap  = document.getElementById("boardWrap");
const elTableWrap  = document.getElementById("tableWrap");
const elTableHead  = document.getElementById("tableHead");
const elTableBody  = document.getElementById("tableBody");

wireTopbar();
renderAll();

/* ═══════════════════════════════════════
   STORAGE
═══════════════════════════════════════ */
function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return sClone(DEFAULT_SETTINGS);
    return mergeDeep(sClone(DEFAULT_SETTINGS), JSON.parse(raw) || {});
  } catch { return sClone(DEFAULT_SETTINGS); }
}
function saveSettings(next) {
  settings = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
function loadCards() {
  try {
    const raw    = localStorage.getItem(CARDS_KEY);
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
function sClone(obj) { return JSON.parse(JSON.stringify(obj)); }

/* ═══════════════════════════════════════
   HELPERS
═══════════════════════════════════════ */
function uid() {
  return "c_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}
function money(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return currencySymbol(settings.currency) + v.toLocaleString("en-GB",{minimumFractionDigits:2,maximumFractionDigits:2});
}
function moneyShort(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return "—";
  const sym = currencySymbol(settings.currency);
  if (v >= 1000) return sym + (v/1000).toFixed(1) + "k";
  return sym + v.toFixed(0);
}
function currencySymbol(code) {
  const c = String(code || "GBP").toUpperCase();
  return c === "EUR" ? "€" : c === "USD" ? "$" : "£";
}
function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric",
    hour:"2-digit", minute:"2-digit" });
}
function fmtDateShort(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day:"2-digit", month:"short", year:"numeric" });
}
function timeSince(ts) {
  if (!ts) return "";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)    return "just now";
  if (s < 3600)  return `${Math.floor(s/60)}m ago`;
  if (s < 86400) return `${Math.floor(s/3600)}h ago`;
  return `${Math.floor(s/86400)}d ago`;
}
function isOverdue(card) {
  if (!card.schedule_date) return false;
  const d = new Date(card.schedule_date);
  if (Number.isNaN(d.getTime())) return false;
  // Overdue if scheduled in past AND not won
  const lastCol = (settings.columns || []).slice(-1)[0]?.id;
  return d < new Date() && card.status !== lastCol;
}
function byId(id) { return cards.find(c => c.id === id); }
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
}
function hexAlpha(hex, alpha) {
  if (!hex || !hex.startsWith("#")) return `rgba(37,99,235,${alpha})`;
  const r = parseInt(hex.slice(1,3),16);
  const g = parseInt(hex.slice(3,5),16);
  const b = parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}
function escapeAttr(s) { return escapeHtml(s).replaceAll("\n"," "); }

/* ─── Ensure cards have all fields ─── */
function ensureCardsCompatible() {
  const firstCol = settings.columns?.[0]?.id || "new";
  const valid    = new Set((settings.columns || []).map(c => c.id));
  let changed    = false;
  cards = cards.map(c => {
    const next = { ...c };
    if (!next.id)               { next.id = uid(); changed = true; }
    if (!valid.has(next.status)){ next.status = firstCol; changed = true; }
    // Ensure all built-in fields
    for (const def of FIELD_DEFS) {
      if (!(def.key in next)) next[def.key] = "";
    }
    if (!Array.isArray(next.items))    next.items    = [];
    if (!Array.isArray(next.activity)) next.activity = [];
    if (!next.custom) next.custom = {};
    return next;
  });
  if (changed) saveCards(cards);
}

/* ═══════════════════════════════════════
   ACTIVITY LOG
═══════════════════════════════════════ */
const ACTIVITY_ICONS = {
  created:"✨", status:"🔀", fetch:"⚡", edit:"✏️",
  items:"🛒", note:"📝", deposit:"💰", default:"📌"
};
function logActivity(cardId, type, text) {
  const idx = cards.findIndex(c => c.id === cardId);
  if (idx < 0) return;
  if (!Array.isArray(cards[idx].activity)) cards[idx].activity = [];
  cards[idx].activity.unshift({ ts: Date.now(), type, text });
  // Keep last 50 entries
  if (cards[idx].activity.length > 50) cards[idx].activity.length = 50;
  saveCards(cards);
}

/* ═══════════════════════════════════════
   ITEMS HELPERS
═══════════════════════════════════════ */
function parseItemsText(text) {
  const lines  = (text || "").split("\n");
  const result = [];
  for (const line of lines) {
    if (line.includes("──") || /^\s*TOTAL/i.test(line)) continue;
    const m = line.match(/^(.+?)\s*[×x]\s*(\d+)\s+£?([\d,.]+)/i);
    if (!m) continue;
    const name      = m[1].trim();
    const qty       = parseInt(m[2], 10);
    const lineTotal = parseFloat(m[3].replace(",",""));
    if (!name || !qty || !lineTotal) continue;
    result.push({ name, qty, unit_price: Math.round((lineTotal / qty) * 100) / 100 });
  }
  return result;
}
function normaliseItems(serverItems, itemsText) {
  if (Array.isArray(serverItems) && serverItems.length > 0 && "unit_price" in serverItems[0]) {
    return serverItems;
  }
  if (Array.isArray(serverItems) && serverItems.length > 0 && "price" in serverItems[0]) {
    return serverItems.map(i => ({
      name: i.name || "", qty: Number(i.qty) || 1, unit_price: Number(i.price) || 0
    }));
  }
  return parseItemsText(itemsText);
}
function recalcFromItems(id) {
  const card = byId(id);
  if (!card || !Array.isArray(card.items)) return;
  const total = card.items.reduce((s, it) => s + (it.qty||0) * (it.unit_price||0), 0);
  const count = card.items.reduce((s, it) => s + (it.qty||0), 0);
  patchCard(id, {
    ikea_total:  Math.round(total * 100) / 100,
    item_count:  count,
  });
}

/* ═══════════════════════════════════════
   FILTERED CARDS
═══════════════════════════════════════ */
function filteredCards() {
  const q = (searchQuery || "").trim().toLowerCase();
  if (!q) return cards;
  return cards.filter(c => {
    const hay = [c.customer_name, c.phone, c.postcode, c.pax_code,
                 c.notes, c.address, c.schedule_date, c.budget,
                 c.email, c.assigned_to, c.job_type, c.lead_source]
      .filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
}

/* ═══════════════════════════════════════
   STATS BAR
═══════════════════════════════════════ */
function renderStats() {
  const cols     = settings.columns || [];
  const lastCol  = cols[cols.length - 1]?.id;
  const sym      = currencySymbol(settings.currency);
  const pipeline = cards.filter(c => c.status !== lastCol)
    .reduce((s,c) => s + (parseFloat(c.budget)||0), 0);
  const wonVal   = cards.filter(c => c.status === lastCol)
    .reduce((s,c) => s + (parseFloat(c.budget)||0), 0);
  const urgent   = cards.filter(c => c.priority === "urgent").length;

  const parts = [];
  parts.push(`<div class="statItem"><span class="statN">${cards.length}</span><span class="statL">Total</span></div>`);
  parts.push(`<div class="statDivider"></div>`);
  for (const col of cols) {
    const n   = cards.filter(c => c.status === col.id).length;
    const val = cards.filter(c => c.status === col.id)
      .reduce((s,c) => s + (parseFloat(c.budget)||0), 0);
    parts.push(`<div class="statItem">
      <span class="statN" style="color:${escapeAttr(col.color)}">${n}</span>
      <span class="statL">${escapeHtml(col.icon ? col.icon + " " + col.name : col.name)}</span>
      ${val > 0 ? `<span style="font-size:10px;color:var(--muted);font-weight:700;font-family:monospace">· ${sym}${val.toLocaleString("en-GB",{maximumFractionDigits:0})}</span>` : ""}
    </div>`);
  }
  parts.push(`<div class="statDivider"></div>`);
  parts.push(`<div class="statItem pipeline"><span class="statN">${sym}${pipeline.toLocaleString("en-GB",{maximumFractionDigits:0})}</span><span class="statL">Pipeline</span></div>`);
  parts.push(`<div class="statItem wonStat"><span class="statN">${sym}${wonVal.toLocaleString("en-GB",{maximumFractionDigits:0})}</span><span class="statL">Won</span></div>`);
  if (urgent > 0) {
    parts.push(`<div class="statItem urgentStat"><span class="statN">${urgent}</span><span class="statL">🔴 Urgent</span></div>`);
  }

  elStatsBar.innerHTML = parts.join("");
}

/* ═══════════════════════════════════════
   RENDER ALL
═══════════════════════════════════════ */
function renderAll() {
  if (currentView === "board") {
    renderBoard();
  } else {
    renderTable();
  }
  renderDrawer();
  renderStats();
}

/* ═══════════════════════════════════════
   BOARD RENDER
═══════════════════════════════════════ */
function renderBoard() {
  elBoard.innerHTML = "";
  const cols = settings.columns || [];
  const list = filteredCards();

  for (const col of cols) {
    const inCol = list.filter(c => c.status === col.id);

    // Per-column totals
    const colBudget = inCol.reduce((s,c) => s + (parseFloat(c.budget)||0), 0);
    const colIkea   = inCol.reduce((s,c) => s + (parseFloat(c.ikea_total)||0), 0);

    const colEl = document.createElement("div");
    colEl.className = "column";
    colEl.style.setProperty("--accent", col.color || "#2563eb");

    colEl.innerHTML = `
      <div class="colHead">
        <div class="colHeadTop">
          <div class="colTitle">
            <span class="dot"></span>
            <span>${escapeHtml(col.icon ? `${col.icon} ${col.name}` : col.name)}</span>
          </div>
          <div class="colCount">${inCol.length}</div>
        </div>
        <div class="colTotals">
          ${colBudget > 0 ? `<div class="colTotalItem">Budget: <span class="money">${moneyShort(colBudget)}</span></div>` : ""}
          ${colIkea   > 0 ? `<div class="colTotalItem">IKEA: <span class="money">${moneyShort(colIkea)}</span></div>` : ""}
        </div>
      </div>
      <div class="colBody" data-col="${escapeAttr(col.id)}"></div>
    `;

    const body = colEl.querySelector(".colBody");

    // Drop target
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
      const oldStatus = current.status;
      patchCard(dragId, { status: col.id });
      logActivity(dragId, "status", `Moved from ${oldStatus} → ${col.id}`);
      renderAll();
    });

    if (inCol.length === 0) {
      body.innerHTML = `<div class="emptyCol">Drop a lead here</div>`;
    }

    for (const card of inCol) {
      body.appendChild(buildCardNode(card, col));
    }

    elBoard.appendChild(colEl);
  }
}

function buildCardNode(card, col) {
  const node     = tplCard.content.firstElementChild.cloneNode(true);
  const hasFetch = card.ikea_total != null;
  const overdue  = isOverdue(card);

  node.style.setProperty("--accent", col.color || "#2563eb");
  node.querySelector(".accentDot").style.background = col.color || "#2563eb";
  if (card.id === selectedId) node.classList.add("selected");
  if (overdue) node.classList.add("overdue");

  // Drag
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

  // Customer name
  const elCust = node.querySelector(".customer");
  elCust.value = card.customer_name || "";
  elCust.addEventListener("input", () => patchCard(card.id, { customer_name: elCust.value }));
  elCust.addEventListener("change", () => {
    logActivity(card.id, "edit", `Customer name updated`);
    renderStats();
  });

  // Priority badge
  const pBadge = node.querySelector(".priorityBadge");
  const p      = card.priority || "normal";
  const pCfg   = PRIORITY_CFG[p] || PRIORITY_CFG.normal;
  pBadge.textContent = pCfg.label;
  pBadge.className   = `priorityBadge ${pCfg.cls}`;

  // Notes dot
  if (card.notes && card.notes.trim()) {
    node.querySelector(".notesDot").classList.remove("hidden");
  }

  // Status chip — clicking cycles to next status
  const statusChip = node.querySelector(".statusChip");
  statusChip.textContent  = col.icon ? `${col.icon} ${col.name}` : col.name;
  statusChip.style.background = hexAlpha(col.color, 0.12);
  statusChip.style.color      = col.color || "var(--brand)";
  statusChip.addEventListener("click", e => {
    e.stopPropagation();
    const cols  = settings.columns || [];
    const idx   = cols.findIndex(c => c.id === card.status);
    const next  = cols[(idx + 1) % cols.length];
    if (!next || next.id === card.status) return;
    const old = card.status;
    patchCard(card.id, { status: next.id });
    logActivity(card.id, "status", `Status: ${old} → ${next.id}`);
    renderAll();
  });

  // Deposit chip
  if (card.deposit && parseFloat(card.deposit) > 0) {
    const chip = node.querySelector(".depositChip");
    chip.textContent = `💰 ${money(card.deposit)}`;
    chip.classList.remove("hidden");
  }

  // Overdue pill
  if (overdue) {
    node.querySelector(".overduePill").classList.remove("hidden");
  }

  // Field rows
  const elFields = node.querySelector(".fields");
  elFields.innerHTML = "";
  for (const def of FIELD_DEFS) {
    if (!settings.fields?.[def.key]) continue;
    if (!def.cardShow) continue;
    if (def.key === "notes" || def.key === "priority") continue;
    const row = document.createElement("div");
    row.className = "fieldRow";
    const inputHtml = buildFieldInput(def, card[def.key] ?? "");
    row.innerHTML = `<label>${escapeHtml(def.label)}</label>${inputHtml}`;
    const input = row.querySelector("[data-k]");
    input.addEventListener("input",  () => patchCard(card.id, { [def.key]: input.value }));
    input.addEventListener("change", () => { logActivity(card.id, "edit", `${def.label} updated`); });
    elFields.appendChild(row);
  }

  // Custom fields on card
  for (const cf of (settings.customFields || [])) {
    if (!cf.cardShow) continue;
    const row = document.createElement("div");
    row.className = "fieldRow";
    row.innerHTML = `
      <label>${escapeHtml(cf.label)}</label>
      <input data-k="cf_${cf.id}" type="${cf.type||"text"}"
        value="${escapeAttr(card.custom?.[cf.id] ?? "")}"
        placeholder="${escapeAttr(cf.placeholder||"")}" />
    `;
    const input = row.querySelector("input");
    input.addEventListener("input", () => {
      if (!byId(card.id).custom) byId(card.id).custom = {};
      byId(card.id).custom[cf.id] = input.value;
      saveCards(cards);
    });
    elFields.appendChild(row);
  }

  // Meta
  const metaEl = node.querySelector(".meta");
  if (hasFetch || card.budget) {
    metaEl.classList.remove("hidden");
    node.querySelector(".total").textContent    = hasFetch ? moneyShort(card.ikea_total) : "—";
    node.querySelector(".budgetV").textContent  = card.budget ? moneyShort(card.budget) : "—";
    node.querySelector(".count").textContent    = hasFetch ? String(card.item_count ?? "") : "";
  }

  // Fetch button
  const btnFetch = node.querySelector(".fetch");
  if (hasFetch) {
    btnFetch.textContent = "↻ Re-fetch";
    btnFetch.classList.remove("primary");
    btnFetch.classList.add("secondary");
  }

  const elErr = node.querySelector(".error");

  btnFetch.addEventListener("click", e => { e.stopPropagation(); doFetch(card.id, btnFetch, elErr); });
  node.querySelector(".open").addEventListener("click", () => openDrawer(card.id));
  node.addEventListener("dblclick", () => openDrawer(card.id));
  node.addEventListener("keydown", e => { if (e.key === "Enter") openDrawer(card.id); });

  return node;
}

/* ─── Build a field input HTML string ─── */
function buildFieldInput(def, value) {
  if (def.type === "select") {
    const opts = (def.options || []).map(o =>
      `<option value="${escapeAttr(o)}"${o === value ? " selected" : ""}>${escapeHtml(o||"—")}</option>`
    ).join("");
    return `<select data-k="${def.key}">${opts}</select>`;
  }
  if (def.type === "textarea") {
    return `<textarea data-k="${def.key}" placeholder="${escapeAttr(def.placeholder||"")}" rows="3">${escapeHtml(value)}</textarea>`;
  }
  return `<input data-k="${def.key}" type="${def.type}" value="${escapeAttr(value)}" placeholder="${escapeAttr(def.placeholder||"")}" />`;
}

/* ═══════════════════════════════════════
   TABLE VIEW
═══════════════════════════════════════ */
function renderTable() {
  const list = filteredCards().slice().sort((a, b) => {
    let av = (a[tableSortKey] ?? "").toString().toLowerCase();
    let bv = (b[tableSortKey] ?? "").toString().toLowerCase();
    return tableSortAsc ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const cols      = settings.columns || [];
  const colMap    = Object.fromEntries(cols.map(c => [c.id, c]));
  const sym       = currencySymbol(settings.currency);

  const tableCols = [
    { key:"customer_name", label:"Customer" },
    { key:"status",        label:"Status"   },
    { key:"priority",      label:"Priority" },
    { key:"phone",         label:"Phone"    },
    { key:"postcode",      label:"Postcode" },
    { key:"job_type",      label:"Job type" },
    { key:"schedule_date", label:"Install"  },
    { key:"assigned_to",   label:"Assigned" },
    { key:"budget",        label:"Budget"   },
    { key:"ikea_total",    label:"IKEA £"   },
    { key:"deposit",       label:"Deposit"  },
  ];

  // Header
  elTableHead.innerHTML = `<tr>${tableCols.map(tc => {
    const sorted = tableSortKey === tc.key;
    return `<th data-tkey="${tc.key}" class="${sorted?"sorted":""}">
      ${escapeHtml(tc.label)}
      <span class="sortArrow">${sorted ? (tableSortAsc ? "↑" : "↓") : "↕"}</span>
    </th>`;
  }).join("")}</tr>`;
  elTableHead.querySelectorAll("th").forEach(th => {
    th.addEventListener("click", () => {
      const k = th.dataset.tkey;
      if (tableSortKey === k) tableSortAsc = !tableSortAsc;
      else { tableSortKey = k; tableSortAsc = true; }
      renderTable();
    });
  });

  // Rows
  elTableBody.innerHTML = "";
  for (const card of list) {
    const col     = colMap[card.status] || cols[0];
    const overdue = isOverdue(card);
    const pr      = card.priority || "normal";
    const tr      = document.createElement("tr");
    if (card.id === selectedId) tr.classList.add("selected");
    if (overdue)                tr.classList.add("overdue");

    tr.innerHTML = tableCols.map(tc => {
      let val = card[tc.key] ?? "";
      if (tc.key === "status") {
        return `<td><span class="tblStatusChip" style="background:${hexAlpha(col.color,.12)};color:${escapeAttr(col.color)}">${escapeHtml(col.icon ? col.icon + " " + col.name : col.name)}</span></td>`;
      }
      if (tc.key === "priority") {
        const pCfg = PRIORITY_CFG[pr] || PRIORITY_CFG.normal;
        return `<td><span class="tblPriority ${pCfg.cls}">${escapeHtml(pCfg.label)}</span></td>`;
      }
      if (tc.key === "budget"    && val) return `<td><span class="tblMoney warn">${sym}${parseFloat(val).toLocaleString("en-GB",{maximumFractionDigits:0})}</span></td>`;
      if (tc.key === "ikea_total"&& val) return `<td><span class="tblMoney good">${sym}${parseFloat(val).toLocaleString("en-GB",{maximumFractionDigits:2})}</span></td>`;
      if (tc.key === "deposit"   && val) return `<td><span class="tblMoney good">${sym}${parseFloat(val).toLocaleString("en-GB",{maximumFractionDigits:0})}</span></td>`;
      if (tc.key === "schedule_date" && val) {
        return `<td style="${overdue ? "color:var(--bad);font-weight:700" : ""}">${escapeHtml(val)}</td>`;
      }
      return `<td>${escapeHtml(String(val))}</td>`;
    }).join("");

    tr.addEventListener("click", () => openDrawer(card.id));
    elTableBody.appendChild(tr);
  }
}

/* ═══════════════════════════════════════
   PATCH + CRUD
═══════════════════════════════════════ */
function patchCard(id, patch) {
  const idx = cards.findIndex(c => c.id === id);
  if (idx < 0) return;
  cards[idx] = { ...cards[idx], ...patch };
  saveCards(cards);
}

/* ═══════════════════════════════════════
   DRAWER
═══════════════════════════════════════ */
function renderDrawer() {
  if (!selectedId) {
    elDrawerSub.textContent = "Select a card";
    elDrawerBody.innerHTML  = `
      <div style="text-align:center;padding:40px 20px;color:var(--muted)">
        <div style="font-size:36px;margin-bottom:12px">👈</div>
        <div style="font-weight:700;margin-bottom:4px">No lead selected</div>
        <div style="font-size:13px">Click any card or table row</div>
      </div>`;
    return;
  }
  const card = byId(selectedId);
  if (!card) return;
  elDrawerSub.textContent = card.customer_name || "(Unnamed lead)";

  if (activeDrawerTab === "details") renderDrawerDetails(card);
  else if (activeDrawerTab === "items")  renderDrawerItems(card);
  else if (activeDrawerTab === "activity") renderDrawerActivity(card);
}

/* ─── Details tab ─── */
function renderDrawerDetails(card) {
  const cols          = settings.columns || [];
  const statusOptions = cols.map(c =>
    `<option value="${c.id}">${escapeHtml((c.icon ? c.icon + " " : "") + c.name)}</option>`
  ).join("");

  let fieldsHtml = "";
  for (const def of FIELD_DEFS) {
    if (!settings.fields?.[def.key]) continue;
    const val = card[def.key] ?? "";
    if (def.type === "textarea") {
      fieldsHtml += `
        <div class="dField">
          <div class="dLabel">${escapeHtml(def.label)}</div>
          <textarea id="f_${def.key}" rows="4" placeholder="${escapeAttr(def.placeholder||"")}">${escapeHtml(val)}</textarea>
        </div>`;
    } else if (def.type === "select") {
      const opts = (def.options||[]).map(o =>
        `<option value="${escapeAttr(o)}"${o === val ? " selected" : ""}>${escapeHtml(o||"—")}</option>`
      ).join("");
      fieldsHtml += `
        <div class="dField">
          <div class="dLabel">${escapeHtml(def.label)}</div>
          <select id="f_${def.key}">${opts}</select>
        </div>`;
    } else {
      fieldsHtml += `
        <div class="dField">
          <div class="dLabel">${escapeHtml(def.label)}</div>
          <input id="f_${def.key}" type="${def.type}"
            value="${escapeAttr(val)}" placeholder="${escapeAttr(def.placeholder||"")}" />
        </div>`;
    }
  }

  // Custom fields in drawer
  let customHtml = "";
  for (const cf of (settings.customFields || [])) {
    const val = card.custom?.[cf.id] ?? "";
    customHtml += `
      <div class="dField">
        <div class="dLabel">${escapeHtml(cf.label)}</div>
        <input id="cf_${cf.id}" type="${cf.type||"text"}"
          value="${escapeAttr(val)}" placeholder="${escapeAttr(cf.placeholder||"")}" />
      </div>`;
  }

  elDrawerBody.innerHTML = `
    <div class="drawerSection">
      <div class="drawerSectionTitle">Basics</div>
      <div class="dField">
        <div class="dLabel">Customer name</div>
        <input id="f_customer_name" value="${escapeAttr(card.customer_name||"")}" placeholder="Customer name" />
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div class="dField">
          <div class="dLabel">Status</div>
          <select id="f_status">${statusOptions}</select>
        </div>
        <div class="dField">
          <div class="dLabel">Priority</div>
          <select id="f_priority_drawer">
            <option value="normal"${card.priority==="normal"?" selected":""}>🔵 Normal</option>
            <option value="urgent"${card.priority==="urgent"?" selected":""}>🔴 Urgent</option>
            <option value="low"   ${card.priority==="low"   ?" selected":""}>⚪ Low</option>
          </select>
        </div>
      </div>
    </div>

    <div class="drawerSection">
      <div class="drawerSectionTitle">Contact & Job details</div>
      ${fieldsHtml}
    </div>

    ${customHtml ? `
    <div class="drawerSection">
      <div class="drawerSectionTitle">Custom fields</div>
      ${customHtml}
    </div>` : ""}

    <div class="drawerSection">
      <div class="drawerSectionTitle">PAX fetch</div>
      <div class="dField">
        <div class="dLabel">PAX Design Code</div>
        <div style="display:flex;gap:8px">
          <input id="f_pax_code"
            value="${escapeAttr(card.pax_code||"")}"
            placeholder="VSQWPG"
            style="font-family:ui-monospace,'Cascadia Code',monospace;letter-spacing:2px;font-weight:700"
          />
          <button class="btn mini primary" id="btnDrawerFetch" style="white-space:nowrap">
            ${card.ikea_total != null ? "↻ Re-fetch" : "⚡ Fetch items"}
          </button>
        </div>
      </div>
      <div class="error hidden" id="drawerErr"></div>
    </div>

    <div style="display:flex;gap:8px;padding-top:4px;border-top:1px solid var(--line);margin-top:4px">
      <button class="btn mini danger" id="btnDeleteCard">🗑 Delete lead</button>
    </div>
  `;

  /* Wire status */
  const fStatus = document.getElementById("f_status");
  fStatus.value = card.status;
  fStatus.addEventListener("change", () => {
    const old = card.status;
    patchCard(card.id, { status: fStatus.value });
    logActivity(card.id, "status", `Status: ${old} → ${fStatus.value}`);
    renderBoard(); renderStats();
    if (currentView === "table") renderTable();
  });

  /* Wire priority */
  const fPri = document.getElementById("f_priority_drawer");
  fPri.addEventListener("change", () => {
    patchCard(card.id, { priority: fPri.value });
    logActivity(card.id, "edit", `Priority → ${fPri.value}`);
    renderBoard(); renderStats();
    if (currentView === "table") renderTable();
  });

  /* Wire customer */
  const fCust = document.getElementById("f_customer_name");
  fCust.addEventListener("input", () => patchCard(card.id, { customer_name: fCust.value }));
  fCust.addEventListener("change", () => {
    elDrawerSub.textContent = fCust.value || "(Unnamed lead)";
    renderBoard();
  });

  /* Wire all other fields */
  for (const def of FIELD_DEFS) {
    if (!settings.fields?.[def.key]) continue;
    const el = document.getElementById("f_" + def.key);
    if (!el) continue;
    el.addEventListener("input", () => {
      patchCard(card.id, { [def.key]: el.value });
    });
    el.addEventListener("change", () => {
      logActivity(card.id, "edit", `${def.label} updated`);
      if (def.key === "deposit") { renderBoard(); renderStats(); }
    });
  }

  /* Wire PAX code */
  const fPax = document.getElementById("f_pax_code");
  fPax?.addEventListener("input", () =>
    patchCard(card.id, { pax_code: fPax.value.trim().toUpperCase() })
  );

  /* Wire custom fields */
  for (const cf of (settings.customFields || [])) {
    const el = document.getElementById("cf_" + cf.id);
    if (!el) continue;
    el.addEventListener("input", () => {
      const c = byId(card.id);
      if (!c.custom) c.custom = {};
      c.custom[cf.id] = el.value;
      saveCards(cards);
    });
  }

  /* Drawer fetch */
  document.getElementById("btnDrawerFetch")?.addEventListener("click", async () => {
    const errEl = document.getElementById("drawerErr");
    errEl.classList.add("hidden");
    const pax = String(byId(card.id)?.pax_code || "").trim().toUpperCase();
    if (!pax) { errEl.textContent = "Enter a PAX code first."; errEl.classList.remove("hidden"); return; }
    const btn = document.getElementById("btnDrawerFetch");
    btn.disabled = true; btn.textContent = "Fetching…";
    try {
      const data      = await fetchPax(pax);
      const normItems = normaliseItems(data.items, data.items_text);
      patchCard(card.id, {
        pax_code: pax, ikea_total: data.total, item_count: data.item_count,
        items_text: data.items_text || "", images: data.images || [],
        items: normItems, last_fetched: Date.now(),
      });
      logActivity(card.id, "fetch", `PAX fetch: ${normItems.length} item types, total ${money(data.total)}`);
      renderAll();
    } catch (e) {
      errEl.textContent = String(e?.message || e);
      errEl.classList.remove("hidden");
      btn.disabled = false;
      btn.textContent = "↻ Re-fetch";
    }
  });

  /* Delete */
  document.getElementById("btnDeleteCard")?.addEventListener("click", () => {
    if (!confirm("Delete this lead?")) return;
    saveCards(cards.filter(c => c.id !== card.id));
    selectedId = null;
    closeDrawer();
    renderAll();
  });
}

/* ─── Items tab ─── */
function renderDrawerItems(card) {
  const hasFetch = card.ikea_total != null;
  elDrawerBody.innerHTML = `
    <div class="drawerSection">
      <div class="drawerSectionTitle">IKEA Items</div>
      ${hasFetch ? buildFetchSummaryHtml(card) : ""}
      ${hasFetch
        ? `<div id="itemsEditorWrap">${buildItemsEditorHtml(card.id)}</div>
           <div style="margin-top:8px">
             <button class="btn mini danger" id="btnDrawerClear">Clear all fetch data</button>
           </div>
           ${(card.images||[]).length > 0 ? buildImagesHtml(card.images) : ""}`
        : `<div class="noFetchPlaceholder">
             No items yet.<br/>
             <span style="font-size:12px">Switch to the Details tab, enter a PAX code and click ⚡ Fetch items.</span>
           </div>`}
    </div>
  `;
  if (hasFetch) {
    wireItemsEditor(card.id);
    document.getElementById("btnDrawerClear")?.addEventListener("click", () => {
      patchCard(card.id, { ikea_total:null, item_count:null, items_text:"", images:[], items:[], last_fetched:null });
      logActivity(card.id, "items", "Cleared fetch data");
      renderAll();
    });
    // Wire image lightbox
    elDrawerBody.querySelectorAll(".imgWrap img").forEach(img => {
      img.addEventListener("click", () => {
        document.getElementById("lightboxImg").src        = img.src;
        document.getElementById("lightboxCaption").textContent = img.alt;
        document.getElementById("lightbox").classList.remove("hidden");
      });
    });
  }
}

/* ─── Activity tab ─── */
function renderDrawerActivity(card) {
  const activity = card.activity || [];
  elDrawerBody.innerHTML = `
    <div class="drawerSection">
      <div class="drawerSectionTitle">Activity log</div>
      ${activity.length === 0
        ? `<div class="emptyActivity">No activity recorded yet.</div>`
        : `<div class="activityList">
            ${activity.map(a => `
              <div class="activityItem">
                <div class="activityIcon">${ACTIVITY_ICONS[a.type] || ACTIVITY_ICONS.default}</div>
                <div>
                  <div class="activityText">${escapeHtml(a.text)}</div>
                  <div class="activityTime">${escapeHtml(fmtDate(a.ts))}</div>
                </div>
              </div>
            `).join("")}
          </div>`}
    </div>`;
}

function buildFetchSummaryHtml(card) {
  return `
    <div class="fetchSummary">
      <div class="fetchBox green">
        <div class="fetchBoxLabel">IKEA Total</div>
        <div class="fetchBoxVal" id="drawerIkeaTotal">${escapeHtml(money(card.ikea_total))}</div>
      </div>
      <div class="fetchBox blue">
        <div class="fetchBoxLabel">Units</div>
        <div class="fetchBoxVal" id="drawerIkeaCount">${escapeHtml(String(card.item_count ?? ""))}</div>
      </div>
    </div>
    <div style="font-size:11px;color:var(--muted);margin-bottom:10px">
      Last fetched: ${escapeHtml(fmtDate(card.last_fetched))} — edit qty or price; totals update live
    </div>`;
}

function buildItemsEditorHtml(cardId) {
  const card  = byId(cardId);
  const items = card?.items || [];

  const rows = items.map((item, idx) => `
    <tr data-idx="${idx}">
      <td><input class="nameInput" type="text" value="${escapeAttr(item.name)}" placeholder="Item name" /></td>
      <td><input class="qtyInput" type="number" min="0" step="1" value="${item.qty}" /></td>
      <td><input class="priceInput" type="number" min="0" step="0.01" value="${item.unit_price.toFixed(2)}" /></td>
      <td class="lineTotal" id="lt_${idx}">£${(item.qty * item.unit_price).toFixed(2)}</td>
      <td><button class="delItemBtn" title="Remove">✕</button></td>
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
        <tbody id="itemsTbody">${rows}</tbody>
      </table>
      <button class="addItemBtn" id="addItemBtn">+ Add item or extra</button>
      <div class="itemsTotalBar">
        <div class="itemsTotalLabel">TOTAL</div>
        <div class="itemsGrandTotal" id="itemsGrandTotal">£${grandTotal}</div>
      </div>
    </div>`;
}

function buildImagesHtml(images) {
  const imgs = images.slice(0, 16);
  return `
    <div style="margin-top:14px">
      <div class="drawerSectionTitle">Product images</div>
      <div class="imagesGrid">
        ${imgs.map(im => `
          <div class="imgWrap">
            <img src="${escapeAttr(im.url)}" alt="${escapeAttr(im.filename||"image")}"
              title="${escapeAttr(im.filename||im.url)}" loading="lazy" />
            <div class="imgName">${escapeHtml(im.filename||"")}</div>
          </div>`).join("")}
      </div>
    </div>`;
}

function wireItemsEditor(cardId) {
  const tbody = document.getElementById("itemsTbody");
  if (!tbody) return;

  function updateTotals() {
    const card  = byId(cardId);
    if (!card)  return;
    let grand   = 0;
    (card.items || []).forEach((item, idx) => {
      const line = item.qty * item.unit_price;
      grand     += line;
      const ltEl = document.getElementById(`lt_${idx}`);
      if (ltEl) ltEl.textContent = `£${line.toFixed(2)}`;
    });
    card.ikea_total  = Math.round(grand * 100) / 100;
    card.item_count  = (card.items || []).reduce((s,it) => s+(it.qty||0), 0);
    saveCards(cards);
    const gtEl = document.getElementById("itemsGrandTotal");
    if (gtEl) gtEl.textContent = `£${grand.toFixed(2)}`;
    const sTot = document.getElementById("drawerIkeaTotal");
    if (sTot) sTot.textContent = money(card.ikea_total);
    const sCnt = document.getElementById("drawerIkeaCount");
    if (sCnt) sCnt.textContent = String(card.item_count ?? "");
    renderStats();
    if (currentView === "board") {
      // Quietly update the card meta if open
      renderBoard();
    }
  }

  tbody.addEventListener("input", e => {
    const tr   = e.target.closest("tr[data-idx]");
    if (!tr)   return;
    const idx  = parseInt(tr.dataset.idx, 10);
    const card = byId(cardId);
    if (!card || !card.items[idx]) return;
    if (e.target.classList.contains("nameInput")) {
      card.items[idx].name = e.target.value; saveCards(cards);
    } else if (e.target.classList.contains("qtyInput")) {
      card.items[idx].qty  = Math.max(0, parseInt(e.target.value, 10) || 0);
      updateTotals();
    } else if (e.target.classList.contains("priceInput")) {
      card.items[idx].unit_price = Math.max(0, parseFloat(e.target.value) || 0);
      updateTotals();
    }
  });

  tbody.addEventListener("blur", e => {
    if (e.target.classList.contains("nameInput")) {
      logActivity(cardId, "items", "Item names updated");
    }
  }, true);

  tbody.addEventListener("click", e => {
    if (!e.target.classList.contains("delItemBtn")) return;
    const tr   = e.target.closest("tr[data-idx]");
    if (!tr)   return;
    const idx  = parseInt(tr.dataset.idx, 10);
    const card = byId(cardId);
    if (!card) return;
    const removed = card.items.splice(idx, 1)[0];
    recalcFromItems(cardId);
    logActivity(cardId, "items", `Removed: ${removed.name} ×${removed.qty}`);
    const wrap = document.getElementById("itemsEditorWrap");
    if (wrap) { wrap.innerHTML = buildItemsEditorHtml(cardId); wireItemsEditor(cardId); }
    updateSummaryBoxes(cardId);
    renderStats();
    if (currentView === "board") renderBoard();
    else renderTable();
  });

  document.getElementById("addItemBtn")?.addEventListener("click", () => {
    const card = byId(cardId);
    if (!card) return;
    card.items.push({ name:"", qty:1, unit_price:0 });
    saveCards(cards);
    logActivity(cardId, "items", "Added custom item");
    const wrap = document.getElementById("itemsEditorWrap");
    if (wrap) {
      wrap.innerHTML = buildItemsEditorHtml(cardId);
      wireItemsEditor(cardId);
      wrap.querySelectorAll(".nameInput")[card.items.length - 1]?.focus();
    }
  });
}

function updateSummaryBoxes(cardId) {
  const card = byId(cardId);
  if (!card) return;
  const sTot = document.getElementById("drawerIkeaTotal");
  if (sTot) sTot.textContent = money(card.ikea_total);
  const sCnt = document.getElementById("drawerIkeaCount");
  if (sCnt) sCnt.textContent = String(card.item_count ?? "");
  const gtEl = document.getElementById("itemsGrandTotal");
  if (gtEl) gtEl.textContent = `£${(card.ikea_total || 0).toFixed(2)}`;
}

/* ═══════════════════════════════════════
   DRAWER CONTROLS
═══════════════════════════════════════ */
function openDrawer(id) {
  selectedId = id;
  elDrawer.classList.remove("hidden");
  renderDrawer();
  // Highlight selected card in board/table
  if (currentView === "board") renderBoard();
  else renderTable();
}
function closeDrawer() {
  selectedId = null;
  elDrawer.classList.add("hidden");
  elDrawerSub.textContent = "Select a card";
  if (currentView === "board") renderBoard();
  else renderTable();
}

/* Navigate prev/next card */
function navigateCard(direction) {
  const list = filteredCards();
  if (list.length === 0 || !selectedId) return;
  const idx  = list.findIndex(c => c.id === selectedId);
  const next = list[(idx + direction + list.length) % list.length];
  if (next) openDrawer(next.id);
}

/* ═══════════════════════════════════════
   FETCH API
═══════════════════════════════════════ */
async function fetchPax(pax_code) {
  const r = await fetch("/scrape", {
    method:  "POST",
    headers: { "Content-Type":"application/json" },
    body:    JSON.stringify({ pax_code }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

async function doFetch(cardId, btnEl, errEl) {
  errEl.classList.add("hidden");
  errEl.textContent = "";
  const pax = String(byId(cardId)?.pax_code || "").trim().toUpperCase();
  if (!pax) {
    errEl.textContent = "Enter a PAX code first.";
    errEl.classList.remove("hidden");
    return;
  }
  btnEl.disabled    = true;
  btnEl.textContent = "Fetching…";
  try {
    const data      = await fetchPax(pax);
    const normItems = normaliseItems(data.items, data.items_text);
    patchCard(cardId, {
      pax_code:     pax,
      ikea_total:   data.total,
      item_count:   data.item_count,
      items_text:   data.items_text || "",
      images:       data.images || [],
      items:        normItems,
      last_fetched: Date.now(),
    });
    logActivity(cardId, "fetch", `Fetched ${normItems.length} item types, total ${money(data.total)}`);
    renderAll();
    if (settings.autoOpenDrawer) openDrawer(cardId);
  } catch (e) {
    errEl.textContent = String(e?.message || e);
    errEl.classList.remove("hidden");
  } finally {
    btnEl.disabled    = false;
    const hasFetch    = byId(cardId)?.ikea_total != null;
    btnEl.textContent = hasFetch ? "↻ Re-fetch" : "⚡ Fetch";
  }
}

/* ═══════════════════════════════════════
   TOPBAR
═══════════════════════════════════════ */
function wireTopbar() {
  /* New blank lead */
  document.getElementById("btnAdd").addEventListener("click", () => {
    newCard({});
  });

  /* Template arrow */
  const tplMenu = document.getElementById("tplMenu");
  document.getElementById("btnAddTpl").addEventListener("click", e => {
    e.stopPropagation();
    renderTplMenu();
    tplMenu.classList.toggle("hidden");
  });
  document.addEventListener("click", () => tplMenu.classList.add("hidden"));

  /* View toggle */
  document.getElementById("btnViewBoard").addEventListener("click", () => {
    currentView = "board";
    document.getElementById("btnViewBoard").classList.add("active");
    document.getElementById("btnViewTable").classList.remove("active");
    elBoardWrap.classList.remove("hidden");
    elTableWrap.classList.add("hidden");
    renderBoard();
  });
  document.getElementById("btnViewTable").addEventListener("click", () => {
    currentView = "table";
    document.getElementById("btnViewTable").classList.add("active");
    document.getElementById("btnViewBoard").classList.remove("active");
    elTableWrap.classList.remove("hidden");
    elBoardWrap.classList.add("hidden");
    renderTable();
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
        if (parsed.settings) saveSettings(mergeDeep(sClone(DEFAULT_SETTINGS), parsed.settings));
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
    if (!confirm("Reset everything? All data will be cleared.")) return;
    localStorage.removeItem(CARDS_KEY);
    localStorage.removeItem(SETTINGS_KEY);
    settings = sClone(DEFAULT_SETTINGS);
    cards    = [];
    applyTheme(settings.theme);
    renderAll();
    closeDrawer();
  });

  /* Search */
  elSearch.addEventListener("input", () => {
    searchQuery = elSearch.value;
    if (currentView === "board") renderBoard();
    else renderTable();
  });

  /* Drawer tabs */
  document.getElementById("drawerTabs")?.addEventListener("click", e => {
    const tab = e.target.closest(".drawerTab");
    if (!tab) return;
    activeDrawerTab = tab.dataset.tab;
    document.querySelectorAll(".drawerTab").forEach(t => t.classList.toggle("active", t === tab));
    renderDrawer();
  });

  /* Drawer close / nav */
  document.getElementById("btnCloseDrawer").addEventListener("click", closeDrawer);
  document.getElementById("btnPrevCard").addEventListener("click", () => navigateCard(-1));
  document.getElementById("btnNextCard").addEventListener("click", () => navigateCard(1));

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

  /* Lightbox close */
  document.getElementById("lightboxClose")?.addEventListener("click", () => {
    document.getElementById("lightbox").classList.add("hidden");
  });
  document.getElementById("lightbox")?.addEventListener("click", e => {
    if (e.target === document.getElementById("lightbox")) {
      document.getElementById("lightbox").classList.add("hidden");
    }
  });
}

/* ─── Template menu ─── */
function renderTplMenu() {
  const menu = document.getElementById("tplMenu");
  menu.innerHTML = "";
  menu.innerHTML += `<button class="tplMenuItem" data-tpl="">📋 Blank lead</button>`;
  menu.innerHTML += `<hr class="tplMenuSep" />`;
  for (const tpl of (settings.templates || [])) {
    const btn = document.createElement("button");
    btn.className   = "tplMenuItem";
    btn.textContent = tpl.name;
    btn.addEventListener("click", () => { newCard(tpl.defaults || {}); menu.classList.add("hidden"); });
    menu.appendChild(btn);
  }
}

function newCard(defaults) {
  const firstCol = settings.columns?.[0]?.id || "new";
  const card = {
    id: uid(),
    status:        defaults.status || firstCol,
    customer_name: "",
    phone:"", email:"", postcode:"",
    pax_code:"", schedule_date:"", budget:"", address:"",
    assigned_to: defaults.assigned_to || "",
    deposit:"",
    lead_source: defaults.lead_source || "",
    job_type:    defaults.job_type    || "",
    priority:    defaults.priority    || "normal",
    notes:       defaults.notes       || "",
    ikea_total:  null, item_count:null,
    items_text:"", images:[], items:[],
    last_fetched: null,
    activity:    [],
    custom:      {},
  };
  saveCards([card, ...cards]);
  logActivity(card.id, "created", `Lead created${defaults.job_type ? " from template: " + defaults.job_type : ""}`);
  renderBoard();
  renderStats();
  openDrawer(card.id);
}

/* ═══════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════ */
let settingsDraft  = null;
let activeModalTab = "general";

function openSettings() {
  settingsDraft  = sClone(settings);
  activeModalTab = "general";
  document.querySelectorAll(".modalTab").forEach(t => t.classList.toggle("active", t.dataset.mtab === "general"));
  renderModalTab();
  document.getElementById("settingsModal").classList.remove("hidden");

  document.getElementById("modalTabs").addEventListener("click", e => {
    const tab = e.target.closest(".modalTab");
    if (!tab) return;
    activeModalTab = tab.dataset.mtab;
    document.querySelectorAll(".modalTab").forEach(t => t.classList.toggle("active", t === tab));
    renderModalTab();
  });
}

function closeSettings() {
  applyTheme(settings.theme);
  document.getElementById("settingsModal").classList.add("hidden");
  settingsDraft = null;
}

function renderModalTab() {
  const body = document.getElementById("modalBody");
  if      (activeModalTab === "general")   renderSettingsGeneral(body);
  else if (activeModalTab === "columns")   renderSettingsColumns(body);
  else if (activeModalTab === "fields")    renderSettingsFields(body);
  else if (activeModalTab === "custom")    renderSettingsCustom(body);
  else if (activeModalTab === "templates") renderSettingsTemplates(body);
}

function renderSettingsGeneral(body) {
  body.innerHTML = `
    <div class="settingRow">
      <div><div class="settingLabel">Theme</div><div class="settingHelp">Toggle light / dark mode</div></div>
      <button class="btn" id="toggleTheme">Toggle</button>
    </div>
    <div class="settingRow">
      <div><div class="settingLabel">Auto-open drawer after fetch</div><div class="settingHelp">Open details panel after fetching IKEA items</div></div>
      <label class="switch"><input type="checkbox" id="autoOpenDrawer" ${settingsDraft.autoOpenDrawer ? "checked" : ""}/><span class="slider"></span></label>
    </div>
    <div class="settingRow">
      <div><div class="settingLabel">Currency display</div><div class="settingHelp">Display symbol only — engine returns GBP</div></div>
      <select id="currency">
        <option value="GBP"${settingsDraft.currency==="GBP"?" selected":""}>GBP (£)</option>
        <option value="EUR"${settingsDraft.currency==="EUR"?" selected":""}>EUR (€)</option>
        <option value="USD"${settingsDraft.currency==="USD"?" selected":""}>USD ($)</option>
      </select>
    </div>
  `;
  document.getElementById("toggleTheme").onclick = () => {
    settingsDraft.theme = settingsDraft.theme === "dark" ? "light" : "dark";
    applyTheme(settingsDraft.theme);
  };
  document.getElementById("autoOpenDrawer").onchange = e => { settingsDraft.autoOpenDrawer = e.target.checked; };
  document.getElementById("currency").onchange       = e => { settingsDraft.currency        = e.target.value; };
}

function renderSettingsColumns(body) {
  body.innerHTML = `
    <div class="sectionHead">
      <div class="sectionTitle">Board columns</div>
      <button class="btn mini" id="btnAddColumn">+ Add column</button>
    </div>
    <div class="columnsList" id="columnsList"></div>
  `;
  document.getElementById("btnAddColumn").onclick = () => {
    const id = "col_" + Math.random().toString(16).slice(2,8);
    settingsDraft.columns.push({ id, name:"New column", color:"#2563eb", icon:"🧩" });
    renderColRows();
  };
  renderColRows();
}
function renderColRows() {
  const el = document.getElementById("columnsList");
  el.innerHTML = "";
  settingsDraft.columns.forEach((c, idx) => {
    const cols = settingsDraft.columns;
    const row  = document.createElement("div");
    row.className = "colRow";
    row.innerHTML = `
      <input type="text"  value="${escapeAttr(c.name||"")}" placeholder="Name" />
      <input type="color" value="${escapeAttr(c.color||"#2563eb")}" />
      <button class="iconBtn" title="Up">↑</button>
      <button class="iconBtn" title="Down">↓</button>
      <button class="iconBtn" title="Delete">🗑</button>
    `;
    const [nameEl,colorEl,upBtn,downBtn,delBtn] = row.querySelectorAll("input,button");
    nameEl.addEventListener("input",  () => { c.name  = nameEl.value; });
    colorEl.addEventListener("input", () => { c.color = colorEl.value; });
    upBtn.addEventListener("click",   () => { if(idx>0){[cols[idx-1],cols[idx]]=[cols[idx],cols[idx-1]];renderColRows();} });
    downBtn.addEventListener("click", () => { if(idx<cols.length-1){[cols[idx+1],cols[idx]]=[cols[idx],cols[idx+1]];renderColRows();} });
    delBtn.addEventListener("click",  () => {
      if(cols.length<=1){alert("Need at least 1 column.");return;}
      if(!confirm(`Delete "${c.name}"? Cards move to first column.`))return;
      const [rem]=cols.splice(idx,1);
      saveCards(cards.map(card=>card.status===rem.id?{...card,status:cols[0].id}:card));
      renderColRows();
    });
    el.appendChild(row);
  });
}

function renderSettingsFields(body) {
  body.innerHTML = `
    <div class="sectionHead">
      <div class="sectionTitle">Card & drawer fields</div>
      <div class="sectionHint">Toggle which fields are shown</div>
    </div>
    <div class="fieldToggles" id="fieldToggles"></div>
  `;
  const el = document.getElementById("fieldToggles");
  FIELD_DEFS.forEach(def => {
    const wrap    = document.createElement("div");
    wrap.className = "toggleRow";
    const checked = !!settingsDraft.fields?.[def.key];
    wrap.innerHTML = `
      <div class="toggleText">
        <div class="name">${escapeHtml(def.label)}</div>
        <div class="desc">${escapeHtml(def.desc||"")}</div>
      </div>
      <label class="switch"><input type="checkbox" ${checked?"checked":""}/><span class="slider"></span></label>
    `;
    wrap.querySelector("input").addEventListener("change", e => {
      settingsDraft.fields[def.key] = e.target.checked;
    });
    el.appendChild(wrap);
  });
}

function renderSettingsCustom(body) {
  if (!Array.isArray(settingsDraft.customFields)) settingsDraft.customFields = [];
  body.innerHTML = `
    <div class="sectionHead">
      <div class="sectionTitle">Custom fields</div>
      <div class="sectionHint">Add your own fields to every card</div>
    </div>
    <button class="btn mini primary" id="btnAddCustomField">+ Add field</button>
    <div class="customFieldsList" id="customFieldsList"></div>
  `;
  document.getElementById("btnAddCustomField").onclick = () => {
    settingsDraft.customFields.push({ id:"cf_"+Math.random().toString(16).slice(2,8), label:"New field", type:"text", placeholder:"", cardShow:false });
    renderCustomFieldRows();
  };
  renderCustomFieldRows();
}
function renderCustomFieldRows() {
  const el = document.getElementById("customFieldsList");
  if (!el) return;
  el.innerHTML = "";
  (settingsDraft.customFields || []).forEach((cf, idx) => {
    const row = document.createElement("div");
    row.className = "customFieldRow";
    row.innerHTML = `
      <input type="text" value="${escapeAttr(cf.label)}" placeholder="Field label" />
      <select>
        <option value="text"   ${cf.type==="text"   ?"selected":""}>Text</option>
        <option value="number" ${cf.type==="number" ?"selected":""}>Number</option>
        <option value="date"   ${cf.type==="date"   ?"selected":""}>Date</option>
        <option value="email"  ${cf.type==="email"  ?"selected":""}>Email</option>
      </select>
      <label style="display:flex;align-items:center;gap:4px;font-size:12px;font-weight:700;color:var(--muted)">
        <input type="checkbox" ${cf.cardShow?"checked":""} /> On card
      </label>
      <button class="iconBtn">🗑</button>
    `;
    const [lbl, typeEl, , delBtn] = row.querySelectorAll("input,select,label,button");
    const chk = row.querySelector("input[type=checkbox]");
    lbl.addEventListener("input",    () => { cf.label    = lbl.value; });
    typeEl.addEventListener("change",() => { cf.type     = typeEl.value; });
    chk.addEventListener("change",   () => { cf.cardShow = chk.checked; });
    delBtn.addEventListener("click", () => { settingsDraft.customFields.splice(idx,1); renderCustomFieldRows(); });
    el.appendChild(row);
  });
}

function renderSettingsTemplates(body) {
  if (!Array.isArray(settingsDraft.templates)) settingsDraft.templates = [];
  body.innerHTML = `
    <div class="sectionHead">
      <div class="sectionTitle">Lead templates</div>
      <div class="sectionHint">Pre-fill new leads from a template</div>
    </div>
    <button class="btn mini primary" id="btnAddTemplate">+ Add template</button>
    <div class="templatesList" id="templatesList"></div>
  `;
  document.getElementById("btnAddTemplate").onclick = () => {
    settingsDraft.templates.push({
      id:"tpl_"+Math.random().toString(16).slice(2,8),
      name:"New template", defaults:{ job_type:"", priority:"normal" }
    });
    renderTemplateRows();
  };
  renderTemplateRows();
}
function renderTemplateRows() {
  const el = document.getElementById("templatesList");
  if (!el) return;
  el.innerHTML = "";
  (settingsDraft.templates || []).forEach((tpl, idx) => {
    const row = document.createElement("div");
    row.className = "templateRow";
    row.innerHTML = `
      <div class="templateRowHead">
        <input type="text" value="${escapeAttr(tpl.name)}" placeholder="Template name"
          style="background:transparent;border:none;font-weight:700;font-size:13px;color:var(--text);outline:none;width:100%" />
        <button class="iconBtn">🗑</button>
      </div>
      <div class="templateRowBody">
        <div class="templateField">
          <label>Job type</label>
          <select>
            ${["","Supply & Fit","Fit Only","Design Consult","Measure Only","Other"].map(o =>
              `<option ${(tpl.defaults?.job_type||"")===o?"selected":""}>${o}</option>`
            ).join("")}
          </select>
        </div>
        <div class="templateField">
          <label>Priority</label>
          <select>
            <option value="normal" ${(tpl.defaults?.priority||"")=="normal"?"selected":""}>Normal</option>
            <option value="urgent" ${(tpl.defaults?.priority||"")=="urgent"?"selected":""}>Urgent</option>
            <option value="low"    ${(tpl.defaults?.priority||"")=="low"   ?"selected":""}>Low</option>
          </select>
        </div>
        <div class="templateField">
          <label>Lead source</label>
          <input type="text" value="${escapeAttr(tpl.defaults?.lead_source||"")}" placeholder="Google, Referral…" />
        </div>
        <div class="templateField">
          <label>Assigned to</label>
          <input type="text" value="${escapeAttr(tpl.defaults?.assigned_to||"")}" placeholder="Team member" />
        </div>
      </div>
    `;
    const nameEl    = row.querySelector(".templateRowHead input");
    const [jtEl, prEl, srcEl, assEl] = row.querySelectorAll(".templateRowBody select, .templateRowBody input");
    const delBtn    = row.querySelector(".templateRowHead .iconBtn");
    nameEl.addEventListener("input",  () => { tpl.name = nameEl.value; });
    jtEl.addEventListener("change",   () => { if(!tpl.defaults)tpl.defaults={}; tpl.defaults.job_type    = jtEl.value; });
    prEl.addEventListener("change",   () => { if(!tpl.defaults)tpl.defaults={}; tpl.defaults.priority    = prEl.value; });
    srcEl.addEventListener("input",   () => { if(!tpl.defaults)tpl.defaults={}; tpl.defaults.lead_source = srcEl.value; });
    assEl.addEventListener("input",   () => { if(!tpl.defaults)tpl.defaults={}; tpl.defaults.assigned_to = assEl.value; });
    delBtn.addEventListener("click",  () => { settingsDraft.templates.splice(idx,1); renderTemplateRows(); });
    el.appendChild(row);
  });
}

/* ═══════════════════════════════════════
   UTILS
═══════════════════════════════════════ */
function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" });
  const a    = Object.assign(document.createElement("a"), { href:URL.createObjectURL(blob), download:filename });
  a.click(); URL.revokeObjectURL(a.href);
}
