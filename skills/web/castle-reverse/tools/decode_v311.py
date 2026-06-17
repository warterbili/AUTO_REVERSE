#!/usr/bin/env python3
"""
Castle.io v3.1.1 (Highwind / Android) token decoder + verifier.
Self-derived from io.castle.highwind.android DEX (DailyPay v48.0.0). NO XXTEA.

Token (hex-string assembly):
  final = base64url( unhex( randByteHex + xorHex(str4Hex + lenHex, randByteHex) ) )
  str4Hex = "0a" + hex(pk[3:]) + versionHex(2B) + uuidHex(16B) + uuidLayerHex
  uuidLayerHex = xorHex( string2Hex + strA4Hex , rotate(uuidHex[:8], uuidHex[9]) )
  strA4Hex     = xorHex( fpHex , rotate(string2Hex[:4], string2Hex[3]) )
  fpHex = partHdr(1B) + fpMain.data + [bPartHdr + bPart.data] + motion + "ff"
"""
import base64, binascii, sys

def b64url_decode(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))

def to_hex(b): return binascii.hexlify(b).decode()
def from_hex(h): return binascii.unhexlify(h)

def xor_hex(data_hex, key_hex):
    """nibble-wise XOR of two hex strings, key cycled (== q.a.a / d0.a 1-arg core)."""
    out = []
    k = len(key_hex)
    for i, ch in enumerate(data_hex):
        out.append(format(int(ch, 16) ^ int(key_hex[i % k], 16), 'x'))
    return ''.join(out)

def rotate(s, rot_char):
    """rotate first len(s) chars by int(rot_char,16) % len(s) (== d0.a 4-arg key rotation)."""
    n = int(rot_char, 16) % len(s)
    return s[n:] + s[:n]

def derive_unxor(out_hex, key_full_hex, slice_len, rot_char):
    rk = rotate(key_full_hex[:slice_len], rot_char)
    return xor_hex(out_hex, rk)

def decode(token, captured_fp_hex=None):
    raw = b64url_decode(token)
    rand_byte = raw[0]
    rand_hex = format(rand_byte, '02x')
    body = bytes(b ^ rand_byte for b in raw[1:])      # = str4_bytes + lenByte
    str4_bytes, len_byte = body[:-1], body[-1]
    str4_hex = to_hex(str4_bytes)
    expected_len = (len(str4_hex)) & 0xff
    print(f"randByte          = 0x{rand_hex}")
    print(f"len check         = appended 0x{len_byte:02x} vs (len(str4Hex)&0xff) 0x{expected_len:02x} -> "
          + ("OK" if len_byte == expected_len else "MISMATCH"))

    # parse str4
    lead = str4_bytes[0]
    pk_body = str4_bytes[1:33].decode('latin1')        # 32 ascii chars
    version_bytes = str4_bytes[33:35]
    uuid_bytes = str4_bytes[35:51]
    uuid_hex = to_hex(uuid_bytes)
    uuid_layer_bytes = str4_bytes[51:]
    uuid_layer_hex = to_hex(uuid_layer_bytes)
    print(f"lead byte         = 0x{lead:02x} (expect 0x0a)")
    print(f"publishable key   = pk_{pk_body[:4]}…{pk_body[-2:]}  (len {3+len(pk_body)})  [DESENSITIZED]")
    print(f"version bytes     = {to_hex(version_bytes)}  -> {decode_version(version_bytes)}")
    print(f"uuid / cuid       = {uuid_hex[:8]}…{uuid_hex[-4:]}  [DESENSITIZED]")

    # peel uuid layer:  inner = string2Hex(12) + strA4Hex
    inner_hex = derive_unxor(uuid_layer_hex, uuid_hex, 8, uuid_hex[9])
    string2_hex, strA4_hex = inner_hex[:12], inner_hex[12:]
    print(f"string2 (time)    = {string2_hex}  -> unixSecs {decode_time(string2_hex)}")

    # peel time layer:  fpHex = derive_unxor(strA4, string2, 4, string2[3])
    fp_hex = derive_unxor(strA4_hex, string2_hex, 4, string2_hex[3])
    part_hdr = fp_hex[:2]
    print(f"fp part header    = {part_hdr} (idx {int(part_hdr,16)>>3}, type {int(part_hdr,16)&7})")
    print(f"fp section (head) = {fp_hex[:80]}…")
    print(f"fp section (tail) = …{fp_hex[-40:]}  (expect …ff terminator region)")

    if captured_fp_hex:
        idx = fp_hex.find(captured_fp_hex)
        print(f"\n[VERIFY] hooked f.a() fp.data length = {len(captured_fp_hex)//2} bytes")
        if idx >= 0:
            print(f"[VERIFY] ✅ f.a() output found INSIDE decoded token at hex offset {idx} "
                  f"(byte {idx//2}) — full algorithm chain CONFIRMED.")
        else:
            print("[VERIFY] ❌ f.a() output NOT found verbatim — investigate field-order/offset.")
    return fp_hex

def decode_version(b):
    v = int.from_bytes(b, 'big')
    patch = v & 0x3f; minor = (v >> 6) & 0x1f; major = ((v >> 11) & 3) + 1
    return f"{major}.{minor}.{patch} (n={v>>13})"

def decode_time(string2_hex):
    # string2 = xor_and_append(4B time, nibble) + xor_and_append(2B slice, nibble)
    # first 8 hex = time section: nibbles[0..6] xored with appended nibble[7]
    sec = string2_hex[:8]
    nib = sec[7]
    t_hex = ''.join(format(int(c, 16) ^ int(nib, 16), 'x') for c in sec[:7])
    t = int('0' + t_hex, 16)
    return t + 1535000000

if __name__ == "__main__":
    tok = open(sys.argv[1]).read().splitlines()[0] if len(sys.argv) > 1 else input("token: ")
    cap = None
    if len(sys.argv) > 2:
        cap = open(sys.argv[2]).read().strip()
    decode(tok, cap)
