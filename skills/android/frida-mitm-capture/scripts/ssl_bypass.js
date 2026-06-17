/**
 * ssl_bypass.js — SSL Pinning Bypass + Proxy Routing
 *
 * Proxy-routing approach adapted from:
 *   httptoolkit/frida-interception-and-unpinning (android-proxy-override.js)
 *   Strategy: System properties + ConnectivityManager + enumerating all ProxySelector implementations
 *
 * SSL bypass coverage:
 *   conscrypt TrustManagerImpl, NetworkSecurityConfig pin set,
 *   OkHttp3 CertificatePinner (including obfuscated variants), WebViewClient, HttpsURLConnection,
 *   native libssl.so
 */

// ── Config (can be injected by start_capture.py via --set, or edited directly) ──
var PROXY_HOST = (typeof __PROXY_HOST__ !== 'undefined') ? __PROXY_HOST__ : '127.0.0.1';
var PROXY_PORT = (typeof __PROXY_PORT__ !== 'undefined') ? __PROXY_PORT__ : 8080;
var DEBUG_MODE = false;

setTimeout(function () {

    Java.perform(function () {
        console.log('[*] ssl_bypass.js starting (proxy=' + PROXY_HOST + ':' + PROXY_PORT + ')');

        // ════════════════════════════════════════════════════════
        // PART 1: Force proxy routing
        //   Source: android-proxy-override.js (httptoolkit)
        // ════════════════════════════════════════════════════════

        // 1a. JVM system properties
        try {
            var System = Java.use('java.lang.System');
            System.setProperty('http.proxyHost',   PROXY_HOST);
            System.setProperty('http.proxyPort',   PROXY_PORT.toString());
            System.setProperty('https.proxyHost',  PROXY_HOST);
            System.setProperty('https.proxyPort',  PROXY_PORT.toString());
            System.clearProperty('http.nonProxyHosts');
            System.clearProperty('https.nonProxyHosts');

            // Prevent the app from resetting these properties
            var LOCKED_PROPS = [
                'http.proxyHost', 'http.proxyPort',
                'https.proxyHost', 'https.proxyPort',
                'http.nonProxyHosts', 'https.nonProxyHosts'
            ];
            System.clearProperty.implementation = function (prop) {
                if (LOCKED_PROPS.indexOf(prop) !== -1) {
                    if (DEBUG_MODE) console.log('[Proxy] Blocked clearProperty: ' + prop);
                    return this.getProperty(prop);
                }
                return this.clearProperty(prop);
            };
            System.setProperty.implementation = function (prop, value) {
                if (LOCKED_PROPS.indexOf(prop) !== -1) {
                    if (DEBUG_MODE) console.log('[Proxy] Blocked setProperty: ' + prop + '=' + value);
                    return this.getProperty(prop);
                }
                return this.setProperty(prop, value);
            };
            console.log('[Proxy] ✓ System properties locked → ' + PROXY_HOST + ':' + PROXY_PORT);
        } catch (e) {
            console.log('[Proxy] System properties failed: ' + e);
        }

        // 1b. ConnectivityManager.getDefaultProxy
        try {
            var ConnectivityManager = Java.use('android.net.ConnectivityManager');
            var ProxyInfo = Java.use('android.net.ProxyInfo');
            ConnectivityManager.getDefaultProxy.implementation = function () {
                return ProxyInfo.$new(PROXY_HOST, PROXY_PORT, '');
            };
            console.log('[Proxy] ✓ ConnectivityManager.getDefaultProxy overridden');
        } catch (e) {
            console.log('[Proxy] ConnectivityManager: ' + e);
        }

        // 1c. Enumerate all ProxySelector implementations and force routing (key: far more stable than registerClass)
        try {
            var Collections   = Java.use('java.util.Collections');
            var ProxyType     = Java.use('java.net.Proxy$Type');
            var InetSockAddr  = Java.use('java.net.InetSocketAddress');
            var ProxyCls      = Java.use('java.net.Proxy');
            var ProxySelector = Java.use('java.net.ProxySelector');

            // Create it dynamically on each call to keep the Frida Java bridge type-compatible
            var getProxyList = function () {
                var proxy = ProxyCls.$new(
                    ProxyType.HTTP.value,
                    InetSockAddr.$new(PROXY_HOST, PROXY_PORT)
                );
                return Collections.singletonList(proxy);
            };

            var selectorClasses = Java.enumerateMethods('*!select(java.net.URI): java.util.List/s')
                .flatMap(function (loader) {
                    return loader.classes
                        .map(function (c) { return Java.use(c.name); })
                        .filter(function (Cls) {
                            return ProxySelector.class.isAssignableFrom(Cls.class);
                        });
                });

            selectorClasses.forEach(function (Cls) {
                Cls.select.implementation = function () { return getProxyList(); };
                if (DEBUG_MODE) console.log('[Proxy]   → Overriding: ' + Cls);
            });

            console.log('[Proxy] ✓ ' + selectorClasses.length + ' ProxySelector(s) overridden');
        } catch (e) {
            console.log('[Proxy] ProxySelector enumeration failed: ' + e);
        }

        // ════════════════════════════════════════════════════════
        // PART 2: SSL Pinning Bypass
        // ════════════════════════════════════════════════════════

        // 2a. conscrypt TrustManagerImpl — verifyChain + checkTrustedRecursive
        try {
            var TrustManagerImpl = Java.use('com.android.org.conscrypt.TrustManagerImpl');
            TrustManagerImpl.verifyChain.implementation = function (untrustedChain, trustAnchorChain, host, clientAuth, ocspData, tlsSctData) {
                if (DEBUG_MODE) console.log('[SSL] conscrypt.verifyChain: ' + host);
                // null guard: WebView sometimes passes a null chain; return an empty list to avoid an NPE
                if (untrustedChain === null || untrustedChain === undefined) {
                    return Java.use('java.util.ArrayList').$new();
                }
                return untrustedChain;
            };
            console.log('[SSL] ✓ conscrypt.verifyChain bypassed');
        } catch (e) {
            console.log('[SSL] conscrypt.verifyChain: ' + e);
        }

        // 2a-2. AndroidNetworkLibrary.verifyServerCertificates (WebView/Chromium-specific path)
        try {
            var AndroidNetworkLibrary = Java.use('org.chromium.net.AndroidNetworkLibrary');
            AndroidNetworkLibrary.verifyServerCertificates.overloads.forEach(function (overload) {
                overload.implementation = function () {
                    if (DEBUG_MODE) console.log('[SSL] AndroidNetworkLibrary.verifyServerCertificates bypassed');
                    // Return null so the native layer uses its default pass logic
                    return null;
                };
            });
            console.log('[SSL] ✓ AndroidNetworkLibrary.verifyServerCertificates bypassed');
        } catch (e) {
            console.log('[SSL] AndroidNetworkLibrary: ' + e);
        }

        try {
            var TrustManagerImpl2 = Java.use('com.android.org.conscrypt.TrustManagerImpl');
            TrustManagerImpl2.checkTrustedRecursive.implementation = function () {
                return Java.use('java.util.ArrayList').$new();
            };
            console.log('[SSL] ✓ conscrypt.checkTrustedRecursive bypassed');
        } catch (e) { /* not in all Android versions */ }

        // 2b. conscrypt ActiveSession
        try {
            Java.use('com.android.org.conscrypt.ActiveSession')
                .checkPeerCertificatesPresent.implementation = function () {};
        } catch (e) {}

        // 2c. NetworkSecurityConfig — clear all pin sets (the most thorough Android system-level bypass)
        try {
            var NetworkSecurityConfig = Java.use('android.security.net.config.NetworkSecurityConfig');
            var PinSet = Java.use('android.security.net.config.PinSet');
            var EMPTY_PINSET = PinSet.EMPTY_PINSET.value;
            NetworkSecurityConfig['$init'].overloads.forEach(function (overload) {
                overload.implementation = function () {
                    arguments[2] = EMPTY_PINSET; // the 3rd argument is pins
                    return overload.apply(this, arguments);
                };
            });
            console.log('[SSL] ✓ NetworkSecurityConfig pin set cleared');
        } catch (e) {
            console.log('[SSL] NetworkSecurityConfig: ' + e);
        }

        // 2d. NetworkSecurityTrustManager.checkServerTrusted
        // Note: the 3-arg version inherits from X509ExtendedTrustManager and returns List<X509Certificate> rather than void
        try {
            var NetworkSecurityTrustManager = Java.use('android.security.net.config.NetworkSecurityTrustManager');
            // 2-arg: void checkServerTrusted(X509Certificate[], String)
            try {
                NetworkSecurityTrustManager.checkServerTrusted
                    .overload('[Ljava.security.cert.X509Certificate;', 'java.lang.String')
                    .implementation = function () {};
            } catch (e2) {}
            // 3-arg: List checkServerTrusted(X509Certificate[], String, String)
            try {
                NetworkSecurityTrustManager.checkServerTrusted
                    .overload('[Ljava.security.cert.X509Certificate;', 'java.lang.String', 'java.lang.String')
                    .implementation = function (chain, authType, host) {
                        if (DEBUG_MODE) console.log('[SSL] NetworkSecurityTrustManager bypassed: ' + host);
                        return Java.use('java.util.Arrays').asList(chain);
                    };
            } catch (e2) {}
            console.log('[SSL] ✓ NetworkSecurityTrustManager bypassed');
        } catch (e) {}

        // 2e. OkHttp3 CertificatePinner (including the obfuscated check$okhttp and b variants)
        try {
            var CertificatePinner = Java.use('okhttp3.CertificatePinner');
            ['check', 'check$okhttp', 'b'].forEach(function (name) {
                try {
                    CertificatePinner[name].overloads.forEach(function (overload) {
                        overload.implementation = function () {
                            if (DEBUG_MODE) console.log('[SSL] okhttp3.CertificatePinner.' + name + ' bypassed');
                        };
                    });
                } catch (e2) {}
            });
            console.log('[SSL] ✓ OkHttp3 CertificatePinner bypassed');
        } catch (e) {
            console.log('[SSL] OkHttp3 CertificatePinner: ' + e);
        }

        // 2f. com.android.okhttp (Android built-in OkHttp v2)
        try {
            var AndroidOkHttpCertPinner = Java.use('com.android.okhttp.CertificatePinner');
            AndroidOkHttpCertPinner.check.overloads.forEach(function (overload) {
                overload.implementation = function () {};
            });
        } catch (e) {}

        // 2g. OkHttp3 HostnameVerifier
        try {
            Java.use('okhttp3.internal.tls.OkHostnameVerifier')
                .verify.overload('java.lang.String', 'javax.net.ssl.SSLSession')
                .implementation = function () { return true; };
        } catch (e) {}

        // 2h. HttpsURLConnection — prevent the app from replacing the system HostnameVerifier/SSLSocketFactory
        try {
            var HttpsURLConn = Java.use('javax.net.ssl.HttpsURLConnection');
            HttpsURLConn.setDefaultHostnameVerifier.implementation = function () {};
            HttpsURLConn.setSSLSocketFactory.implementation = function () {};
            HttpsURLConn.setHostnameVerifier.implementation = function () {};
        } catch (e) {}

        // 2i. WebViewClient
        try {
            Java.use('android.webkit.WebViewClient')
                .onReceivedSslError.implementation = function (view, handler, error) {
                    handler.proceed();
                };
        } catch (e) {}

        // Dynamic scanning removed (it causes a native-layer access violation)

        console.log('[*] ssl_bypass.js: all hooks installed.');
    });

    // ════════════════════════════════════════════════════════
    // PART 3: Native SSL bypass (libssl.so)
    // ════════════════════════════════════════════════════════
    try {
        var ssl_ctx_set_verify = Module.findExportByName('libssl.so', 'SSL_CTX_set_verify');
        if (ssl_ctx_set_verify) {
            Interceptor.replace(ssl_ctx_set_verify, new NativeCallback(function (ctx, mode, cb) {
                // SSL_VERIFY_NONE = 0, do nothing
            }, 'void', ['pointer', 'int', 'pointer']));
            console.log('[SSL] ✓ Native SSL_CTX_set_verify bypassed');
        }
        var ssl_get_verify = Module.findExportByName('libssl.so', 'SSL_get_verify_result');
        if (ssl_get_verify) {
            Interceptor.replace(ssl_get_verify, new NativeCallback(function (ssl) {
                return 0; // X509_V_OK
            }, 'long', ['pointer']));
        }
    } catch (e) {}

}, 0);
