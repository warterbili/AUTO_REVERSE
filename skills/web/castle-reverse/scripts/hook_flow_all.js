'use strict';
// Log EVERY request: code/url/hasCastle. Full req+resp headers for any Castle-bearing or 4xx/5xx.
Java.perform(function () {
  console.log('[*] flow-all loaded');
  try {
    var RC = Java.use('okhttp3.internal.connection.RealCall');
    RC['getResponseWithInterceptorChain$okhttp'].implementation = function () {
      var resp = this['getResponseWithInterceptorChain$okhttp']();
      try {
        var req = this.request();
        var url = req.url().toString();
        var code = resp.code();
        var castleTok = req.header('X-Castle-Request-Token');
        var hasCastle = castleTok !== null;
        console.log('[H] ' + code + ' ' + req.method() + ' ' + url + (hasCastle ? '  [CASTLE tok=' + castleTok.length + ']' : ''));
        if (hasCastle || code >= 400) {
          console.log('  --- RESP headers (' + code + ' ' + resp.message() + ') ---');
          var sh = resp.headers();
          for (var j = 0; j < sh.size(); j++) console.log('    ' + sh.name(j) + ': ' + sh.value(j));
          try { var b = resp.peekBody(8192).string(); if (b) console.log('    BODY: ' + b.substring(0,500)); } catch(e){}
        }
      } catch (e) {}
      return resp;
    };
    console.log('[+] hooked');
  } catch (e) { console.log('[-] ' + e); }
});
