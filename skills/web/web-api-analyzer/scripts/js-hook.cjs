#!/usr/bin/env node
// JS Hook Analyzer — inject hooks to monitor crypto, fetch, storage, and cookie operations

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

const HOOKS = {
  crypto: `
    (function() {
      const log = (type, data) => window.__jsHooks.push({ type, data, time: Date.now() });

      // Hook Web Crypto API
      if (window.crypto && window.crypto.subtle) {
        const origDigest = window.crypto.subtle.digest.bind(window.crypto.subtle);
        window.crypto.subtle.digest = async function(algo, data) {
          const arr = new Uint8Array(data);
          const text = new TextDecoder().decode(arr).substring(0, 200);
          log('crypto.subtle.digest', { algorithm: algo, inputPreview: text });
          return origDigest(algo, data);
        };
        const origEncrypt = window.crypto.subtle.encrypt.bind(window.crypto.subtle);
        window.crypto.subtle.encrypt = async function(algo, key, data) {
          const arr = new Uint8Array(data);
          const text = new TextDecoder().decode(arr).substring(0, 200);
          log('crypto.subtle.encrypt', { algorithm: algo.name || algo, inputPreview: text });
          return origEncrypt(algo, key, data);
        };
      }

      // Hook btoa / atob
      const origBtoa = window.btoa;
      window.btoa = function(s) {
        log('btoa', { input: String(s).substring(0, 200) });
        return origBtoa.call(window, s);
      };
      const origAtob = window.atob;
      window.atob = function(s) {
        log('atob', { input: String(s).substring(0, 200) });
        return origAtob.call(window, s);
      };

      // Hook common crypto libraries (CryptoJS, md5, JSEncrypt)
      const origDefineProperty = Object.defineProperty;
      const hookedProps = new Set();

      // Periodic check for dynamically loaded crypto libs
      setInterval(() => {
        if (window.CryptoJS && !hookedProps.has('CryptoJS')) {
          hookedProps.add('CryptoJS');
          ['MD5','SHA1','SHA256','SHA512','HmacMD5','HmacSHA1','HmacSHA256','AES','DES','TripleDES','RC4'].forEach(fn => {
            if (window.CryptoJS[fn]) {
              const orig = window.CryptoJS[fn].encrypt || window.CryptoJS[fn];
              const origFunc = typeof orig === 'function' ? orig : null;
              if (origFunc) {
                const wrapper = function() {
                  const args = Array.from(arguments).map(a => String(a).substring(0, 200));
                  log('CryptoJS.' + fn, { args });
                  return origFunc.apply(this, arguments);
                };
                if (window.CryptoJS[fn].encrypt) {
                  window.CryptoJS[fn].encrypt = wrapper;
                } else {
                  window.CryptoJS[fn] = wrapper;
                }
              }
            }
          });
          log('CryptoJS.detected', { methods: Object.keys(window.CryptoJS).filter(k => typeof window.CryptoJS[k] === 'function' || typeof window.CryptoJS[k] === 'object') });
        }
        if (window.md5 && !hookedProps.has('md5')) {
          hookedProps.add('md5');
          const origMd5 = window.md5;
          window.md5 = function() {
            log('md5', { input: String(arguments[0]).substring(0, 200) });
            return origMd5.apply(this, arguments);
          };
        }
        if (window.JSEncrypt && !hookedProps.has('JSEncrypt')) {
          hookedProps.add('JSEncrypt');
          const origProto = window.JSEncrypt.prototype.encrypt;
          window.JSEncrypt.prototype.encrypt = function(text) {
            log('JSEncrypt.encrypt', { input: String(text).substring(0, 200) });
            return origProto.call(this, text);
          };
        }
      }, 500);
    })();
  `,

  fetch: `
    (function() {
      const log = (type, data) => window.__jsHooks.push({ type, data, time: Date.now() });

      // Hook fetch
      const origFetch = window.fetch;
      window.fetch = async function(input, init) {
        const url = typeof input === 'string' ? input : input.url;
        const method = (init && init.method) || 'GET';
        const body = init && init.body ? String(init.body).substring(0, 500) : null;
        const headers = init && init.headers ? JSON.parse(JSON.stringify(init.headers)) : null;
        log('fetch', { url, method, body, headers });
        const resp = await origFetch.apply(this, arguments);
        log('fetch.response', { url, status: resp.status });
        return resp;
      };

      // Hook XMLHttpRequest
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;
      const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

      XMLHttpRequest.prototype.open = function(method, url) {
        this.__hookInfo = { method, url: String(url), headers: {} };
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this.__hookInfo) this.__hookInfo.headers[name] = value;
        return origSetHeader.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function(body) {
        if (this.__hookInfo) {
          log('XHR', {
            ...this.__hookInfo,
            body: body ? String(body).substring(0, 500) : null
          });
          this.addEventListener('load', () => {
            log('XHR.response', {
              url: this.__hookInfo.url,
              status: this.status,
              responsePreview: this.responseText ? this.responseText.substring(0, 300) : null
            });
          });
        }
        return origSend.apply(this, arguments);
      };
    })();
  `,

  storage: `
    (function() {
      const log = (type, data) => window.__jsHooks.push({ type, data, time: Date.now() });
      ['localStorage', 'sessionStorage'].forEach(name => {
        const store = window[name];
        const origSet = store.setItem.bind(store);
        const origGet = store.getItem.bind(store);
        store.setItem = function(key, val) {
          log(name + '.setItem', { key, value: String(val).substring(0, 200) });
          return origSet(key, val);
        };
        store.getItem = function(key) {
          const val = origGet(key);
          log(name + '.getItem', { key, value: val ? String(val).substring(0, 200) : null });
          return val;
        };
      });
    })();
  `,

  cookie: `
    (function() {
      const log = (type, data) => window.__jsHooks.push({ type, data, time: Date.now() });
      let cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie') ||
                       Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
      if (cookieDesc) {
        Object.defineProperty(document, 'cookie', {
          get() {
            const val = cookieDesc.get.call(this);
            log('cookie.get', { value: val ? val.substring(0, 300) : '' });
            return val;
          },
          set(val) {
            log('cookie.set', { value: String(val).substring(0, 300) });
            return cookieDesc.set.call(this, val);
          },
          configurable: true
        });
      }
    })();
  `,
};

(async () => {
  const args = parseArgs(process.argv);
  if (!args.url) {
    console.error('Usage: node js-hook.js --url <URL> --hook <crypto|fetch|storage|cookie|all> [--duration ms] [--output file] [--headed]');
    process.exit(1);
  }

  const url = args.url;
  const duration = parseInt(args.duration) || 15000;
  const hookType = args.hook || 'all';
  const headed = !!args.headed;
  const outputFile = args.output || null;

  const browser = await chromium.launch({ headless: !headed });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Inject hooks before any JS runs
  const selectedHooks = hookType === 'all' ? Object.keys(HOOKS) : [hookType];
  const initScript = `window.__jsHooks = [];\n` + selectedHooks.map(h => HOOKS[h] || '').join('\n');

  await page.addInitScript(initScript);

  console.error(`[*] Loading ${url} with hooks: ${selectedHooks.join(', ')}...`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error(`[!] Navigation warning: ${e.message}`);
  }

  console.error(`[*] Monitoring for ${duration}ms...`);
  await new Promise(r => setTimeout(r, duration));

  // Collect hook data
  const hookData = await page.evaluate(() => window.__jsHooks || []);

  await browser.close();

  const result = {
    url,
    timestamp: new Date().toISOString(),
    hooks: selectedHooks,
    capturedMs: duration,
    totalEvents: hookData.length,
    events: hookData,
  };

  const output = JSON.stringify(result, null, 2);

  if (outputFile) {
    require('fs').writeFileSync(outputFile, output);
    console.error(`[*] Saved to ${outputFile}`);
  } else {
    console.log(output);
  }

  console.error(`[*] Done. Captured ${hookData.length} JS hook events.`);
})();
