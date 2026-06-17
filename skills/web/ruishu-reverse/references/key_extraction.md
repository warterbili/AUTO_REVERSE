# Phase 2: Key Extraction (Generic, One-Time)

## Overview

- Input: `$_ts.cd` string
- Output: `keys[0..44]` (45 key groups)

## Custom Base64 Decoding (cd -> bytes)

```javascript
const BASESTR = 'qrcklmDoExthWJiHAp1sVYKU3RFMQw8IGfPO92bvLNj.7zXBaSnu0TC6gy_4Ze5d{}|~ !#$%()*+,-;=?@[]^';

function mkDecryptKeys() {
    const a = [{},{},{},{},{},{}];
    for (let i = 0; i < BASESTR.length; i++) {
        const c = BASESTR.charCodeAt(i);
        a[0][c] = i << 2;
        a[1][c] = i >> 4;
        a[2][c] = (i & 15) << 4;
        a[3][c] = i >> 2;
        a[4][c] = (i & 3) << 6;
        a[5][c] = i;
    }
    return a;
}

function decodeCd(str) {
    const dk = mkDecryptKeys();
    const a = [];
    for (let i = 0; i < str.length; i += 4) {
        const c = [0,1,2,3].map(j => i+j < str.length ? str.charCodeAt(i+j) : undefined);
        if (c[1] !== undefined) a.push(dk[0][c[0]] | dk[1][c[1]]);
        if (c[2] !== undefined) a.push(dk[2][c[1]] | dk[3][c[2]]);
        if (c[3] !== undefined) a.push(dk[4][c[2]] | dk[5][c[3]]);
    }
    return a;
}
```

## Variable-Length Length Parsing

```javascript
function readLength(arr, pos) {
    const x = arr[pos++];
    let len;
    if ((x & 128) === 0) len = x;                                    // 0xxxxxxx: 1 byte
    else if ((x & 192) === 128) len = ((x & 63) << 8) | arr[pos++];  // 10xxxxxx: 2 bytes
    else if ((x & 224) === 192) len = ((x & 31) << 16) | (arr[pos++] << 8) | arr[pos++]; // 110xxxxx: 3 bytes
    else len = x;
    return [len, pos];
}
```

## XOR Offset Derivation + keys Extraction

```javascript
function extractKeys(cd) {
    const bytes = decodeCd(cd);
    const codeEnd = (bytes[0] << 8 | bytes[1]) + 2;
    const keysPart = bytes.slice(codeEnd);

    // Known-plaintext attack: keys[0]="64"(ASCII 0x36,0x34), keys[1]="64", keys[2]=48B
    const offset = [
        keysPart[0] ^ 45,    // keyCount = 45
        keysPart[1] ^ 2,     // keys[0].length = 2
        keysPart[2] ^ 0x36,  // '6'
        keysPart[3] ^ 0x34,  // '4'
        keysPart[4] ^ 2,     // keys[1].length = 2
        keysPart[5] ^ 0x36,  // '6'
        keysPart[6] ^ 0x34,  // '4'
        keysPart[7] ^ 48     // keys[2].length = 48
    ];

    const decrypted = keysPart.map((b, i) => b ^ offset[i % 8]);
    const keys = []; let pos = 1;
    for (let i = 0; i < decrypted[0]; i++) {
        const [len, newPos] = readLength(decrypted, pos);
        pos = newPos;
        keys.push(decrypted.slice(pos, pos + len));
        pos += len;
    }

    // Self-check
    if (keys.length < 45) throw new Error('insufficient keys ' + keys.length + '/45, XOR offset may be wrong');
    if ([29,30,31,32].some(i => keys[i]?.length !== 4))
        throw new Error('keys[29..32] structure anomaly, r2mka runTask must be implemented');

    return keys;
}
```

## Key keys Meanings Table

| key | Meaning | Purpose |
|-----|------|------|
| keys[2] | 48B KEYS48 | XOR + packet embedding |
| keys[7] | Config string (semicolon-delimited) | split(';')[5]+'T' = Cookie name |
| keys[16] | 16B KEY2 | Outer AES key |
| keys[17] | 16B KEY1 | Inner AES key |
| keys[19] | Timestamp string | type=10[6..9] |
| keys[21] | r2mkaTime string | nonce time |
| keys[22] | Encrypted data | type=6 AES decryption |
| keys[24-26] | Numeric strings | type=10 parameters |
| keys[29-32] | 4B each | type=2 variable name mapping |
| keys[33-34] | Numeric strings | codeUid computation parameters |

## When the Self-Check Fails (keys[0] != "64")

You must implement rs-reverse's tscd.js: cd code section -> parse -> getTaskarr -> runTaskByUid -> 8-byte XOR offset. This is difficult and not required for most sites. Prefer the simplified method above plus the self-check.
