// hook_appsecret.js
// =================
// Dump the Bilibili appSecret by reading FUN_00118ff0's 4th argument
// (the 4 uint32 secret words) in libbili.so.
//
//   Ghidra address 0x118ff0, Ghidra load base 0x100000
//   file offset    = 0x118ff0 - 0x100000 = 0x18ff0
//   runtime addr   = libbili.so base + 0x18ff0
//
// Run in spawn mode with bypass.js, then trigger any signed API call
// (e.g. post a comment) to fire the hook.
//
//   frida -U -f tv.danmaku.bili -l bypass.js -l hook_appsecret.js
//
// Expected output: appSecret = 560c52ccd288fed045859ed18bffd973

var FILE_OFFSET = 0x18ff0;

function toHex8(n) {
    return ('00000000' + (n >>> 0).toString(16)).slice(-8);
}

function hookMd5Func(libbiliBase) {
    var targetAddr = libbiliBase.add(FILE_OFFSET);
    console.log("[+] FUN_00118ff0 runtime address: " + targetAddr);

    Interceptor.attach(targetAddr, {
        onEnter: function (args) {
            // args[0] = output buffer
            // args[1] = sorted_params string pointer
            // args[2] = string length
            // args[3] = pointer to 4 uint32 words (the appSecret)

            try {
                var len = args[2].toInt32();
                var paramStr = args[1].readUtf8String(Math.min(len, 500));
                console.log("\n[+] FUN_00118ff0 called");
                console.log("[*] sorted_params (" + len + "B): " + paramStr);
            } catch (e) {
                console.log("[*] failed to read sorted_params: " + e);
            }

            try {
                var v0 = args[3].readU32();
                var v1 = args[3].add(4).readU32();
                var v2 = args[3].add(8).readU32();
                var v3 = args[3].add(12).readU32();

                var appSecret = toHex8(v0) + toHex8(v1) + toHex8(v2) + toHex8(v3);
                console.log("[!!!] appSecret = " + appSecret);
            } catch (e) {
                console.log("[*] failed to read appSecret: " + e);
            }
        }
    });

    console.log("[+] Hook attached. Trigger a signed request (e.g. a comment)...");
}

// ── Wait for libbili.so to load ────────────────────────────────────────────
var hooked = false;
function tryHook() {
    if (hooked) return;
    var mod = Process.findModuleByName("libbili.so");
    if (!mod) return;
    hooked = true;
    console.log("[+] libbili.so base: " + mod.base);
    hookMd5Func(mod.base);
}

tryHook();
var count = 0;
var poller = setInterval(function () {
    tryHook();
    if (++count >= 30) clearInterval(poller);
}, 500);

console.log("[*] hook_appsecret.js ready");
