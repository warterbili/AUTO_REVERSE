/**
 * Generic Interceptor Template
 * Use this to hook native functions by name or address.
 */

function hook_native(moduleName, symbolName, offset) {
    var addr = null;
    if (symbolName) {
        addr = Process.findModuleByName(moduleName).findExportByName(symbolName).base;
    } else if (offset) {
        var base = Process.findModuleByName(moduleName).base;
        if (base) {
            addr = base.add(offset);
        }
    }

    if (!addr || addr.isNull()) {
        console.error("Could not find target address");
        return;
    }

    console.log("Hooking native function at: " + addr);

    Interceptor.attach(addr, {
        onEnter: function (args) {
            this.args = [];
            // Change 4 to the number of expected arguments
            for (var i = 0; i < 4; i++) {
                this.args.push(args[i]);
            }
            console.log("onEnter: " + symbolName);
            // console.log(hexdump(args[0]));
        },
        onLeave: function (retval) {
            console.log("onLeave: " + symbolName + " -> " + retval);
        }
    });
}

// Example usage:
// hook_native("libc.so", "open");
// hook_native("libtarget.so", null, 0x1234);
