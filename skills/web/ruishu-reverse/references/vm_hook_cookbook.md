# VM Hook Handbook: 7 Proven Injection Techniques

This document records 7 VM injection techniques validated during reverse engineering of the Ruishu anti-bot system. All code has been tested in practice.

---

## A.1 vm.runInContext Interception

**Purpose**: Capture or modify code content before eval execution.

Ruishu's JS code is loaded and executed via eval. Intercepting `vm.runInContext` allows you to obtain the complete content before execution, for analysis or modification.

```javascript
const vm = require('vm');
const originalRunInContext = vm.runInContext;

vm.runInContext = function(code, context, options) {
    // Capture the $_ts init script (usually short)
    if (code.includes('$_ts')) {
        const fs = require('fs');
        fs.writeFileSync('ts_init.js', code);
        console.log('[HOOK] $_ts init script captured, length:', code.length);
    }

    // Capture the eval code (>250KB is the main business code)
    if (code.length > 250000) {
        const fs = require('fs');
        fs.writeFileSync('eval_code.js', code);
        console.log('[HOOK] eval code captured, length:', code.length);
    }

    // You can modify code here before executing it
    // code = code.replace('targetPattern', 'replacementCode');

    return originalRunInContext.call(this, code, context, options);
};
```

**Key points**:
- The `$_ts` init script contains site configuration information
- The eval code exceeding 250KB is Ruishu's core logic, containing VM bytecode and all runtime functions

---

## A.2 Object.defineProperty Cookie Hijacking

**Purpose**: Intercept writes to document.cookie and capture the value of Cookie T when it is generated.

```javascript
let cookieCache = '';

Object.defineProperty(Document.prototype, 'cookie', {
    get: function() {
        return cookieCache;
    },
    set: function(val) {
        // Capture Cookie T write
        if (val.indexOf('FSSBBIl1UgzbN7N80T=') !== -1) {
            console.log('[HOOK] Cookie T captured:', val);
        }

        // Capture Cookie S write
        if (val.indexOf('FSSBBIl1UgzbN7N80S=') !== -1) {
            console.log('[HOOK] Cookie S captured:', val);
        }

        // Maintain the cookie cache, emulating browser behavior
        const name = val.split('=')[0];
        const cookies = cookieCache.split('; ').filter(c => c && !c.startsWith(name + '='));
        // Do not cache deletion directives that carry max-age=0
        if (!val.includes('max-age=0')) {
            cookies.push(val.split(';')[0]);
        }
        cookieCache = cookies.join('; ');
    },
    configurable: true
});
```

**Key points**:
- Cookie names vary by site; `FSSBBIl1UgzbN7N80T` and `FSSBBIl1UgzbN7N80S` are common naming patterns
- cookieCache must be maintained correctly, otherwise subsequent Ruishu logic that reads cookies will misbehave
- `configurable: true` ensures it can be redefined by later code

---

## A.3 Comma Expression Injection

**Purpose**: Zero-intrusion function monitoring — insert logging without altering control flow or return values.

Property of the comma expression: it evaluates all sub-expressions in order and returns the value of the last one.

```javascript
// Original code
result = targetFunction(arg1, arg2);

// After injection (no behavior change whatsoever)
result = (console.log('[TRACE] targetFunction called:', arg1, arg2), targetFunction(arg1, arg2));
```

**Practical application: tracing VM opcode execution**

```javascript
// Call in the original VM dispatch loop
handlers[opcode](state);

// Inject monitoring
(console.log('[VM] opcode:', opcode, 'stack:', state.stack.slice(-3)), handlers[opcode](state));
```

**Advanced: bulk application during AST rewriting**

```javascript
// During AST traversal, wrap the target CallExpression in a comma expression
// Original AST node: callExpr
// Rewritten to: SequenceExpression([logExpr, callExpr])
```

**Key points**:
- Does not alter control flow or affect return values
- No need to modify function signatures or call conventions
- Suitable for bulk injection at key call sites during AST rewriting
- Minimal performance overhead — only one extra console.log

---

## A.4 Function Body Replacement

**Purpose**: Wrap a function of known signature to add monitoring logic.

```javascript
// Example: capturing the State 324 entry function
// State 324 is the key state in the Ruishu VM responsible for Cookie generation

// Locate and replace the target function within the eval code
function hookState324Entry(evalCode) {
    // Locate the target function (by structural features, not by function name)
    // Assume the function's location has been determined via AST analysis
    const pattern = /function\s+(\w+)\((\w+),\s*(\w+),\s*(\w+)\)\s*\{/;
    const match = evalCode.match(pattern);

    if (match) {
        const funcName = match[1];
        const originalBody = extractFunctionBody(evalCode, match.index);

        // Wrap the function, adding entry/exit monitoring
        const wrapped = `
function ${funcName}(${match[2]}, ${match[3]}, ${match[4]}) {
    console.log('[State324] ENTER, args:', Array.from(arguments).map(a => typeof a));
    var __result = (function(${match[2]}, ${match[3]}, ${match[4]}) {
        ${originalBody}
    }).apply(this, arguments);
    console.log('[State324] EXIT, result type:', typeof __result);
    return __result;
}`;
        return evalCode.replace(match[0] + originalBody + '}', wrapped);
    }
    return evalCode;
}
```

**WARNING**: Function names change on every load (Ruishu dynamic obfuscation); you must never rely on function names for location. You must use structural features:
- Number of parameters
- Characteristic calls within the function body
- Position within the enclosing scope
- Structural pattern of the AST node

---

## A.5 Phase Markers

**Purpose**: Distinguish execution contexts via a global variable, collecting data only during critical phases.

During its initialization phase, the Ruishu VM executes a large amount of logic unrelated to the target; indiscriminate collection produces a lot of noise. Phase markers are used to precisely control the collection window.

```javascript
// Defined in the global scope
globalThis.__phase = 0;

// Set the phase marker within the injected eval code
// Phase 0: initialization phase (ignore)
// Phase 1: Cookie generation phase (focus of collection)
// Phase 2: subsequent request phase (collect on demand)

// Set at the key entry point
// e.g., when State 324 is detected starting to execute
globalThis.__phase = 1;

// Check the phase within the data collection hook
function logIfCritical(tag, data) {
    if (globalThis.__phase === 1) {
        console.log(tag, JSON.stringify(data));
    }
}

// Practical application: record array operations only during Phase 1
const originalPush = Array.prototype.push;
Array.prototype.push = function() {
    if (globalThis.__phase === 1 && this.length > 100) {
        logIfCritical('__BASEARR__', {
            len: this.length,
            newItems: Array.from(arguments).slice(0, 5)
        });
    }
    return originalPush.apply(this, arguments);
};
```

**Key points**:
- Dramatically reduces log noise, focusing only on the critical execution path
- Phase transition points must be determined through prior analysis (typically at a specific function call or a specific opcode execution)
- Can be combined with A.4 function body replacement to set the phase inside the entry function

---

## A.6 console.log Side-Channel Export

**Purpose**: Leverage sdenv's consoleConfig callback mechanism to export internal VM data to the external Node.js environment.

In the sdenv environment, console.log output can be captured via the consoleConfig configuration option; this is a reliable channel for passing data out from inside the VM.

```javascript
// Outside Node.js: sdenv configuration
const collectedData = {
    keys: null,
    baseArr: null,
    cookieT: null
};

const sdenvConfig = {
    consoleConfig: {
        log: function() {
            const msg = arguments[0];

            // Capture the keys array
            if (typeof msg === 'string' && msg.startsWith('__K__')) {
                const payload = msg.substring(5);
                collectedData.keys = JSON.parse(payload);
                console.error('[COLLECT] keys captured, length:', collectedData.keys.length);
            }

            // Capture the base array
            if (typeof msg === 'string' && msg.startsWith('__BASEARR__')) {
                const payload = msg.substring(11);
                collectedData.baseArr = JSON.parse(payload);
                console.error('[COLLECT] baseArr captured, length:', collectedData.baseArr.length);
            }

            // Capture Cookie T
            if (typeof msg === 'string' && msg.startsWith('__CT__')) {
                const payload = msg.substring(6);
                collectedData.cookieT = payload;
                console.error('[COLLECT] Cookie T captured');
            }
        }
    }
};
```

```javascript
// Inside the VM (injected into the eval code): send data using agreed prefixes
// Insert at key locations:

// Export the keys array
console.log('__K__' + JSON.stringify(keys));

// Export the base array (runtime constant table)
console.log('__BASEARR__' + JSON.stringify(baseArr));

// Export Cookie T
console.log('__CT__' + cookieValue);
```

**Key points**:
- Prefix names should be unique to avoid conflicts with normal console.log calls
- Use `console.error` externally to emit debug information, keeping it separate from the internal `console.log` channel
- JSON.stringify handles complex data structures; watch out for circular references
- Serializing large arrays may impact performance; truncate as needed

---

## A.7 Bulk Function Discovery via Regex

**Purpose**: Bulk-locate target functions in obfuscated code via structural features; suitable for scenarios where function names are obfuscated.

```javascript
/**
 * Find functions by structural features
 * @param {string} code - the complete eval code
 * @param {RegExp} bodyPattern - characteristic regex for the function body
 * @returns {Array} information about the matched functions
 */
function findFunctionsByPattern(code, bodyPattern) {
    const results = [];
    // Match all function declarations and function expressions
    const funcDeclRegex = /function\s+(\w+)\s*\(([^)]*)\)\s*\{/g;
    let match;

    while ((match = funcDeclRegex.exec(code)) !== null) {
        const funcStart = match.index;
        const bodyStart = match.index + match[0].length;

        // Extract the complete function body via bracket-depth tracking
        const body = extractByBracketDepth(code, bodyStart - 1);

        if (body && bodyPattern.test(body)) {
            results.push({
                name: match[1],
                params: match[2],
                body: body,
                position: funcStart
            });
        }
    }
    return results;
}

/**
 * Bracket-depth tracking; extract the complete {} block
 * @param {string} code - the source code
 * @param {number} openBracePos - position of the opening brace
 * @returns {string} the complete function body (including the outer braces)
 */
function extractByBracketDepth(code, openBracePos) {
    let depth = 0;
    let inString = false;
    let stringChar = '';

    for (let i = openBracePos; i < code.length; i++) {
        const ch = code[i];

        // String-state tracking (avoid counting braces inside strings toward depth)
        if (!inString && (ch === '"' || ch === "'")) {
            inString = true;
            stringChar = ch;
        } else if (inString && ch === stringChar && code[i - 1] !== '\\') {
            inString = false;
        }

        if (!inString) {
            if (ch === '{') depth++;
            if (ch === '}') depth--;
            if (depth === 0) {
                return code.substring(openBracePos, i + 1);
            }
        }
    }
    return null;
}
```

**Practical application: CRC32 function discovery**

```javascript
// Structural feature of the CRC32 function: contains the 0xEDB88320 constant or a characteristic bitwise pattern
const crc32Pattern = /0xEDB88320|>>>.*0xFF/;
const crc32Functions = findFunctionsByPattern(evalCode, crc32Pattern);

if (crc32Functions.length > 0) {
    crc32Functions.forEach(fn => {
        console.log('[FOUND] CRC32 candidate:', fn.name, 'at position:', fn.position);
        console.log('  params:', fn.params);
        console.log('  body length:', fn.body.length);
    });
}
```

**Other commonly used feature patterns**:

```javascript
// SHA-1 function: contains characteristic initialization constants
const sha1Pattern = /0x67452301|0xEFCDAB89|0x98BADCFE/;

// Base64 encoding: contains the standard Base64 character table
const base64Pattern = /ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/;

// XHR hook: contains XMLHttpRequest and open/send related operations
const xhrHookPattern = /XMLHttpRequest.*prototype\.(open|send)/;

// Cookie operation: contains a document.cookie assignment
const cookiePattern = /document\.cookie\s*=/;
```

**Key points**:
- Bracket-depth tracking must handle braces inside strings, otherwise it will truncate prematurely
- The feature regex should target constants that are immutable within the algorithm (such as CRC32's magic number), not variable names that may be obfuscated
- A single feature may match multiple functions; further filtering by parameter count, function body length, etc. is needed
- This technique is a lightweight alternative to AST analysis, suitable for quickly locating candidate functions before performing precise analysis
