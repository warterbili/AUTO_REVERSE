Java.perform(function () {
    const System = Java.use('java.lang.System');
    const Runtime = Java.use('java.lang.Runtime');
    const Log = Java.use("android.util.Log");
    const Exception = Java.use("java.lang.Exception");

    // Template: fill in fragments of the target .so name (use jadx/objection first to confirm the target library name).
    // On a match, also print the load stack trace to help locate the native load point. Leave empty to print every loadLibrary call.
    const TARGET_LIB_HINTS = []; // e.g. ["libtarget", "libsign"]

    function logStackTrace() {
        return Log.getStackTraceString(Exception.$new());
    }

    function isTarget(library) {
        return TARGET_LIB_HINTS.length === 0 ||
               TARGET_LIB_HINTS.some(function (h) { return library.indexOf(h) !== -1; });
    }

    // Hook System.loadLibrary (Entry point for normal loading)
    try {
        System.loadLibrary.implementation = function (library) {
            console.log("\n[+] System.loadLibrary('" + library + "')");
            if (isTarget(library)) {
                console.log("[!] Target library load attempt! Stack trace:");
                console.log(logStackTrace());
            }
            return this.loadLibrary(library);
        };
    } catch (e) {
        console.log("[-] Failed to hook System.loadLibrary: " + e);
    }

    // Hook Runtime.loadLibrary0 (All identified overloads)
    const loadLibrary0_overloads = Runtime.loadLibrary0.overloads;
    loadLibrary0_overloads.forEach(function (overload) {
        overload.implementation = function () {
            // Check arguments for library name
            for (let i = 0; i < arguments.length; i++) {
                if (typeof arguments[i] === 'string') {
                    console.log("\n[+] Runtime.loadLibrary0(..., '" + arguments[i] + "')");
                }
            }
            return this.apply(this, arguments);
        };
    });

    // Hook System.load (Absolute path loading)
    try {
        System.load.implementation = function (path) {
            console.log("\n[+] System.load('" + path + "')");
            return this.load(path);
        };
    } catch (e) {
        console.log("[-] Failed to hook System.load: " + e);
    }

    // Hook Runtime.load0 (All overloads to be safe)
    const load0_overloads = Runtime.load0.overloads;
    load0_overloads.forEach(function (overload) {
        overload.implementation = function () {
            for (let i = 0; i < arguments.length; i++) {
                if (typeof arguments[i] === 'string') {
                    console.log("\n[+] Runtime.load0(..., '" + arguments[i] + "')");
                }
            }
            return this.apply(this, arguments);
        };
    });

    console.log("[*] Library Load Hooks Installed");
});
