// bypass.js
// =========
// Defeat Bilibili's libmsaoaidsec.so anti-Frida detection (v7.76.0+).
//
// libmsaoaidsec.so dlsym()s pthread_create and spawns a detection thread that
// scans /proc/self/maps (for "frida"), /proc/self/status (TracerPid), and
// libart.so pointers. We hook dlsym and, when libmsaoaidsec.so requests
// pthread_create/pthread_join, return a no-op stub so the thread never starts.
//
// LOAD THIS FIRST, in spawn mode:
//   frida -U -f tv.danmaku.bili -l bypass.js -l ssl_hook.js
//
// Key fix: Module.findExportByName() returns a PLT stub that CANNOT be hooked.
//          Use enumerateExports() to get dlsym's REAL address.

var fakeFunc = new NativeCallback(function () {
    console.log("[+] fake pthread_create called, suppressed");
    return 0;
}, 'int', ['pointer', 'pointer', 'pointer', 'pointer']);
console.log("[*] Fake function @ " + fakeFunc);

function findDlsymReal() {
    var libdl = Process.findModuleByName("libdl.so");
    if (!libdl) { console.log("[-] libdl.so not found"); return null; }
    var addr = null;
    libdl.enumerateExports().forEach(function (exp) {
        if (exp.name === "dlsym") addr = exp.address;
    });
    return addr;
}

var dlsymAddr = findDlsymReal();
if (!dlsymAddr) {
    console.log("[-] dlsym not found, abort");
} else {
    console.log("[+] dlsym real address: " + dlsymAddr);
    try {
        Interceptor.attach(dlsymAddr, {
            onEnter: function (args) {
                try {
                    this.symbol = args[1].isNull() ? "" : args[1].readCString();
                } catch (e) { this.symbol = ""; }
            },
            onLeave: function (retval) {
                if (this.symbol === "pthread_create" || this.symbol === "pthread_join") {
                    try {
                        var mod = Process.findModuleByAddress(this.returnAddress);
                        if (mod && mod.name.indexOf("msaoaidsec") !== -1) {
                            console.log("[+] Blocked dlsym(\"" + this.symbol + "\") from " + mod.name);
                            retval.replace(fakeFunc);
                        }
                    } catch (e) { console.log("[-] handler error: " + e); }
                }
            }
        });
        console.log("[+] dlsym hooked successfully");
    } catch (e) {
        console.log("[-] Failed to hook dlsym: " + e);
    }
}

console.log("[*] bypass ready");
