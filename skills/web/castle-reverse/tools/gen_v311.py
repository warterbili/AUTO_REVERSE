#!/usr/bin/env python3
"""
Castle.io v3.1.1 (Highwind / Android) FULL token GENERATOR + byte-exact verifier.
Self-derived from io.castle.highwind.android (DailyPay v48.0.0). NO XXTEA.

Builds X-Castle-Request-Token from raw device fields:
  fp_main  = encode 24 fields (f.a)         -> hex
  b_part   = encode 14 fields (r.a)         -> hex
  fpHex    = partHdr + fp_main + bPartHdr + b_part + motion + "ff"
  token    = base64url( unhex( randHex + xorHex(str4 + lenHex, randHex) ) )
  str4     = "0a" + hex(pk[3:]) + versionHex + uuidHex + deriveXor(uuid,8,uuid[9], string2+strA4)
  strA4    = deriveXor(string2,4,string2[3], fpHex)
  string2  = xorAppend(BE4(time),nibble) + xorAppend(BE2(last3(time)),nibble)
"""
import base64, binascii, json, math, os, random, sys

# ─────────── byte/hex primitives (mirror io.castle.highwind.android.y / q / d0) ───────────
def ya(i):                      # y.a(int) -> low byte as 2 hex chars
    return format(i & 0xff, '02x')

def ya_n(i, n):                 # y.a(int,n) -> big-endian n bytes hex (cap 2^(n*8)-1)
    i = int(min(2 ** (n * 8) - 1, i))
    s = ''
    while i > 0:
        s = ya(i) + s
        i >>= 8
    return s.rjust(n * 2, '0')

def ya_str(s):                  # y.a(String) -> hex of each char (latin1)
    return ''.join(ya(ord(c)) for c in s)

def yc(hexstr):                 # y.c(hex) -> bytes
    return binascii.unhexlify(hexstr)

def utf8_ints(s, cap=255):      # p0.a.a(str, cap) -> UTF-8 bytes (capped)
    b = s.encode('utf-8')
    return b[:cap]

def q_time(t):                  # q.a.a(int): BE4 with clamp on >>24/>>8 (bug-compatible)
    clamp = max(min(t, 268435455), 0)
    return ya(clamp >> 24) + ya(t >> 16) + ya(clamp >> 8) + ya(t)

def xor_hex(data_hex, key_hex):  # nibble-wise XOR, key cycled (q.a.a 2-arg core)
    k = len(key_hex)
    return ''.join(format(int(data_hex[i], 16) ^ int(key_hex[i % k], 16), 'x')
                   for i in range(len(data_hex)))

def xor_append(s, key1):        # d0.a.a 2-arg: XOR s[1:] with nibble key1, append key1
    out = ''.join(format(int(c, 16) ^ int(key1, 16), 'x') for c in s[1:])
    return out + key1

def derive_xor(key_full, slice_len, rot_char, data_hex):  # d0.a.a 4-arg
    base = key_full[:slice_len]
    n = int(rot_char, 16) % len(base)
    rk = base[n:] + base[:n]
    return xor_hex(data_hex, rk)

# ─────────── field encoder (mirror z.<init> normalization + b0.a switch) ───────────
def encode_field(idx, value, vtype):
    """Returns the hex for one fingerprint field. vtype is the INTERNAL type 1..8.
       z.<init> normalization is applied first; b0.a switch picks the encoding."""
    # --- normalize (z.<init>) ---
    if value is None:
        ctype = 1
    elif vtype == 7 and float(value) > 25.5:
        ctype = 6
        value = round(float(value))
    elif vtype == 6 and int(value) < 0:
        ctype = 6
        value = 0
    elif vtype == 7 and float(value) < 0:
        ctype = 7
        value = 0.0
    else:
        ctype = vtype
    # --- header byte: z.a() = y.a(((idx&31)<<3) | ((ctype-1)&7)) ---
    hdr = ya(((idx & 31) << 3) | ((ctype - 1) & 7))
    wire = ctype - 1
    if wire in (0, 1, 2):                         # UNK / bool / no-value
        return hdr
    if wire == 3:                                 # type4: header + 1 byte int
        return hdr + ya(int(value))
    if wire == 4:                                 # type5: SBA = header + len + utf8
        b = utf8_ints(str(value), 255)
        return hdr + ya(len(b)) + b.hex()
    if wire == 5:                                 # type6: B2H_WITH_CHECKS
        v = int(value)
        return hdr + (ya_n((v & 0x7fff) | 0x8000, 2) if v > 127 else ya(v))
    if wire == 6:                                 # type7: B2H_ROUNDED (*10)
        return hdr + ya(round(float(value) * 10))
    if wire == 7:                                 # type8: JUST_APPEND (value already hex)
        return hdr + str(value)
    raise ValueError(f"bad wire {wire}")

def encode_ua_field(idx, ua):
    """field 24: y.a(i7) + y.a(len,i7) + hex(utf8(UA, 1024))  (type 8)."""
    b = utf8_ints(ua, 1024)
    n = len(b)
    i7 = 0
    tmp = n
    while tmp != 0:
        tmp >>= 8
        i7 += 1
    val = ya(i7) + ya_n(n, i7) + b.hex()
    return encode_field(idx, val, 8)

def build_section(fields):
    """fields: list of (idx, value, vtype) or ('UA', idx, ua_string). Returns (hex, count)."""
    parts = []
    for f in fields:
        if f[0] == 'UA':
            parts.append(encode_ua_field(f[1], f[2]))
        else:
            parts.append(encode_field(*f))
    return ''.join(parts), len(fields)

# ─────────── token assembly (mirror u.g) ───────────
def assemble_token(pk, uuid_hex, version_hex, fp_main_hex, fp_main_size,
                   b_part_hex, b_part_size, b_index, motion_hex,
                   time_s, nibble=None, rand_byte=None, string2_hex=None):
    if nibble is None:
        nibble = format(random.randint(0, 15), 'x')
    if rand_byte is None:
        rand_byte = random.randint(0, 255)
    part_hdr = ya((fp_main_size & 31) | 64)                       # strA2, e()==2 branch
    b_hdr = ya((b_part_size & 31) | ((b_index & 7) << 5))
    fp_hex = part_hdr + fp_main_hex + b_hdr + b_part_hex + motion_hex + "ff"
    if string2_hex is None:
        last3 = int(str(time_s)[-3:])
        string2_hex = xor_append(q_time(time_s), nibble) + xor_append(ya_n(last3, 2), nibble)
    strA4 = derive_xor(string2_hex, 4, string2_hex[3], fp_hex)
    uuid_layer = derive_xor(uuid_hex, 8, uuid_hex[9], string2_hex + strA4)
    str4 = "0a" + ya_str(pk[3:]) + version_hex + uuid_hex + uuid_layer
    len_hex = ya(len(str4) & 0xff)
    rand_hex = ya(rand_byte)
    body = xor_hex(str4 + len_hex, rand_hex)
    final = yc(rand_hex + body)
    return base64.urlsafe_b64encode(final).rstrip(b"=").decode(), fp_hex

# ─────────── token decode (recover per-call randoms from a real token) ───────────
def decode_for_reassembly(token):
    raw = base64.urlsafe_b64decode(token + "=" * (-len(token) % 4))
    rand_byte = raw[0]
    body = bytes(b ^ rand_byte for b in raw[1:])
    str4_bytes = body[:-1]
    str4_hex = str4_bytes.hex()
    pk = "pk_" + str4_bytes[1:33].decode('latin1')
    version_hex = str4_bytes[33:35].hex()
    uuid_hex = str4_bytes[35:51].hex()
    uuid_layer_hex = str4_bytes[51:].hex()
    inner = derive_xor(uuid_hex, 8, uuid_hex[9], uuid_layer_hex)
    string2_hex = inner[:12]
    return dict(rand_byte=rand_byte, pk=pk, version_hex=version_hex,
                uuid_hex=uuid_hex, string2_hex=string2_hex)

# ─────────── verification harness ───────────
# f.a() 24 fields (stable for this device/session). idx24 = UA. Values from frida z-hook.
UA = "DailyPay/48.0.0 (510250072) (Castle 3.1.1; Android 13; Xiaomi MI 9)"
F_FIELDS = [
    (0, 0, 4), (1, "Xiaomi", 5), (2, "zh-CN", 5), (3, 7.270992279052734, 7),
    (4, "8188831e", 8), (5, 9, 6), (6, 0, 6), (7, 2.75, 7), (8, "e000", 8),
    (9, "MI 9", 5), (10, "0a03fe", 8), (11, "13", 5), (12, "Android", 5),
    (13, "", 5), (14, "cn", 5), (15, "DailyPay", 5), (17, "48.0.0", 5),
    (18, 100, 6), (19, 1, 4), ('UA', 24, UA), (25, 1, 4),
    (26, "Asia/Shanghai", 5), (27, "zh-CN", 5), (31, "0eab6764", 8),
]

# r.a() 14 example fields (device-dependent; placeholders for a stationary device)
R_FIELDS = [
    (0, "1451", 5), (1, None, 5), (2, None, 5), (3, "4294", 5), (4, 1, 4),
    (5, 34, 6), (6, 4439, 6), (7, "Li-poly", 5), (8, 5, 6), (9, None, 6),
    (10, 30, 6), (11, False, 2), (12, "arm64-v8a", 5), (13, "2.1.0", 5),
]

def verify():
    """Self-contained round-trip: build a token from EXAMPLE device fields with a
    PLACEHOLDER pk, then decode it back and assert internal consistency. No real
    token/credential is shipped (the byte-exact-vs-real-token proof is recorded in the
    case's report.md, done live during the DailyPay engagement)."""
    import os as _os
    PK = "pk_" + "A" * 32                      # placeholder publishable key (len 35)
    uuid_hex = _os.urandom(16).hex()
    version_hex = "5041"                        # -> 3.1.1
    motion_hex = "10dd" + "00" * 885            # stationary device (sensors ~0)

    print("=== build fingerprint sections from raw device fields ===")
    fp_main, fp_n = build_section(F_FIELDS)
    b_part, b_n = build_section(R_FIELDS)
    print(f"  f.a() {fp_n} fields -> {len(fp_main)//2} bytes : {fp_main[:60]}…")
    print(f"  r.a() {b_n} fields -> {len(b_part)//2} bytes : {b_part[:60]}…")

    print("\n=== generate a fresh token, then decode it back (round-trip) ===")
    tok, fp_hex = assemble_token(PK, uuid_hex, version_hex, fp_main, fp_n,
                                 b_part, b_n, 6, motion_hex, time_s=1781200000)
    d = decode_for_reassembly(tok)
    # peel both layers to recover fp_main from the token
    raw = base64.urlsafe_b64decode(tok + "=" * (-len(tok) % 4))
    str4 = bytes(x ^ raw[0] for x in raw[1:])[:-1]
    inner = derive_xor(d['uuid_hex'], 8, d['uuid_hex'][9], str4[51:].hex())
    fp_back = derive_xor(inner[:12], 4, inner[:12][3], inner[12:])
    fp_main_back = fp_back[2:2 + len(fp_main)]      # skip the 0x58 part header

    ok_pk = d['pk'] == PK
    ok_ver = d['version_hex'] == version_hex
    ok_uuid = d['uuid_hex'] == uuid_hex
    ok_fp = fp_main_back == fp_main
    print(f"  token ({len(tok)} chars): {tok[:64]}…")
    print(f"  decode-back pk      == placeholder : {'✅' if ok_pk else '❌'}")
    print(f"  decode-back version -> 3.1.1       : {'✅' if ok_ver else '❌'}")
    print(f"  decode-back uuid                   : {'✅' if ok_uuid else '❌'}")
    print(f"  decode-back fp_main == built (BYTE-EXACT round-trip): {'✅' if ok_fp else '❌'}")
    ok = ok_pk and ok_ver and ok_uuid and ok_fp
    print(f"\nRESULT: generator <-> decoder round-trip {'OK' if ok else 'FAIL'}")
    return ok

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "verify":
        sys.exit(0 if verify() else 1)
    print("usage: gen_v311.py verify   (self-contained round-trip self-test)")
