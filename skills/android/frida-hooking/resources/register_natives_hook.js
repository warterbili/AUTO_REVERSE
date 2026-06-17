/**
 * Template for tracking JNI RegisterNatives calls.
 * This is crucial for finding the native implementation of Java methods
 * when they are not statically exported (i.e., NO "Java_..." prefix).
 */

function hook_register_natives() {
    var registerNativesAddr = null;

    // Find RegisterNatives in JNIEnv vtable
    // Standard JNIEnv* struct layout
    var env = Java.vm.getEnv();
    var handle = env.handle;
    var vtable = handle.readPointer();
    // RegisterNatives is usually at index 215 for 64-bit arm
    // But it's safer to use symbolic search if possible or architecture detection
    var offset = Process.pointerSize === 8 ? 215 * 8 : 215 * 4;
    registerNativesAddr = vtable.add(offset).readPointer();

    console.log("[RegisterNatives] Found at " + registerNativesAddr);

    Interceptor.attach(registerNativesAddr, {
        onEnter: function (args) {
            var env = args[0];
            var clazz = args[1];
            var methods = args[2];
            var nMethods = args[3].toInt32();

            var className = Java.vm.getEnv().getClassName(clazz);
            console.log("[RegisterNatives] java_class: " + className + " nMethods: " + nMethods);

            for (var i = 0; i < nMethods; i++) {
                var namePtr = methods.add(i * Process.pointerSize * 3).readPointer();
                var sigPtr = methods.add(i * Process.pointerSize * 3 + Process.pointerSize).readPointer();
                var fnPtr = methods.add(i * Process.pointerSize * 3 + Process.pointerSize * 2).readPointer();

                var name = namePtr.readUtf8String();
                var sig = sigPtr.readUtf8String();

                var module = Process.findModuleByAddress(fnPtr);
                var logMsg = "[RegisterNatives] name: " + name + " sig: " + sig + " fnPtr: " + fnPtr;
                if (module) {
                    logMsg += " (" + module.name + "!" + fnPtr.sub(module.base) + ")";
                }
                console.log(logMsg);
            }
        }
    });
}

Java.perform(function () {
    hook_register_natives();
});
