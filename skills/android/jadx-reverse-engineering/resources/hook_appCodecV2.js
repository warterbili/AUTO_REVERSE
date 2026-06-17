// ============================================================================
// Frida hook template: dump the input arguments and return-value fields of a signing/encryption method
// ----------------------------------------------------------------------------
// This is a generic template. Before using it, replace the placeholders below with the real class/method names of your target app:
//   - TARGET_PKG            the package the target class lives in (e.g. com.example.app.security)
//   - AppPlayer / AppInfo / SupportCodeResponse
//                           replace with the real class names in the target app that hold the signing method and the data models
//   - appCodecV2            replace with the name of the target method you want to hook (the signing/encryption entry point)
//   - (context, appInfo, scopeId)
//                           replace with the real parameter list of the target method
// Use jadx / objection to locate the target class and method first, then fill in the names.
// The hook logic in this template (reflectively dumping fields, calling the original method, printing the return value) stays the same and can be reused as-is.
// ============================================================================
Java.perform(function () {
    // TODO: replace TARGET_PKG and the class names with the real package / class names of the target app
    var TARGET_PKG = "com.example.app";
    var AppPlayer = Java.use(TARGET_PKG + ".AppPlayer");             // the class holding the signing method
    var AppInfo = Java.use(TARGET_PKG + ".AppInfo");                 // input-argument data model
    var SupportCodeResponse = Java.use(TARGET_PKG + ".SupportCodeResponse"); // return-value data model
    var Log = Java.use("android.util.Log");
    var Exception = Java.use("java.lang.Exception");

    // Helper function to dump object fields using reflection
    function dumpFields(obj, className) {
        var output = "";
        try {
            var clazz = obj.getClass();
            var fields = clazz.getDeclaredFields();
            output += "Dump of " + className + ":\n";
            for (var i = 0; i < fields.length; i++) {
                var field = fields[i];
                field.setAccessible(true);
                var name = field.getName();
                var value = field.get(obj);
                output += "  " + name + " = " + value + "\n";
            }
        } catch (e) {
            output += "  Error dumping fields: " + e + "\n";
        }
        return output;
    }

    // Hook the target method (replace appCodecV2 with the real method name of the target app, and match the parameter list accordingly)
    AppPlayer.appCodecV2.implementation = function (context, appInfo, scopeId) {
        console.log("\n==================================================");
        console.log("[*] AppPlayer.appCodecV2 called");
        console.log("==================================================");

        // 1. Print p2 (scopeId)
        console.log("[+] p2 (Scope ID): " + scopeId);

        // 2. Print p1 (AppInfo) fields
        if (appInfo != null) {
            console.log(dumpFields(appInfo, "AppInfo (p1)"));
        } else {
            console.log("[!] AppInfo (p1) is null");
        }

        // Call original method
        var retval = this.appCodecV2(context, appInfo, scopeId);

        // 3. Print Return Value (SupportCodeResponse) fields (X-E1, 2, 3 candidates)
        if (retval != null) {
            console.log(dumpFields(retval, "SupportCodeResponse (Return Value)"));

            // Try to map to X-E headers based on method names if possible (best guess)
            // Based on typical naming: 
            // getSignature -> X-E1?
            // getSignatureId -> X-E2?
            // getUniqueId -> X-E3?
            // We print everything so the user can correlate with captured traffic.

        } else {
            console.log("[!] Return value is null");
        }

        console.log("==================================================\n");
        return retval;
    };

    console.log("[*] Hook for AppPlayer.appCodecV2 installed.");
});
