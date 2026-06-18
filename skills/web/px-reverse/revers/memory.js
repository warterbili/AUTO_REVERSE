/**
 * PX performance.memory fingerprint generator
 *
 * Reversed from main3.js Dd() function (line 6173-6271)
 *
 * ═══ Source logic ═══
 *   Ht = window.performance && window.performance.memory
 *   if (Ht) {
 *       e["YGAaZiYMFV0="] = Ht.usedJSHeapSize
 *       e["FU1vS1MhZ3w="] = Ht.jsHeapSizeLimit
 *       e["EFAqFlYxJCc="] = Ht.totalJSHeapSize
 *   }
 *
 * ═══ Sample values ═══
 *   usedJSHeapSize:  47664718 / 96028824 / 86710049 / 133865036  (~45-130 MB)
 *   totalJSHeapSize: 62136442 / 123133176 / 96237933 / 144682232 (~60-140 MB)
 *   jsHeapSizeLimit: 4294967296 (fixed, 4GB)
 *
 * ═══ Constraint ═══
 *   usedJSHeapSize < totalJSHeapSize < jsHeapSizeLimit
 *
 * Usage:
 *   const { generateMemory } = require('./memory')
 *   const mem = generateMemory()
 *   // mem.usedJSHeapSize, mem.totalJSHeapSize, mem.jsHeapSizeLimit
 */

var JS_HEAP_SIZE_LIMIT = 4294967296;

// generate a random integer in the range [min, max]
function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate the three performance.memory fields
 *
 * @returns {{ usedJSHeapSize: number, totalJSHeapSize: number, jsHeapSizeLimit: number }}
 */
function generateMemory() {
    // used: 40MB ~ 140MB
    var used = randInt(40000000, 140000000);
    // total: used * 1.1 ~ used * 1.5, ensure total > used
    var total = randInt(Math.floor(used * 1.1), Math.floor(used * 1.5));
    return {
        usedJSHeapSize: used,
        totalJSHeapSize: total,
        jsHeapSizeLimit: JS_HEAP_SIZE_LIMIT
    };
}

module.exports = { generateMemory, JS_HEAP_SIZE_LIMIT };
