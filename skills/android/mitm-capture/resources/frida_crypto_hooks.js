/**
 * Frida Crypto Hook Template — companion to mitm-capture
 *
 * Hooks common Android crypto APIs to intercept encryption/signing
 * operations detected by MITM capture's crypto detector.
 *
 * Usage:
 *   frida -U -f <package> -l frida_crypto_hooks.js --no-pause
 *
 * Covers:
 *   - javax.crypto.Mac (HMAC signing)
 *   - java.security.MessageDigest (MD5/SHA hashing)
 *   - android.util.Base64 (encoding/decoding)
 *   - javax.crypto.Cipher (AES/DES encryption)
 *   - javax.crypto.spec.SecretKeySpec (key material)
 */

'use strict';

function bytesToHex(bytes) {
    var hex = '';
    for (var i = 0; i < bytes.length; i++) {
        var b = (bytes[i] & 0xff).toString(16);
        hex += (b.length === 1 ? '0' : '') + b;
    }
    return hex;
}

function bytesToUtf8(bytes) {
    try {
        var JavaString = Java.use('java.lang.String');
        return JavaString.$new(bytes, 'UTF-8');
    } catch (e) {
        return '[binary ' + bytes.length + ' bytes]';
    }
}

Java.perform(function () {
    console.log('[*] Crypto hooks loaded');

    // ========================================
    // 1. javax.crypto.Mac — HMAC
    // ========================================
    try {
        var Mac = Java.use('javax.crypto.Mac');

        Mac.getInstance.overload('java.lang.String').implementation = function (algorithm) {
            console.log('[Mac] getInstance: ' + algorithm);
            return this.getInstance(algorithm);
        };

        Mac.init.overload('java.security.Key').implementation = function (key) {
            var keyBytes = key.getEncoded();
            console.log('[Mac] init with key: ' + bytesToHex(keyBytes));
            console.log('[Mac]   key (UTF-8): ' + bytesToUtf8(keyBytes));
            return this.init(key);
        };

        Mac.doFinal.overload('[B').implementation = function (input) {
            console.log('[Mac] doFinal input: ' + bytesToUtf8(input));
            var result = this.doFinal(input);
            console.log('[Mac] doFinal output: ' + bytesToHex(result));
            return result;
        };

        Mac.doFinal.overload().implementation = function () {
            var result = this.doFinal();
            console.log('[Mac] doFinal output: ' + bytesToHex(result));
            return result;
        };
    } catch (e) {
        console.log('[Mac] Hook failed: ' + e);
    }

    // ========================================
    // 2. java.security.MessageDigest — MD5/SHA
    // ========================================
    try {
        var MessageDigest = Java.use('java.security.MessageDigest');

        MessageDigest.getInstance.overload('java.lang.String').implementation = function (algorithm) {
            console.log('[MessageDigest] getInstance: ' + algorithm);
            return this.getInstance(algorithm);
        };

        MessageDigest.update.overload('[B').implementation = function (input) {
            console.log('[MessageDigest] update: ' + bytesToUtf8(input));
            return this.update(input);
        };

        MessageDigest.digest.overload().implementation = function () {
            var result = this.digest();
            console.log('[MessageDigest] digest: ' + bytesToHex(result));
            return result;
        };

        MessageDigest.digest.overload('[B').implementation = function (input) {
            console.log('[MessageDigest] digest input: ' + bytesToUtf8(input));
            var result = this.digest(input);
            console.log('[MessageDigest] digest output: ' + bytesToHex(result));
            return result;
        };
    } catch (e) {
        console.log('[MessageDigest] Hook failed: ' + e);
    }

    // ========================================
    // 3. android.util.Base64
    // ========================================
    try {
        var Base64 = Java.use('android.util.Base64');

        Base64.encodeToString.overload('[B', 'int').implementation = function (input, flags) {
            var result = this.encodeToString(input, flags);
            console.log('[Base64] encode input: ' + bytesToUtf8(input));
            console.log('[Base64] encode output: ' + result.trim());
            return result;
        };

        Base64.decode.overload('java.lang.String', 'int').implementation = function (str, flags) {
            console.log('[Base64] decode input: ' + str.substring(0, Math.min(str.length, 200)));
            var result = this.decode(str, flags);
            console.log('[Base64] decode output: ' + bytesToUtf8(result));
            return result;
        };
    } catch (e) {
        console.log('[Base64] Hook failed: ' + e);
    }

    // ========================================
    // 4. javax.crypto.Cipher — AES/DES
    // ========================================
    try {
        var Cipher = Java.use('javax.crypto.Cipher');

        Cipher.getInstance.overload('java.lang.String').implementation = function (transformation) {
            console.log('[Cipher] getInstance: ' + transformation);
            return this.getInstance(transformation);
        };

        Cipher.init.overload('int', 'java.security.Key').implementation = function (opmode, key) {
            var mode = opmode === 1 ? 'ENCRYPT' : opmode === 2 ? 'DECRYPT' : 'mode=' + opmode;
            var keyBytes = key.getEncoded();
            console.log('[Cipher] init ' + mode);
            console.log('[Cipher]   key: ' + bytesToHex(keyBytes));
            return this.init(opmode, key);
        };

        Cipher.doFinal.overload('[B').implementation = function (input) {
            console.log('[Cipher] doFinal input (' + input.length + ' bytes): ' + bytesToHex(input).substring(0, 100));
            var result = this.doFinal(input);
            console.log('[Cipher] doFinal output (' + result.length + ' bytes): ' + bytesToHex(result).substring(0, 100));
            return result;
        };
    } catch (e) {
        console.log('[Cipher] Hook failed: ' + e);
    }

    // ========================================
    // 5. javax.crypto.spec.SecretKeySpec — Key Material
    // ========================================
    try {
        var SecretKeySpec = Java.use('javax.crypto.spec.SecretKeySpec');

        SecretKeySpec.$init.overload('[B', 'java.lang.String').implementation = function (key, algorithm) {
            console.log('[SecretKeySpec] new key for ' + algorithm);
            console.log('[SecretKeySpec]   key hex: ' + bytesToHex(key));
            console.log('[SecretKeySpec]   key UTF-8: ' + bytesToUtf8(key));
            return this.$init(key, algorithm);
        };
    } catch (e) {
        console.log('[SecretKeySpec] Hook failed: ' + e);
    }

    console.log('[*] All crypto hooks installed');
});
