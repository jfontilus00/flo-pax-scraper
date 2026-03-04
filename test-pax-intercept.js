/**
 * IKEA PAX - Playwright NETWORK INTERCEPTION approach
 * 
 * This is completely different from DOM scraping.
 * We don't click anything or read any DOM elements.
 * We just listen to what IKEA's own app receives over the network,
 * and grab that JSON directly.
 * 
 * WHY THIS IS STABLE:
 * - IKEA can redesign their UI completely and this still works
 * - We never rely on button labels, CSS classes, or DOM structure
 * - The underlying data API has to exist for the planner to function
 * 
 * SETUP (one time):
 *   npm init -y
 *   npm install playwright
 *   npx playwright install chromium
 * 
 * RUN:
 *   node test-pax-intercept.js
 * 
 * Or with a real code:
 *   node test-pax-intercept.js YOURCODE
 */

const { chromium } = require('playwright');

const PAX_CODE  = process.argv[2] || 'VSQWPG'; // pass your code as argument
const COUNTRY   = 'gb';
const LANGUAGE  = 'en';
const TIMEOUT   = 45000; // 45 seconds max wait

const PLANNER_URL = `https://www.ikea.com/addon-app/storageone/pax/web/latest/${COUNTRY}/${LANGUAGE}/`;

async function fetchPaxDesign(code) {
  console.log(`\n🔍 Loading PAX design: ${code}`);
  console.log(`   URL: ${PLANNER_URL}`);
  console.log(`   Listening for API calls...\n`);

  const browser = await chromium.launch({
    headless: true, // set to false to watch it happen in a real browser
  });

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-GB',
  });

  const page = await context.newPage();

  // ── THE KEY PART: intercept all network responses ──────────────────────────
  const capturedResponses = [];
  const interestingUrls   = [];

  page.on('response', async (response) => {
    const url = response.url();

    // Log ALL API calls so we can see what IKEA is calling
    if (url.includes('amazonaws.com') ||
        url.includes('ikea.com/api') ||
        url.includes('ikea.com/gb') ||
        url.includes('storageone') ||
        url.includes('planner') ||
        url.includes('/load') ||
        url.includes('/design') ||
        url.includes('/cart') ||
        url.includes('/items')) {
      
      const status = response.status();
      const ct     = response.headers()['content-type'] || '';

      console.log(`  📡 ${status} ${url.substring(0, 100)}`);
      interestingUrls.push({ url, status });

      // Capture JSON responses
      if (ct.includes('application/json') && status < 400) {
        try {
          const body = await response.json();
          capturedResponses.push({ url, status, body });
          console.log(`     ✅ JSON captured (${JSON.stringify(body).length} chars)`);
        } catch (e) {
          // not JSON
        }
      }
    }
  });

  // Also capture ALL requests so we can see auth headers
  page.on('request', (request) => {
    const url = request.url();
    if (url.includes('amazonaws.com') || url.includes('storageone')) {
      const headers = request.headers();
      console.log(`  📤 REQUEST: ${url.substring(0, 100)}`);
      if (headers['authorization']) {
        console.log(`     🔑 Auth: ${headers['authorization'].substring(0, 50)}...`);
      }
    }
  });

  try {
    // Step 1: Load the planner
    console.log('Step 1: Loading planner...');
    await page.goto(PLANNER_URL, { waitUntil: 'networkidle', timeout: TIMEOUT });
    console.log('   ✅ Planner loaded\n');

    // Step 2: Try loading design via URL param (cleanest approach)
    console.log(`Step 2: Loading design code via URL...`);
    await page.goto(`${PLANNER_URL}?designCode=${code}`, { 
      waitUntil: 'networkidle', 
      timeout: TIMEOUT 
    });
    console.log('   ✅ Design URL loaded\n');

    // Wait a bit more for any lazy API calls
    await page.waitForTimeout(5000);

    // Step 3: Try to find and use the "Open design" button if URL approach didn't work
    if (capturedResponses.length === 0) {
      console.log('Step 3: No API response via URL, trying button approach...');
      
      // Look for any input field
      const inputs = await page.locator('input').all();
      console.log(`   Found ${inputs.length} input fields`);

      // Try common code input patterns
      const codeInputSelectors = [
        'input[placeholder*="code" i]',
        'input[placeholder*="design" i]',
        'input[type="text"]',
        'input[maxlength="6"]',
        'input[maxlength="8"]',
      ];

      for (const sel of codeInputSelectors) {
        try {
          const el = page.locator(sel).first();
          if (await el.isVisible({ timeout: 2000 })) {
            console.log(`   Found input with selector: ${sel}`);
            await el.fill(code);
            await page.keyboard.press('Enter');
            await page.waitForTimeout(5000);
            break;
          }
        } catch (_) {}
      }
    }

    // Step 4: Final wait and collect results
    await page.waitForTimeout(3000);

    console.log('\n─────────────────────────────────────────────');
    console.log('RESULTS SUMMARY');
    console.log('─────────────────────────────────────────────');
    console.log(`\nAll interesting URLs seen (${interestingUrls.length}):`);
    interestingUrls.forEach(({ url, status }) => {
      console.log(`  ${status} ${url}`);
    });

    if (capturedResponses.length > 0) {
      console.log(`\n✅ SUCCESS — Captured ${capturedResponses.length} JSON response(s):\n`);
      capturedResponses.forEach(({ url, body }, i) => {
        console.log(`\n[Response ${i + 1}] ${url}`);
        console.log(JSON.stringify(body, null, 2));
      });
    } else {
      console.log('\n❌ No JSON API responses captured yet.');
      console.log('\nPossible reasons:');
      console.log('  1. The design code is expired or invalid');
      console.log('  2. The app uses a different loading mechanism');
      console.log('  3. We need to interact with the page first');
      
      // Save a screenshot so we can see what the page looks like
      await page.screenshot({ path: 'pax-debug.png', fullPage: true });
      console.log('\n📸 Screenshot saved: pax-debug.png');
      console.log('   Open it to see what the planner looks like\n');
    }

    return capturedResponses;

  } catch (err) {
    console.error('\n❌ Error:', err.message);
    try { 
      await page.screenshot({ path: 'pax-error.png' }); 
      console.log('📸 Error screenshot: pax-error.png');
    } catch (_) {}
    return [];
  } finally {
    await browser.close();
  }
}

// ── MAIN ─────────────────────────────────────────────────────────────────────
fetchPaxDesign(PAX_CODE).then(responses => {
  if (responses.length > 0) {
    console.log('\n🎉 PROOF OF CONCEPT WORKED.');
    console.log('   The API response above contains the design data.');
    console.log('   Next step: build the scraper around this interception pattern.');
  } else {
    console.log('\n📋 Next step: open pax-debug.png and paste what you see.');
  }
});
