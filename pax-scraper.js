/**
 * PAX Scraper — Final Production Version
 * Includes: names, prices, dimensions, images
 * 
 * Run standalone:  node pax-scraper.js VSQWPG
 * Run as server:   node pax-scraper.js --server
 */

const { chromium } = require('playwright');
const http         = require('http');

const COUNTRY  = 'gb';
const LANGUAGE = 'en';
const TIMEOUT  = 50000;
const PLANNER  = `https://www.ikea.com/addon-app/storageone/pax/web/latest/${COUNTRY}/${LANGUAGE}/`;

async function scrape(code) {
  const start = Date.now();
  console.log(`[pax] Scraping design: ${code}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  let capturedItems = null;

  page.on('response', async (response) => {
    const url = response.url();
    const ct  = response.headers()['content-type'] || '';
    if (url.includes('webplanner/v1/query/items') && ct.includes('application/json')) {
      try {
        const body = await response.json();
        if (body.data && body.data.length > 0) {
          console.log(`[pax] Captured ${body.data.length} items from API`);
          capturedItems = body.data;
        }
      } catch (e) {
        console.log(`[pax] Parse error: ${e.message}`);
      }
    }
  });

  try {
    await page.goto(`${PLANNER}?designCode=${code}`, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT,
    });
    await page.waitForTimeout(6000);
  } catch (err) {
    await browser.close();
    return { ok: false, error: `Browser error: ${err.message}`, design_code: code };
  } finally {
    await browser.close();
  }

  if (!capturedItems) {
    return {
      ok: false,
      error: `No items found for "${code}". Code may be expired or invalid.`,
      design_code: code,
    };
  }

  // Parse items
  const items = [];
  let total   = 0;

  for (const item of capturedItems) {
    const c = item.content;
    if (!c) continue;

    // Price
    const priceObj = c.priceInformation?.salesPrice?.find(
      p => p.typeCode === 'RegularSalesUnitPrice' && p.currencyCode === 'GBP'
    );
    const price = priceObj?.priceInclTax || 0;

    // SKU formatted as 394.993.19
    const sku = c.ruItemNo || c.itemNoGlobal || item.itemId?.replace(/^SPR-/, '') || '';
    const skuFormatted = sku.length === 8
      ? `${sku.slice(0,3)}.${sku.slice(3,6)}.${sku.slice(6)}`
      : sku;

    // Images — get the best available size (S5 = largest, S1 = smallest)
    const images = c.image || [];
    const getImage = (size) => images.find(i => i.size === size && i.typeName === 'Main Product Picture')?.url;
    const image_url       = getImage('S5') || getImage('S4') || getImage('S3') || images[0]?.url || null;
    const image_thumb_url = getImage('S1') || getImage('S2') || images[0]?.url || null;

    // IKEA product page URL
    const product_url = `https://www.ikea.com/gb/en/p/-${sku.toLowerCase()}/`;

    const parsed = {
      sku:            skuFormatted,
      name:           c.name || 'Unknown',
      qty:            1,
      unit_price:     price,
      line_total:     price,
      dimensions:     c.measureReference?.textMetric || '',
      image_url,        // Full size image  (~800px) - use in Airtable attachment
      image_thumb_url,  // Thumbnail (~100px) - use for previews
      product_url,      // Link to IKEA product page
    };

    items.push(parsed);
    total += price;
  }

  // Human readable summary for Airtable "IKEA Items" text field
  const itemsText = [
    `📦 PAX Design: ${code}`,
    `🛒 ${items.length} items  |  Total: £${Math.round(total * 100) / 100}`,
    `─────────────────────────────`,
    ...items.map((item, i) =>
      `${i + 1}. ${item.name}\n   SKU: ${item.sku}  |  £${item.unit_price}  |  ${item.dimensions}`
    ),
    `─────────────────────────────`,
    `💰 TOTAL: £${Math.round(total * 100) / 100}`,
  ].join('\n');

  // Image array for Airtable attachment field
  // Airtable accepts: [{ url: "https://..." }, ...]
  const images = items
    .filter(i => i.image_url)
    .map(i => ({ url: i.image_url, filename: `${i.name.replace(/\//g, '-')}.jpg` }));

  const result = {
    ok:           true,
    design_code:  code,
    currency:     'GBP',
    total:        Math.round(total * 100) / 100,
    item_count:   items.length,
    items,
    items_text:   itemsText,   // ← clean text for Airtable long text field
    images,                    // ← array of {url, filename} for Airtable attachment field
    duration_ms:  Date.now() - start,
  };

  console.log(`[pax] ✅ Done — ${items.length} items — £${result.total} — ${result.duration_ms}ms`);
  return result;
}

// HTTP Server
function startServer(port = 3000) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    if (req.url === '/health' && req.method === 'GET') {
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true, service: 'pax-scraper', version: '5.0' }));
      return;
    }

    if (req.url === '/scrape' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        try {
          const { pax_code } = JSON.parse(body);
          if (!pax_code || typeof pax_code !== 'string') {
            res.writeHead(400);
            res.end(JSON.stringify({ ok: false, error: 'pax_code (string) required' }));
            return;
          }
          const result = await scrape(pax_code.trim().toUpperCase());
          res.writeHead(result.ok ? 200 : 422);
          res.end(JSON.stringify(result));
        } catch (e) {
          res.writeHead(400);
          res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ ok: false, error: 'POST /scrape  { "pax_code": "VSQWPG" }' }));
  });

  server.listen(port, () => {
    console.log(`\n✅ pax-scraper v4 running on port ${port}`);
    console.log(`   POST /scrape  { "pax_code": "VSQWPG" }`);
    console.log(`   GET  /health\n`);
  });
}

// Entry point
if (process.argv[2] === '--server') {
  startServer(process.env.PORT || 3000);
} else {
  const code = (process.argv[2] || 'VSQWPG').toUpperCase();
  scrape(code).then(result => console.log('\n' + JSON.stringify(result, null, 2)));
}
