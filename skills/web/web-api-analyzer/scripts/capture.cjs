#!/usr/bin/env node
// Web API Capture — intercept all network requests from a target URL

const { chromium } = require('playwright');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const key = argv[i].replace(/^--/, '');
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

(async () => {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error('Usage: node capture.js --url <URL> [--duration ms] [--output file] [--har] [--filter regex] [--click selector] [--scroll] [--headers] [--body] [--cookie] [--headed]');
    process.exit(1);
  }

  const url = args.url;
  const duration = parseInt(args.duration) || 10000;
  const filterRe = args.filter ? new RegExp(args.filter, 'i') : null;
  const showHeaders = !!args.headers;
  const captureBody = !!args.body;
  const captureCookie = !!args.cookie;
  const headed = !!args.headed;
  const outputFile = args.output || null;
  const harMode = !!args.har;

  const requests = [];
  const cookies = [];

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  const startTime = Date.now();

  // Intercept requests
  page.on('request', (req) => {
    const reqUrl = req.url();
    if (filterRe && !filterRe.test(reqUrl)) return;
    // Skip static assets
    const rt = req.resourceType();
    if (['image', 'stylesheet', 'font', 'media'].includes(rt)) return;

    const entry = {
      url: reqUrl,
      method: req.method(),
      resourceType: rt,
      postData: req.postData() || null,
      timing: { start: Date.now() - startTime },
    };
    if (showHeaders) {
      entry.headers = req.headers();
    }
    entry._resolve = null;
    entry.response = null;
    requests.push(entry);
  });

  page.on('response', async (res) => {
    const resUrl = res.url();
    // Find matching request (last one with same URL)
    const entry = [...requests].reverse().find(r => r.url === resUrl && !r.response);
    if (!entry) return;

    entry.response = {
      status: res.status(),
      statusText: res.statusText(),
    };
    if (showHeaders) {
      entry.response.headers = res.headers();
    }
    entry.timing.duration = Date.now() - startTime - entry.timing.start;

    if (captureBody) {
      try {
        const ct = res.headers()['content-type'] || '';
        if (ct.includes('json') || ct.includes('text') || ct.includes('javascript') || ct.includes('xml')) {
          entry.response.body = await res.text();
          // Try parse JSON
          if (ct.includes('json')) {
            try { entry.response.bodyJson = JSON.parse(entry.response.body); } catch {}
          }
        } else {
          entry.response.body = `[binary ${ct}]`;
        }
      } catch {
        entry.response.body = '[failed to read body]';
      }
    }
  });

  // Navigate
  console.error(`[*] Loading ${url} ...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error(`[!] Navigation warning: ${e.message}`);
  }

  // Optional click
  if (args.click) {
    console.error(`[*] Clicking: ${args.click}`);
    try {
      await page.click(args.click, { timeout: 5000 });
    } catch (e) {
      console.error(`[!] Click failed: ${e.message}`);
    }
  }

  // Optional scroll
  if (args.scroll) {
    console.error('[*] Auto-scrolling...');
    await page.evaluate(async () => {
      for (let i = 0; i < 10; i++) {
        window.scrollBy(0, window.innerHeight);
        await new Promise(r => setTimeout(r, 500));
      }
    });
  }

  console.error(`[*] Capturing for ${duration}ms...`);
  await new Promise(r => setTimeout(r, duration));

  // Get cookies
  if (captureCookie) {
    const ckList = await context.cookies();
    cookies.push(...ckList);
  }

  await browser.close();

  // Clean up internal fields
  const cleanRequests = requests.map(({ _resolve, ...rest }) => rest);

  // Output
  const result = {
    url,
    timestamp: new Date().toISOString(),
    capturedMs: duration,
    totalRequests: cleanRequests.length,
    requests: cleanRequests,
  };
  if (captureCookie) result.cookies = cookies;

  let output;
  if (harMode) {
    // Convert to HAR 1.2 format
    output = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'web-api-analyzer', version: '1.0.0' },
        entries: cleanRequests.map(r => ({
          startedDateTime: new Date(startTime + r.timing.start).toISOString(),
          time: r.timing.duration || 0,
          request: {
            method: r.method,
            url: r.url,
            headers: r.headers ? Object.entries(r.headers).map(([n, v]) => ({ name: n, value: v })) : [],
            postData: r.postData ? { text: r.postData } : undefined,
          },
          response: r.response ? {
            status: r.response.status,
            statusText: r.response.statusText || '',
            headers: r.response.headers ? Object.entries(r.response.headers).map(([n, v]) => ({ name: n, value: v })) : [],
            content: r.response.body ? { text: r.response.body } : {},
          } : {},
        })),
      },
    }, null, 2);
  } else {
    output = JSON.stringify(result, null, 2);
  }

  if (outputFile) {
    require('fs').writeFileSync(outputFile, output);
    console.error(`[*] Saved to ${outputFile}`);
  } else {
    console.log(output);
  }

  console.error(`[*] Done. Captured ${cleanRequests.length} requests.`);
})();
