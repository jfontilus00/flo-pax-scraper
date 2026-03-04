/**
 * IKEA PAX - Targeted Network Interceptor v2
 * 
 * We know the item detail API works. Now we need to catch:
 * 1. The design LOAD call (gives us item IDs + quantities)
 * 2. The item DETAIL call (gives us names + prices) ← already working
 * 
 * Run: node pax-scraper-v2.js VSQWPG
 */

const { chromium } = require('playwright');

const PAX_CODE = process.argv[2] || 'VSQWPG';
const COUNTRY  = 'gb';
const LANGUAGE = 'en';
const TIMEOUT  = 45000;

const PLANNER_URL = `https://www.ikea.com/addon-app/storageone/pax/web/latest/${COUNTRY}/${LANGUAGE}/`;

async function fetchPaxDesign(code) {
  console.log(`\n🔍 PAX Scraper v2 — Code: ${code}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });
  const page = await context.newPage();

  // Store all captured data here
  let designData   = null;  // the design load response (quantities)
  let itemsData    = null;  // the item detail response (names + prices)

  // ── Intercept responses ──────────────────────────────────────────────────
  page.on('response', async (response) => {
    const url    = response.url();
    const status = response.status();
    const ct     = (response.headers()['content-type'] || '');

    if (!ct.includes('application/json') || status >= 400) return;

    // TARGET 1: Design load endpoint (save service)
    // This returns the design structure including item IDs + quantities
    if (url.includes('dexf.ikea.com/save') ||
        url.includes('dexf.ikea.com/webplanner/v1/design') ||
        url.includes('/designs/') ||
        url.includes('/vpc/') ||
        (url.includes('dexf.ikea.com') && url.toLowerCase().includes(code.toLowerCase()))) {
      try {
        const body = await response.json();
        console.log(`✅ DESIGN LOAD: ${url}`);
        console.log(JSON.stringify(body, null, 2));
        designData = { url, body };
      } catch (_) {}
    }

    // TARGET 2: Item details endpoint (already confirmed working)
    // Returns names, prices, dimensions
    if (url.includes('dexf.ikea.com/webplanner/v1/query/items')) {
      try {
        const body = await response.json();
        console.log(`\n✅ ITEM DETAILS API captured — ${body.data?.length || 0} items`);
        itemsData = { url, body };

        // Extract the SPR IDs from the URL so we know what was requested
        const match = url.match(/filter\.itemId=([^&]+)/);
        if (match) {
          const ids = match[1].split(',');
          console.log(`   Items in design (${ids.length}): ${ids.join(', ')}`);
        }
      } catch (_) {}
    }

    // TARGET 3: Catch ALL other dexf calls we haven't seen yet
    if (url.includes('dexf.ikea.com') && 
        !url.includes('setting/v1') && 
        !url.includes('webplanner/v1/query/items') &&
        !url.includes('translations')) {
      try {
        const body = await response.json();
        console.log(`\n📡 OTHER DEXF CALL: ${url}`);
        console.log(JSON.stringify(body, null, 2).substring(0, 500) + '...');
      } catch (_) {}
    }
  });

  try {
    // Load planner with design code in URL
    await page.goto(`${PLANNER_URL}?designCode=${code}`, {
      waitUntil: 'networkidle',
      timeout: TIMEOUT
    });

    // Wait for lazy calls
    await page.waitForTimeout(8000);

    // ── Parse what we got ────────────────────────────────────────────────
    console.log('\n═══════════════════════════════════════════');
    console.log('PARSED RESULT');
    console.log('═══════════════════════════════════════════');

    if (itemsData) {
      const items = itemsData.body.data || [];

      // Extract item IDs from the URL to get order (quantities TBD)
      const urlMatch = itemsData.url.match(/filter\.itemId=([^&]+)/);
      const orderedIds = urlMatch ? urlMatch[1].split(',') : [];

      console.log(`\n📦 Items found: ${items.length}`);
      console.log('─────────────────────────────────────────');

      const result = items.map(item => {
        const price = item.content?.priceInformation?.salesPrice?.find(
          p => p.typeCode === 'RegularSalesUnitPrice'
        );
        return {
          spr_id:     item.itemId,
          sku:        item.content?.itemNoGlobal || item.content?.ruItemNo,
          name:       item.content?.name,
          price_gbp:  price?.priceInclTax,
          dimensions: item.content?.measureReference?.textMetric,
          qty:        1, // placeholder until we find the design load call
        };
      });

      result.forEach(item => {
        console.log(`  ${item.name}`);
        console.log(`    SKU: ${item.sku}  |  £${item.price_gbp}  |  ${item.dimensions}`);
      });

      const total = result.reduce((sum, i) => sum + (i.price_gbp || 0), 0);
      console.log(`\n  TOTAL (before qty): £${total.toFixed(2)}`);

      if (!designData) {
        console.log('\n⚠️  Design load call NOT captured yet.');
        console.log('   We have names + prices but NOT quantities.');
        console.log('   The design load call must use a different URL pattern.');
        console.log('   Saving full item URL for manual inspection...');
        require('fs').writeFileSync('item-api-url.txt', itemsData.url);
        console.log('   → Saved to item-api-url.txt');
      }

      // Save full result
      require('fs').writeFileSync(
        'pax-result.json',
        JSON.stringify({ code, items: result, raw_items_url: itemsData.url }, null, 2)
      );
      console.log('\n💾 Full result saved to pax-result.json');

    } else {
      console.log('❌ Item details API not captured. Taking screenshot...');
      await page.screenshot({ path: 'pax-debug.png', fullPage: true });
      console.log('   Screenshot saved: pax-debug.png');
    }

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    try { await page.screenshot({ path: 'pax-error.png' }); } catch (_) {}
  } finally {
    await browser.close();
  }
}

fetchPaxDesign(PAX_CODE);
