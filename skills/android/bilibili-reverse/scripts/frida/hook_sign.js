// hook_sign.js
// ============
// Recover libbili.so's dynamically-registered native functions by hooking
// art::ClassLinker::RegisterNative. Pure native hook, no Java.perform.
//
// Bilibili binds JNI methods via RegisterNatives inside JNI_OnLoad (no Java_*
// exports). art::ClassLinker::RegisterNative(ClassLinker*, Thread*, ArtMethod*,
// void* fnPtr) is called once per method, with args[3] = the real .so function
// pointer. We filter args[3] to addresses inside libbili.so and record offsets.
//
//   frida -U -f tv.danmaku.bili -l bypass.js -l hook_sign.js
//
// Then trigger actions and watch which offset fires. Cross-check candidates in
// Ghidra: the sign entry is FUN_00109050 (+0x9050, params: JNIEnv*, jclass,
// jobject SortedMap) whose chain reaches MD5_Init/Update/Final.

var libbiliBase = null;
var libbiliSize = 0;
var capturedFuncs = [];

function getLibbiliRange() {
    var mod = Process.findModuleByName("libbili.so");
    if (!mod) return false;
    libbiliBase = mod.base;
    libbiliSize = mod.size;
    console.log("[+] libbili.so range: " + libbiliBase + " ~ " + libbiliBase.add(libbiliSize));
    return true;
}

function inLibbili(addr) {
    if (!libbiliBase) return false;
    return addr.compare(libbiliBase) >= 0 &&
           addr.compare(libbiliBase.add(libbiliSize)) < 0;
}

var libart = Process.findModuleByName("libart.so");
var regNativeAddr = null;
libart.enumerateExports().forEach(function (e) {
    if (e.name === "_ZN3art11ClassLinker14RegisterNativeEPNS_6ThreadEPNS_9ArtMethodEPKv") {
        regNativeAddr = e.address;
    }
});

if (!regNativeAddr) {
    console.log("[-] RegisterNative not found");
} else {
    console.log("[+] RegisterNative @ " + regNativeAddr);

    Interceptor.attach(regNativeAddr, {
        onEnter: function (args) {
            var fnPtr = args[3];
            if (!libbiliBase) getLibbiliRange();
            if (libbiliBase && inLibbili(fnPtr)) {
                var offset = fnPtr.sub(libbiliBase);
                console.log("[+] libbili.so native registered: fnPtr=" + fnPtr +
                            " offset=+0x" + offset.toString(16));
                capturedFuncs.push(fnPtr);
            }
        }
    });

    console.log("[+] RegisterNative hooked, waiting for libbili.so registrations...");
}

// ── After 15s, attach to every captured function ───────────────────────────
setTimeout(function () {
    if (capturedFuncs.length === 0) {
        console.log("[-] No libbili.so native methods captured");
        return;
    }

    console.log("\n[*] Captured " + capturedFuncs.length + " native methods, attaching...");
    capturedFuncs.forEach(function (addr, i) {
        var offset = addr.sub(libbiliBase);
        try {
            Interceptor.attach(addr, {
                onEnter: function () {
                    console.log("\n>>> method #" + i + " called! addr=" + addr +
                                " offset=+0x" + offset.toString(16));
                },
                onLeave: function (retval) {
                    console.log("<<< method #" + i + " returned: " + retval);
                }
            });
            console.log("  [+] #" + i + " attached: " + addr + " (+0x" + offset.toString(16) + ")");
        } catch (e) {
            console.log("  [-] #" + i + " attach failed: " + e);
        }
    });

    console.log("\n[*] Now trigger an action and see which method fires...");
}, 15000);

console.log("[*] hook_sign.js ready");
