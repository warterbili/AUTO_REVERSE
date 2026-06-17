/**
 * Java Method Tracer Template
 * Use this to trace Java methods, parameters, and return values.
 */

function trace_java_method(className, methodName) {
    var target = Java.use(className);

    // Get all overloads
    var overloads = target[methodName].overloads;

    overloads.forEach(function (overload) {
        overload.implementation = function () {
            var args = [];
            for (var i = 0; i < arguments.length; i++) {
                args.push(arguments[i]);
            }

            console.log("Tracing " + className + "." + methodName + "(" + overload.argumentTypes.map(t => t.className).join(", ") + ")");
            console.log("Arguments: " + JSON.stringify(args));

            var result = overload.apply(this, arguments);

            console.log("Return Value: " + result);
            return result;
        };
    });
}

Java.perform(function () {
    // Example usage:
    // trace_java_method("com.example.TargetClass", "targetMethod");
});
