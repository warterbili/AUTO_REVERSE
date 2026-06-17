/**
 * Ruishu sdenv client — automatic Cookie + URL suffix generation
 * Usage:
 *   const { RuishuClient } = require('./sdenv_client');
 *   const client = new RuishuClient({ host: '...', entryPath: '/...' });
 *   await client.init();
 *   const getResult = await client.get('/page');
 *   const postResult = await client.post('/api', { key: 'value' });
 *   client.close();
 *
 * Note: a single sdenv instance can only send one POST; after each POST you must call close() + init()
 */
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
const { jsdomFromUrl } = require('sdenv');
const http = require('http');

const DEFAULT_CONFIG = {
    host: 'TARGET_HOST',
    port: 80,
    entryPath: '/TARGET_PATH',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
};

class RuishuClient {
    constructor(config = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.dom = null;
        this.cookies = '';
        this.ready = false;
    }

    get baseUrl() {
        return `http://${this.config.host}:${this.config.port}`;
    }

    async init() {
        const url = `${this.baseUrl}${this.config.entryPath}`;
        this.dom = await jsdomFromUrl(url, {
            userAgent: this.config.userAgent,
            consoleConfig: { error: () => {} },
        });
        await new Promise(resolve => {
            this.dom.window.addEventListener('sdenv:exit', () => resolve());
            setTimeout(resolve, 8000);
        });
        this.cookies = this.dom.cookieJar.getCookieStringSync(this.baseUrl);
        this.ready = true;
        console.log('init complete, cookies:', this.cookies.length, 'chars');
        return this;
    }

    // GET: only the Cookie is needed (no URL suffix required)
    async get(path) {
        if (!this.ready) throw new Error('Call init() first');
        return new Promise((resolve, reject) => {
            http.request({
                hostname: this.config.host,
                port: this.config.port,
                path,
                method: 'GET',
                headers: {
                    'User-Agent': this.config.userAgent,
                    'Cookie': this.cookies,
                },
            }, res => {
                const chunks = [];
                res.on('data', c => chunks.push(c));
                res.on('end', () => resolve({
                    status: res.statusCode,
                    body: Buffer.concat(chunks).toString('utf-8'),
                }));
            }).on('error', reject).end();
        });
    }

    // POST: sent via XHR inside the VM (URL suffix added automatically)
    async post(path, data) {
        if (!this.ready) throw new Error('Call init() first');
        const w = this.dom.window;
        return new Promise((resolve, reject) => {
            const xhr = new w.XMLHttpRequest();
            xhr.open('POST', path, true);
            xhr.onreadystatechange = function() {
                if (xhr.readyState === 4) {
                    resolve({ status: xhr.status, body: xhr.responseText });
                }
            };
            xhr.onerror = () => reject(new Error('XHR error'));
            xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
            if (typeof data === 'object') {
                xhr.send(Object.entries(data)
                    .map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
                    .join('&'));
            } else {
                xhr.send(data || '');
            }
            setTimeout(() => {
                if (xhr.readyState !== 4) reject(new Error('POST timeout'));
            }, 30000);
        });
    }

    close() {
        if (this.dom) {
            this.dom.window.close();
            this.dom = null;
            this.ready = false;
        }
    }
}

module.exports = { RuishuClient, DEFAULT_CONFIG };
