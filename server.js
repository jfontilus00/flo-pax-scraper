const express = require("express");
const { chromium } = require("playwright");

const app = express();
app.use(express.json({ limit: "2mb" }));

//
// IKEA endpoints (GB / en-GB)
//
const VPC_BASE =
  "https://api.dexf.ikea.com/vpc/v1/configurations/retailunit/GB/locale/en-GB";

const WEBPLANNER_BASE =
  "https://api.dexf.ikea.com/webplanner/v1/query/items/retailunit/GB/locale/en-GB";

const PAX_PLANNER_URL =
  "https://www.ikea.com/addon-app/storageone/pax/web/latest/gb/en/#/u/";

// Keep browser-like headers
const HEADERS = {
  "Accept-Language": "en-GB,en;q=0.9",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Origin: "https://www.ikea.com",
  Referer: "https://www.ikea.com/",
};

//
// Helpers
//
function formatSku(itemNo) {
  const s = String(itemNo || "").replace(/\D/g, "");
  if (s.length === 8) return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 8)}`;
  return s;
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function pickImageUrl(content) {
  const imgs = content?.image || [];
  return (
    imgs.find((i) => i.size === "S3" && i.typeName === "Main Product Picture")?.url ||
    imgs[0]?.url ||
    ""
  );
}

function deriveProductType(baseName) {
  const s = String(baseName || "").trim();
  if (!s) return "";
  // Take left side of " / " (e.g. "PAX / HASVIK" -> "PAX")
  return s.split(" / ")[0].split(",")[0].trim();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(condFn, timeoutMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = condFn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

//
// Single shared browser (faster). New incognito context per request.
//
let _browserPromise = null;
async function getBrowser() {
  if (!_browserPromise) {
    const headless = process.env.HEADLESS === "0" ? false : true;
    _browserPromise = chromium.launch({
      headless,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-sandbox",
      ],
    });
  }
  return _browserPromise;
}

process.on("SIGINT", async () => {
  try {
    const b = await _browserPromise;
    if (b) await b.close();
  } catch {}
  process.exit(0);
});

//
// CAPTURE via route.fetch() (avoids inspector cache evicted issue)
// Also ABORT heavy assets to keep memory/caches stable.
//
function shouldAbort(url, resourceType) {
  const u = url.toLowerCase();

  // Abort big assets (PAX planner pulls a *lot* of GLB + props)
  if (
    u.endsWith(".glb") ||
    u.endsWith(".gltf") ||
    u.endsWith(".bin") ||
    u.endsWith(".env") ||
    u.endsWith(".wasm") ||
    u.includes("/assets/") ||
    u.includes("/pax-gltf") ||
    u.includes("/propping/")
  ) return true;

  // Abort generic heavy types
  if (resourceType === "image" || resourceType === "media" || resourceType === "font")
    return true;

  return false;
}

async function capturePlannerData(designCode) {
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: HEADERS["User-Agent"],
    extraHTTPHeaders: {
      "Accept-Language": HEADERS["Accept-Language"],
      Origin: HEADERS.Origin,
      Referer: HEADERS.Referer,
    },
  });

  const page = await context.newPage();

  const vpcUrl = `${VPC_BASE}/${designCode}`;

  // We capture the *exact* responses we need.
  let vpcCapture = null; // { url, status, body(Buffer) }
  let webCapture = null; // { url, status, body(Buffer) }

  await page.route("**/*", async (route, request) => {
    const url = request.url();
    const rt = request.resourceType();

    if (shouldAbort(url, rt)) {
      return route.abort();
    }

    // Capture the VPC response for this specific designCode
    if (url.startsWith(vpcUrl)) {
      const resp = await route.fetch();
      const status = resp.status();
      const headers = resp.headers();
      const body = await resp.body(); // captured NOW (no eviction)
      vpcCapture = { url, status, body };
      return route.fulfill({ status, headers, body });
    }

    // Capture the Webplanner catalog response the planner page itself loads
    if (
      url.startsWith(WEBPLANNER_BASE) &&
      url.includes("filter.appId=storageonepax") &&
      !webCapture
    ) {
      const resp = await route.fetch();
      const status = resp.status();
      const headers = resp.headers();
      const body = await resp.body();
      webCapture = { url, status, body };
      return route.fulfill({ status, headers, body });
    }

    return route.continue();
  });

  console.log(`[planner] Loading design: ${designCode}`);
  await page.goto(`${PAX_PLANNER_URL}${designCode}`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  // Wait for VPC to be captured
  const vpc = await waitFor(() => vpcCapture, 60000, "VPC capture");
  if (vpc.status !== 200) {
    await context.close();
    throw new Error(`VPC blocked in planner context (status ${vpc.status})`);
  }

  let vpcJson;
  try {
    vpcJson = JSON.parse(vpc.body.toString("utf8"));
  } catch {
    await context.close();
    throw new Error("Failed to parse VPC JSON");
  }

  const artItems = vpcJson?.itemList?.item || [];
  if (!artItems.length) {
    await context.close();
    throw new Error("VPC returned no items (design invalid or blocked)");
  }

  // Wait (a bit) for Webplanner capture.
  let web = null;
  try {
    web = await waitFor(() => webCapture, 60000, "Webplanner capture");
  } catch {
    web = null;
  }

  let webplannerData = [];
  let webplannerStatus = null;
  let webplannerUrl = null;

  if (web) {
    webplannerStatus = web.status;
    webplannerUrl = web.url;

    if (web.status !== 200) {
      await context.close();
      throw new Error(`Webplanner blocked in planner context (status ${web.status})`);
    }

    try {
      const webJson = JSON.parse(web.body.toString("utf8"));
      webplannerData = webJson?.data || [];
    } catch {
      webplannerData = [];
    }
  }

  await context.close();

  return {
    artItems,
    webplannerData,
    debug: {
      vpcUrl: vpc.url,
      webplannerUrl,
      webplannerStatus,
      webplannerCount: Array.isArray(webplannerData) ? webplannerData.length : 0,
    },
  };
}

//
// Build output: ALWAYS filter webplanner catalog by VPC ART list
//
function buildItems(artItems, webplannerData) {
  const qtyMap = new Map();
  for (const a of artItems) qtyMap.set(String(a.itemNo), Number(a.quantity) || 1);

  const byItemId = new Map();
  for (const e of webplannerData || []) {
    if (!e || !e.itemId) continue;
    byItemId.set(String(e.itemId), e);
  }

  const items = [];

  for (const a of artItems) {
    const itemNo = String(a.itemNo);
    const qty = qtyMap.get(itemNo) || 1;

    const entry = byItemId.get(`ART-${itemNo}`);
    const content = entry?.content;

    const baseName = content?.name || `ART-${itemNo}`;
    const product_type = deriveProductType(baseName);

    const price =
      content?.priceInformation?.salesPrice?.[0]?.priceInclTax || 0;

    const dimensions = content?.measureReference?.textMetric || "";
    const displayName = dimensions ? `${baseName}, ${dimensions}` : baseName;

    items.push({
      itemNo,                 // <- NEW
      product_type,           // <- NEW
      sku: formatSku(itemNo),
      name: displayName,
      qty,
      unit_price: round2(price),
      line_total: round2(price * qty),
      image_url: content ? pickImageUrl(content) : "",
      missing_in_webplanner: !content || !entry?.valid,
    });
  }

  return items;
}

function buildItemsText(items, total) {
  const lines = [];
  lines.push(`🛒 ${items.length} items`);
  lines.push("─────────────────────────────");
  items.forEach((i, idx) => {
    lines.push(
      `${idx + 1}. ${i.name}\n` +
      `   Type: ${i.product_type || "-"} | SKU: ${i.sku} | Qty: ${i.qty} | Unit: £${i.unit_price} | Line: £${i.line_total}`
    );
  });
  lines.push("─────────────────────────────");
  lines.push(`💰 TOTAL: £${total}`);
  return lines.join("\n");
}

function buildImages(items) {
  // Airtable Attachment-compatible array:
  // [ { url: "...", filename: "..." }, ... ]
  return items
    .filter((i) => i.image_url)
    .map((i) => {
      const safeType = (i.product_type || "ITEM").replace(/[^\w.-]+/g, "_");
      const safeSku = String(i.sku || "").replace(/[^\w.-]+/g, "_");
      return {
        url: i.image_url,
        filename: `${safeType}-${safeSku}.jpg`,
      };
    });
}

//
// API
//
app.post("/scrape", async (req, res) => {
  const pax_code = (req.body.pax_code || "").trim().toUpperCase();
  if (!pax_code) return res.status(400).json({ error: "Missing pax_code" });

  console.log(`\n[scrape] START ${pax_code}`);

  try {
    const { artItems, webplannerData, debug } = await capturePlannerData(pax_code);

    console.log(`[vpc] ${pax_code} -> ${artItems.length} ART items`);
    console.log(
      `[webplanner] status=${debug.webplannerStatus} count=${debug.webplannerCount}`
    );

    const items = buildItems(artItems, webplannerData);
    const total = round2(items.reduce((s, i) => s + (i.line_total || 0), 0));
    const missing = items.filter((i) => i.missing_in_webplanner).length;

    const items_text = buildItemsText(items, total);   // <- NEW
    const images = buildImages(items);                 // <- NEW

    return res.json({
      design_code: pax_code,
      currency: "GBP",
      total,
      item_count: items.length,
      missing_prices: missing,
      items_text,   // <- NEW (easy mapping to Airtable long text)
      images,       // <- NEW (easy mapping to Airtable attachment field)
      items,
      source: "planner-route-capture(vpc+webplanner)",
      debug,
    });
  } catch (e) {
    console.error("[scrape] Error:", e.message);
    return res.status(500).json({ error: e.message, design_code: pax_code });
  }
});

app.get("/health", (_, res) => {
  res.json({ ok: true, version: "v12-routefetch-port-items_text-images" });
});

// IMPORTANT: Railway uses a dynamic port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[server] PAX scraper listening on :${PORT}`);
});
