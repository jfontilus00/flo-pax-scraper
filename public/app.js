const STORAGE_KEY = "pax_crm_cards_v2";
const SETTINGS_KEY = "pax_crm_settings_v1";

const STATUS = [
  { key: "new", label: "🆕 New", dot: "var(--new)" },
  { key: "quoted", label: "🧾 Quoted", dot: "var(--quoted)" },
  { key: "scheduled", label: "📅 Scheduled", dot: "var(--scheduled)" },
  { key: "won", label: " Won", dot: "var(--won)" },
];

const $ = (id) => document.getElementById(id);

function uid() {
  return "c_" + Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function fmtDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function money(symbol, n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "";
  return `${symbol}${v.toFixed(0)}`;
}

function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 2200);
}

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

const state = {
  cards: [],
  selectedId: null,
  q: "",
  settings: {
    theme: "dark",
    currency: "GBP",
    autoOpen: true,
  },
};

function currencySymbol(code) {
  if (code === "EUR") return "€";
  if (code === "USD") return "$";
  return "£";
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  state.settings.theme = theme;
}

function saveAll() {
  saveJSON(STORAGE_KEY, state.cards);
  saveJSON(SETTINGS_KEY, state.settings);
}

function ensureDefaults() {
  state.cards = loadJSON(STORAGE_KEY, []);
  if (!Array.isArray(state.cards)) state.cards = [];

  const s = loadJSON(SETTINGS_KEY, state.settings);
  state.settings = { ...state.settings, ...(s || {}) };

  setTheme(state.settings.theme || "dark");
  $("optAutoOpen").checked = !!state.settings.autoOpen;
  $("optCurrency").value = state.settings.currency || "GBP";
}

function statusMeta(key) {
  return STATUS.find((s) => s.key === key) || STATUS[0];
}

function filteredCards() {
  const q = (state.q || "").trim().toLowerCase();
  if (!q) return state.cards;

  return state.cards.filter((c) => {
    const hay = [
      c.customer_name,
      c.phone,
      c.postcode,
      c.pax_code,
      c.items_text,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}

function groupByStatus(cards) {
  const map = new Map(STATUS.map((s) => [s.key, []]));
  for (const c of cards) {
    const k = map.has(c.status) ? c.status : "new";
    map.get(k).push(c);
  }
  return map;
}

function makeColumns(boardEl) {
  boardEl.innerHTML = "";
  const cols = {};

  for (const s of STATUS) {
    const col = document.createElement("section");
    col.className = "column";
    col.dataset.status = s.key;

    col.innerHTML = `
      <div class="colHead">
        <div class="left">
          <div class="badgeDot" style="background:${s.dot}"></div>
          <div>${s.label}</div>
        </div>
        <div class="count">0</div>
      </div>
      <div class="colBody" data-drop="${s.key}"></div>
    `;

    boardEl.appendChild(col);
    cols[s.key] = col;
  }

  return cols;
}

function openDrawer(cardId) {
  state.selectedId = cardId;
  const drawer = $("drawer");
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  renderDrawer();
}

function closeDrawer() {
  state.selectedId = null;
  const drawer = $("drawer");
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
}

function patchCard(id, patch) {
  const idx = state.cards.findIndex((c) => c.id === id);
  if (idx < 0) return;
  state.cards[idx] = { ...state.cards[idx], ...patch };
  saveAll();
  renderBoard();   // keeps UI consistent
  renderDrawer();  // refresh drawer if open
}

function deleteCard(id) {
  state.cards = state.cards.filter((c) => c.id !== id);
  saveAll();
  if (state.selectedId === id) closeDrawer();
  renderBoard();
}

function renderBoard() {
  const board = $("board");
  const tpl = $("cardTpl");
  const cols = makeColumns(board);
  const grouped = groupByStatus(filteredCards());

  for (const s of STATUS) {
    const col = cols[s.key];
    const body = col.querySelector(".colBody");
    const list = grouped.get(s.key) || [];
    col.querySelector(".count").textContent = String(list.length);

    // Drop handling
    body.addEventListener("dragover", (e) => {
      e.preventDefault();
    });
    body.addEventListener("drop", (e) => {
      e.preventDefault();
      const id = e.dataTransfer.getData("text/plain");
      if (!id) return;
      patchCard(id, { status: s.key });
      toast(`Moved to ${statusMeta(s.key).label}`);
    });

    for (const card of list) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.dataset.id = card.id;

      const meta = statusMeta(card.status);

      node.querySelector(".customer").textContent = card.customer_name || "Untitled lead";
      node.querySelector(".pax").textContent = card.pax_code ? `PAX: ${card.pax_code}` : "PAX: ";
      node.querySelector(".postcode").textContent = card.postcode || "Postcode ";

      const pill = node.querySelector(".status");
      pill.textContent = meta.label;
      pill.classList.add(meta.key);

      const sym = currencySymbol(state.settings.currency);
      node.querySelector(".total").textContent = money(sym, card.ikea_total);
      node.querySelector(".count").textContent = Number.isFinite(Number(card.item_count)) ? String(card.item_count) : "";
      node.querySelector(".fetched").textContent = card.last_fetched ? fmtDate(card.last_fetched) : "";

      // Card click opens drawer
      node.addEventListener("click", () => openDrawer(card.id));

      // Drag
      node.addEventListener("dragstart", (e) => {
        node.classList.add("dragging");
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      });
      node.addEventListener("dragend", () => node.classList.remove("dragging"));

      body.appendChild(node);
    }
  }
}

function renderDrawer() {
  const id = state.selectedId;
  const has = !!id;
  const card = has ? state.cards.find((c) => c.id === id) : null;

  if (!card) return;

  const sym = currencySymbol(state.settings.currency);

  $("drawerCustomer").textContent = card.customer_name || "Untitled lead";
  $("drawerMeta").textContent =
    `${statusMeta(card.status).label}  ` +
    `${card.pax_code ? "PAX " + card.pax_code : "No PAX code"}  ` +
    `Updated ${card.last_fetched ? fmtDate(card.last_fetched) : ""}`;

  // Fields
  $("fCustomer").value = card.customer_name || "";
  $("fPhone").value = card.phone || "";
  $("fPostcode").value = card.postcode || "";
  $("fPax").value = (card.pax_code || "").toUpperCase();
  $("fSchedule").value = card.schedule_date || "";

  // Status select
  $("fStatus").innerHTML = STATUS.map((s) => `<option value="${s.key}">${s.label}</option>`).join("");
  $("fStatus").value = card.status || "new";

  // Metrics
  $("mTotal").textContent = money(sym, card.ikea_total);
  $("mCount").textContent = Number.isFinite(Number(card.item_count)) ? String(card.item_count) : "";
  $("mFetched").textContent = card.last_fetched ? fmtDate(card.last_fetched) : "";

  // Details
  $("itemsText").textContent = card.items_text || "";
  const imagesEl = $("images");
  imagesEl.innerHTML = "";
  (card.images || []).slice(0, 36).forEach((img) => {
    const im = document.createElement("img");
    im.src = img.url;
    im.alt = img.filename || "image";
    im.title = img.filename || img.url;
    imagesEl.appendChild(im);
  });
}

function wireDrawer() {
  $("btnCloseDrawer").addEventListener("click", closeDrawer);

  $("fCustomer").addEventListener("input", () => patchCard(state.selectedId, { customer_name: $("fCustomer").value }));
  $("fPhone").addEventListener("input", () => patchCard(state.selectedId, { phone: $("fPhone").value }));
  $("fPostcode").addEventListener("input", () => patchCard(state.selectedId, { postcode: $("fPostcode").value }));
  $("fPax").addEventListener("input", () => patchCard(state.selectedId, { pax_code: $("fPax").value.trim().toUpperCase() }));
  $("fSchedule").addEventListener("change", () => patchCard(state.selectedId, { schedule_date: $("fSchedule").value }));
  $("fStatus").addEventListener("change", () => patchCard(state.selectedId, { status: $("fStatus").value }));

  $("btnToggleDetails").addEventListener("click", () => {
    const el = $("details");
    el.classList.toggle("hidden");
    $("btnToggleDetails").textContent = el.classList.contains("hidden") ? "Show items" : "Hide items";
  });

  $("btnDelete").addEventListener("click", () => {
    const id = state.selectedId;
    if (!id) return;
    const ok = confirm("Delete this lead?");
    if (!ok) return;
    deleteCard(id);
  });

  $("btnFetch").addEventListener("click", async () => {
    const id = state.selectedId;
    if (!id) return;

    const card = state.cards.find((c) => c.id === id);
    const pax = (card?.pax_code || "").trim().toUpperCase();
    const err = $("drawerError");

    err.classList.add("hidden");
    err.textContent = "";

    if (!pax) {
      err.textContent = "Missing PAX code.";
      err.classList.remove("hidden");
      return;
    }

    $("btnFetch").disabled = true;
    $("btnFetch").textContent = "Fetching";
    try {
      const data = await fetchPax(pax);

      patchCard(id, {
        pax_code: pax,
        ikea_total: data.total,
        item_count: data.item_count,
        items_text: data.items_text || "",
        images: data.images || [],
        last_fetched: Date.now(),
      });

      // open details
      if (state.settings.autoOpen) {
        $("details").classList.remove("hidden");
        $("btnToggleDetails").textContent = "Hide items";
      }

      toast("Fetched items ");
    } catch (e) {
      err.textContent = String(e?.message || e);
      err.classList.remove("hidden");
    } finally {
      $("btnFetch").disabled = false;
      $("btnFetch").textContent = "Fetch items";
    }
  });
}

function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function wireTopbar() {
  $("btnAdd").addEventListener("click", () => {
    const id = uid();
    state.cards.unshift({
      id,
      status: "new",
      customer_name: "",
      phone: "",
      postcode: "",
      pax_code: "",
      schedule_date: "",
      ikea_total: null,
      item_count: null,
      items_text: "",
      images: [],
      last_fetched: null,
    });
    saveAll();
    renderBoard();
    openDrawer(id);
    toast("New lead created");
  });

  $("btnExport").addEventListener("click", () => {
    downloadJson("pax-crm-export.json", state.cards);
  });

  $("fileImport").addEventListener("change", async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error("Expected array");
      state.cards = parsed.map((c) => ({ ...c, id: c.id || uid() }));
      saveAll();
      renderBoard();
      toast("Imported ");
    } catch {
      toast("Import failed");
    } finally {
      e.target.value = "";
    }
  });

  $("btnReset").addEventListener("click", () => {
    const ok = confirm("Reset all leads? (clears localStorage)");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    state.cards = [];
    closeDrawer();
    renderBoard();
    toast("Reset done");
  });

  $("q").addEventListener("input", () => {
    state.q = $("q").value;
    renderBoard();
  });

  $("btnClearSearch").addEventListener("click", () => {
    $("q").value = "";
    state.q = "";
    renderBoard();
  });

  // Settings
  const dlg = $("settingsDlg");
  $("btnSettings").addEventListener("click", () => dlg.showModal());
  $("btnCloseSettings").addEventListener("click", () => dlg.close());

  $("btnTheme").addEventListener("click", () => {
    const next = state.settings.theme === "dark" ? "light" : "dark";
    setTheme(next);
  });

  $("btnSaveSettings").addEventListener("click", () => {
    state.settings.autoOpen = $("optAutoOpen").checked;
    state.settings.currency = $("optCurrency").value;
    saveAll();
    renderBoard();
    renderDrawer();
    dlg.close();
    toast("Settings saved");
  });
}

function init() {
  ensureDefaults();
  wireTopbar();
  wireDrawer();
  renderBoard();

  // If there is exactly 1 card, auto-select it for convenience
  if (state.cards.length === 1) openDrawer(state.cards[0].id);

  // ESC closes drawer (nice workflow)
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}

init();
