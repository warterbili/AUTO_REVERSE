/**
 * PX ob response decode + instruction execution
 *
 * Reconstructed from main.js line 500-509 (Et/gt) + line 1423-1505 (eh/ih) + captcha.js:7165 (poi/PoW)
 *
 * ═══ Input ═══
 *   responseJson: String — collect/bundle response body JSON, contains .ob or .do field
 *   gt:           String — XOR seed, from main.js Et(), e.g. "DXJ9dEscZAAJeA=="
 *                          changes on every PX script load, must be extracted from the current version's main.js
 *
 * ═══ Output ═══
 *   Object — {
 *     segments: String[],         // decoded raw segments
 *     results:  Object[],         // per-segment handler execution result { handler, args, result }
 *     state:    Object            // global state set by handlers (jf, no, qa, ao etc.)
 *   }
 *
 * ═══ Algorithm chain ═══
 *   1. xorKey = parseInt(ml(gt), 10) % 128    — gt hash → XOR key
 *   2. ob = JSON.parse(response).ob || .do
 *   3. decoded = base64(ob) → XOR(xorKey)
 *   4. segments = decoded.split("~~~~")
 *   5. each segment: fields = seg.split("|"), shift() to get handler key (discarded, not relied on)
 *   6. auto-detect handler type by argument signature (does not rely on key name, compatible with all PX versions)
 *   7. "cc"-tagged segments execute first (unshift to front of queue)
 *   8. execute handler, collect state and results
 *
 * ═══ state fields (source of POST parameters) ═══
 *   state.no     = server timestamp (used for payload interleaving + sid steganography)
 *   state.qa     = challenge hash → cs parameter
 *   state.vid    = visitor ID → vid parameter (ob handler "00I0I0")
 *   state.cts    = client timestamp UUID → cts parameter (ob handler "0III0000")
 *   state.pxsid  = session UUID → UUID part of sid parameter (ob handler "I0III0")
 *   state.jf     = control flag ("cu")
 *   state.ao     = status code ("401")
 *
 * Usage:
 *   const processOb = require('./ob')
 *   const { segments, results, state } = processOb(responseJson, gt)
 *   const sid = processOb.buildSid(state)   // pxsid + hh(no) steganography
 */

const crypto = require('crypto');

// ═══ ml() — hash function, returns a 3-digit numeric string (main.js:2131) ═══

function ml(t) {
    let e = 0;
    for (let n = 0; n < t.length; n++)
        e = (31 * e + t.charCodeAt(n)) % 2147483647;
    return (e % 900 + 100).toString();
}

// ═══ ee() — XOR encode/decode (main.js:666-670) ═══

function xor(t, key) {
    let n = '';
    for (let i = 0; i < t.length; i++)
        n += String.fromCharCode(t.charCodeAt(i) ^ key);
    return n;
}

// ═══ sha256 ═══

function sha256(data) {
    return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// ═══ solvePow — PoW solver (captcha.js:7165-7170 + 7411) ═══
// PX1135 = PX762 = Bs
//
// Input:
//   targetHash: String — target SHA-256 hash
//   suffix:     String — prefix string
//   difficulty: Number — number of search bits (default 16)
//
// Output:
//   { answer, counter, elapsed } or null

function solvePow(targetHash, suffix, difficulty) {
    difficulty = +difficulty || 16;
    const start = Date.now();
    const m = Math.ceil(difficulty / 4);
    const mask = (1 << (4 * m)) - 1;
    const lastHex = parseInt('0x' + suffix.charAt(suffix.length - 1), 16);
    const prefix = suffix.slice(0, -1);
    const max = 1 << difficulty;

    for (let r = 0; r < max; r++) {
        const low = ('0'.repeat(m) + (r & mask).toString(16)).slice(-m);
        const candidate = prefix + (lastHex + (r >> (m << 2))).toString(16) + low;
        if (sha256(candidate) === targetHash)
            return { answer: candidate, counter: r, elapsed: Date.now() - start };
    }
    return null;
}

// ═══ decodeOb — decode the ob field ═══

function decodeOb(responseJson, gt) {
    const xorKey = parseInt(ml(gt), 10) % 128;
    const parsed = typeof responseJson === 'string' ? JSON.parse(responseJson) : responseJson;
    const obValue = parsed.do || parsed.ob;
    if (!obValue) return { xorKey, segments: [] };

    const decoded = Buffer.from(obValue, 'base64').toString('binary');
    const segments = xor(decoded, xorKey).split('~~~~');
    return { xorKey, segments };
}

// ═══ UUID regex ═══
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ═══ hh() — sid steganographic encoding (main.js:4366-4373) ═══
function hh(t) {
    let r = '';
    for (let i = 0; i < t.length; i++)
        r += String.fromCodePoint(0xE0100 + t.charCodeAt(i));
    return r;
}

// ═══ signature matching rules ═══
// does not rely on handler key name, auto-detects handler type by argument content
// each rule: { name, match(args), exec(state, args) }

const HANDLER_RULES = [
    // ── set_cookie (oh) ── args[0]=cookieName contains "px", 5 arguments
    {
        name: 'set_cookie',
        match: (args) => args.length >= 4 && /^_?px/i.test(args[0]),
        exec: (state, args) => {
            const [cookieName, ttl, cookieValue, secure, maxAge] = args;
            state.px3 = { name: cookieName, value: cookieValue, ttl: +ttl,
                          secure: secure === "true", maxAge: +maxAge };
            return { type: 'set_cookie', name: cookieName, value: cookieValue, ttl: +ttl };
        }
    },
    // ── PoW start (PX1135=Bs) ── 5 args, args[0]="1"/"0", args[2]=64hex, args[3]=difficulty
    {
        name: 'pow_start',
        match: (args) => args.length === 5 && (args[0] === "1" || args[0] === "0")
            && /^[0-9a-f]{64}$/.test(args[2]) && /^\d{1,3}$/.test(args[3]),
        exec: (state, args) => {
            const [enabled, suffix, targetHash, difficulty, isTrusted] = args;
            if (enabled !== "1") return { type: 'pow', enabled: false };
            const pow = solvePow(targetHash, suffix, +difficulty);
            return { type: 'pow', enabled: true, suffix, targetHash,
                     difficulty: +difficulty, isTrusted: isTrusted === "true", pow };
        }
    },
    // ── PoW challenge (qu) ── 6+ args, args[0]="1"/"0", args[1]=UUID, args[2]=port
    {
        name: 'pow_challenge',
        match: (args) => args.length >= 6 && (args[0] === "1" || args[0] === "0")
            && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(args[1]),
        exec: (state, args) => {
            const [enabled, uuid, port, challengeData, extra, tag] = args;
            if (enabled !== "1") return { type: 'pow_challenge', enabled: false };
            const parts = (challengeData || "").split("_");
            if (parts.length !== 2) return { type: 'pow_challenge', error: 'bad challenge format' };
            const hash = parts[0];
            let suffix = '';
            for (let i = 0; i < parts[1].length; i++)
                suffix += String.fromCharCode(parts[1].charCodeAt(i) ^ 10);
            state.powUuid = uuid;
            return { type: 'pow_challenge', uuid, port: +port, hash, suffix, extra: +extra, tag };
        }
    },
    // ── visual challenge (PX12634) ── 5 args, first 4 small numbers, 5th is 64hex
    {
        name: 'visual_challenge',
        match: (args) => args.length === 5 && /^\d{1,4}$/.test(args[0])
            && /^\d{1,4}$/.test(args[1]) && /^[0-9a-f]{64}$/.test(args[4]),
        exec: (state, args) => {
            const [startW, startH, wJump, hJump, hash] = args;
            return { type: 'visual_challenge', startWidth: +startW, startHeight: +startH,
                     widthJump: +wJump, heightJump: +hJump, hash };
        }
    },
    // ── timestamp (ch) ── 1 arg, 13-digit timestamp
    {
        name: 'timestamp',
        match: (args) => args.length === 1 && /^1[5-9]\d{11}$/.test(args[0]),
        exec: (state, args) => {
            state.no = args[0];
            state.ro = Math.floor(parseInt(args[0]) / 1000);
        }
    },
    // ── challenge hash (cs=qa) ── 1 arg, 64 hex
    {
        name: 'challenge_hash',
        match: (args) => args.length === 1 && /^[0-9a-f]{64}$/.test(args[0]),
        exec: (state, args) => {
            state.qa = args[0];
        }
    },
    // ── vid (00I0I0) ── 3 args, UUID + TTL number + flag
    {
        name: 'vid',
        match: (args) => args.length === 3 && UUID_RE.test(args[0]) && /^\d+$/.test(args[1]),
        exec: (state, args) => {
            state.vid = args[0];
            return { type: 'vid', value: args[0], ttl: +args[1], flag: args[2] };
        }
    },
    // ── cts (0III0000) ── 2 args, UUID + flag
    {
        name: 'cts',
        match: (args) => args.length === 2 && UUID_RE.test(args[0]),
        exec: (state, args) => {
            state.cts = args[0];
            return { type: 'cts', value: args[0], flag: args[1] };
        }
    },
    // ── pxsid (I0III0) ── 1 arg, UUID
    {
        name: 'pxsid',
        match: (args) => args.length === 1 && UUID_RE.test(args[0]),
        exec: (state, args) => {
            state.pxsid = args[0];
            return { type: 'pxsid', value: args[0] };
        }
    },
    // ── session ID (fh) ── 1-2 args, first one is 16+ digits of pure numbers
    {
        name: 'session_id',
        match: (args) => (args.length === 1 || args.length === 2) && /^\d{16,}$/.test(args[0]),
        exec: (state, args) => {
            state.to = args[0];
            state.eo = args[1] || null;
        }
    },
    // ── status code (ah) ── 1 arg, 3-digit number (e.g. 401, 680)
    {
        name: 'status_code',
        match: (args) => args.length === 1 && /^\d{3}$/.test(args[0]),
        exec: (state, args) => {
            state.ao = args[0];
        }
    },
    // ── app ID ── 1 arg, 12-30 chars, contains lowercase letters and digits
    {
        name: 'app_id',
        match: (args) => args.length === 1 && /^[a-z0-9]{12,30}$/.test(args[0]),
        exec: (state, args) => {
            state.appId = args[0];
        }
    },
    // ── control flag (jf) ── 1 arg, 2-4 char short string (e.g. "cu")
    {
        name: 'control_flag',
        match: (args) => args.length === 1 && /^[a-z]{2,4}$/.test(args[0]),
        exec: (state, args) => {
            state.jf = args[0];
        }
    },
    // ── feature flags ── 1 arg, "key:val,key:val" format
    {
        name: 'feature_flags',
        match: (args) => args.length === 1 && /^[a-z]+:\d+(,[a-z]+:\d+)*$/.test(args[0]),
        exec: (state, args) => {
            const items = {};
            args[0].split(",").forEach(item => {
                const [k, v] = item.split(":");
                if (k) items[k] = v;
            });
            state.features = Object.assign(state.features || {}, items);
            return { type: 'feature_flags', items };
        }
    },
    // ── cookie config (ff) ── 3 args, name/ttl/value, name is a short string
    {
        name: 'cookie_config',
        match: (args) => (args.length === 3 || args.length === 4)
            && /^[a-zA-Z0-9_\-]{1,30}$/.test(args[0]) && /^\d+$/.test(args[1]),
        exec: (state, args) => {
            const [name, ttl, value] = args;
            state.cookies = state.cookies || {};
            state.cookies[name] = { ttl: +ttl, value: value };
            return { type: 'cookie_config', name, ttl: +ttl, value };
        }
    },
    // ── storage TTL ── 5 args, args[0] is the key, args[1] is the numeric TTL
    {
        name: 'storage_ttl',
        match: (args) => args.length === 5 && /^\d+$/.test(args[1]),
        exec: (state, args) => {
            return { type: 'storage_ttl', key: args[0], ttl: args[1],
                     value: args[2], param: args[3], extra: args[4] };
        }
    },
    // ── captcha control (OllOlOOO) ── 1 arg, small negative or small number, passed to PX764
    {
        name: 'captcha_control',
        match: (args) => args.length === 1 && /^-?\d{1,3}$/.test(args[0])
            && Math.abs(+args[0]) <= 100,
        exec: (state, args) => {
            state.captchaSignal = +args[0];
            return { type: 'captcha_control', signal: +args[0] };
        }
    },
    // ── 0 args → noop / reset / clear_cookie / px_control ──
    {
        name: 'noop',
        match: (args) => args.length === 0,
        exec: () => { return { type: 'noop' }; }
    },
];

// ═══ detectHandler — match handler by argument signature ═══

function detectHandler(args) {
    for (const rule of HANDLER_RULES) {
        if (rule.match(args)) return rule;
    }
    return null;
}

// ═══ executeSegments — segment processor ═══
// 1. split each segment by "|", shift() discards the handler key
// 2. "cc" tag → defer, unshift to front of queue
// 3. execute by signature matching

function executeSegments(segments, state) {
    let deferred = null;
    const queue = [];

    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i];
        if (!seg) continue;
        const fields = seg.split('|');
        const key = fields.shift(); // handler key (recorded only, not used for matching)

        if (fields[0] === 'cc') {
            // "cc" is both the defer tag and the actual cookie/config name
            // do not remove it from args, pass it to the handler as-is
            deferred = { key, args: fields };
            continue;
        }
        queue.push({ key, args: fields });
    }
    if (deferred) queue.unshift(deferred);

    const results = [];
    for (const item of queue) {
        const rule = detectHandler(item.args);
        if (!rule) {
            results.push({ handler: item.key, handlerType: 'unknown', args: item.args });
            continue;
        }
        try {
            const result = rule.exec(state, item.args);
            results.push({ handler: item.key, handlerType: rule.name, args: item.args, result });
        } catch (e) {
            results.push({ handler: item.key, handlerType: rule.name, args: item.args, error: e.message });
        }
    }
    return results;
}

// ═══ processOb — main entry point ═══

function processOb(responseJson, gt) {
    const { xorKey, segments } = decodeOb(responseJson, gt);
    const state = {};
    const results = executeSegments(segments, state);
    return { xorKey, segments, results, state };
}

// ═══ buildSid — build sid from state (with steganography) ═══
// sid = pxsid + hh(no)
// first request (no ob response): returns null, mh() does not send the sid parameter

function buildSid(state) {
    if (!state.pxsid && !state.no) return null;
    const uuid = state.pxsid || '';
    const ts = state.no || '';
    return (uuid || null) && (uuid + hh(String(ts)));
}

// ═══ getParams — extract all ob parameters needed for the POST from state ═══

function getParams(state) {
    return {
        vid: state.vid || null,      // → vid=
        cts: state.cts || null,      // → cts=
        cs: state.qa || null,        // → cs=
        sid: buildSid(state),        // → sid= (with steganography)
        no: state.no || null,        // server timestamp → used for payload interleaving
    };
}

module.exports = processOb;
module.exports.decodeOb = decodeOb;
module.exports.solvePow = solvePow;
module.exports.ml = ml;
module.exports.buildSid = buildSid;
module.exports.getParams = getParams;
