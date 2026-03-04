/**
 * PAX Scraper — Production Service
 * 
 * Strategy:
 * 1. Playwright loads the planner with designCode → intercepts the item API URL
 * 2. We extract all SPR item IDs from that URL
 * 3. We call the item details API directly (no browser needed for this part)
 * 4. We parse names, prices, dimensions, and child components
 * 5. Return clean JSON ready for Airtable / your job card
 * 
 * Run standalone:  node pax-scraper.js VSQWPG
 * Run as server:   node pax-scraper.js --server
 */

const { chromium } = require('playwright');
const http         = require('http');

const COUNTRY  = 'gb';
const LANGUAGE = 'en';
const LOCALE   = 'en-GB';
const TIMEOUT  = 45000;
const PLANNER  = `https://www.ikea.com/addon-app/storageone/pax/web/latest/${COUNTRY}/${LANGUAGE}/`;
const ITEM_API = `https://api.dexf.ikea.com/webplanner/v1/query/items/retailunit/${COUNTRY.toUpperCase()}/locale/${LOCALE}`;

// Step 1: Use Playwright to get the item IDs for this design
async function getItemIdsForDesign(code) {
  console.log(`[pax] Loading design ${code} in browser...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  let itemIds = null;

  page.on('response', async (response) => {
    const url = response.url();
    const ct  = response.headers()['content-type'] || '';
    if (url.includes('webplanner/v1/query/items') && ct.includes('application/json')) {
      const match = url.match(/filter\.itemId=([^&]+)/);
      if (match) {
        itemIds = match[1].split(',');
        console.log(`[pax] Found ${itemIds.length} item IDs in design`);
      }
    }
  });

  try {
    await page.goto(`${PLANNER}?designCode=${code}`, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT,
    });
    await page.waitForTimeout(5000);
  } finally {
    await browser.close();
  }

  if (!itemIds) throw new Error(`No items found for design code: ${code}. Check the code is valid.`);
  return itemIds;
}

// Step 2: Fetch item details directly from IKEA API (no browser needed)
async function getItemDetails(itemIds) {
  console.log(`[pax] Fetching details for ${itemIds.length} items...`);

  const fields = [
    'child', 'customerBenefit', 'filterAttribute', 'goodToKnow',
    'image', 'measure', 'measureReference', 'priceInformation',
    'priceUnit', 'retailTag', 'technicalInformation', 'validDesignPart'
  ].join(',');

  const url = `${ITEM_API}?filter.itemId=${itemIds.join(',')}&fields=${fields}`;

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Origin': 'https://www.ikea.com',
      'Referer': PLANNER,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  });

  if (!res.ok) throw new Error(`Item API returned ${res.status}`);
  const data = await res.json();
  return data.data || [];
}

// Step 3: Parse into clean job-card format
function parseItems(rawItems) {
  const items = [];
  let total   = 0;

  for (const item of rawItems) {
    const c = item.content;
    if (!c) continue;

    const priceObj = c.priceInformation?.salesPrice?.find(
      p => p.typeCode === 'RegularSalesUnitPrice' && p.currencyCode === 'GBP'
    );
    const price = priceObj?.priceInclTax || 0;
    const dims  = c.measureReference?.textMetric || '';
    const sku   = c.ruItemNo || c.itemNoGlobal || item.itemId.replace('SPR-', '');

    // Format as IKEA article number (XXX.XXX.XX)
    const skuFormatted = sku.length === 8
      ? `${sku.slice(0,3)}.${sku.slice(3,6)}.${sku.slice(6)}`
      : sku;

    const parsed = {
      sku:        skuFormatted,
      name:       c.name || 'Unknown item',
      qty:        1,
      unit_price: price,
      line_total: price,
      dimensions: dims,
    };

    items.push(parsed);
    total += parsed.line_total;
  }

  return { items, total };
}

// Main scrape function
async function scrape(code) {
  const start = Date.now();
  try {
    const itemIds  = await getItemIdsForDesign(code);
    const rawItems = await getItemDetails(itemIds);
    const { items, total } = parseItems(rawItems);

    const result = {
      ok:          true,
      design_code: code,
      currency:    'GBP',
      total:       Math.round(total * 100) / 100,
      item_count:  items.length,
      items,
      duration_ms: Date.now() - start,
    };

    console.log(`[pax] Done in ${result.duration_ms}ms — ${items.length} items — £${result.total}`);
    return result;

  } catch (err) {
    console.error(`[pax] Error:`, err.message);
    return {
      ok:          false,
      error:       err.message,
      design_code: code,
    };
  }
}

// HTTP Server mode
function startServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (req.url === '/health') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, service: 'pax-scraper' }));
      return;
    }

    if (req.method === 'POST' && req.url === '/scrape') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { pax_code } = JSON.parse(body);
          if (!pax_code) {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'pax_code required' }));
            return;
          }
          const result = await scrape(pax_code.trim().toUpperCase());
          res.writeHead(result.ok ? 200 : 500);
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'Not found. Use POST /scrape' }));
  });

  server.listen(port, () => {
    console.log(`\n[pax-scraper] Running on port ${port}`);
    console.log(`[pax-scraper] POST /scrape  body: { "pax_code": "VSQWPG" }`);
    console.log(`[pax-scraper] GET  /health\n`);
  });
}

// Entry point
if (process.argv[2] === '--server') {
  startServer(process.env.PORT || 3000);
} else {
  const code = (process.argv[2] || 'VSQWPG').toUpperCase();
  scrape(code).then(result => {
    console.log('\n' + JSON.stringify(result, null, 2));
  });
}
