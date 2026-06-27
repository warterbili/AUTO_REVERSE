# Boss Anti-Debug — Real Source Excerpts (reference)

> Companion to [`detection-points.md`](detection-points.md) / [`patch-set.md`](patch-set.md).
> **Bounded, labeled excerpts** of the target's own anti-debug, extracted from the as-shipped
> (minified) `main.js` (SEO build) and `vendor-1.b980027c.js` (SPA build) for research /
> patch-verification — NOT the full bundles. `L(...)` / `b(...)` are the bundles' string decoders.
> No credentials or PII (pure detector logic). Use these to confirm each rule in `patch-set.md`
> matches ground truth, and to study WHY the bypass works (see `detection-points.md`).

## main.js :: Bm() — eject + bomb gate (n,i,a,o genuineness check)

```js
function Bm(){var e,t,n=Rm(),i=window[L(Om)]&&"[object HTMLDocument]"===(null==(i=(e=window[L(Om)]).toString)?void 0:i.call(e))&&window[L(Om)]instanceof HTMLDocument,a=window[L(Om)]&&window[L(Om)].body&&"[object HTMLBodyElement]"===(null==(a=(t=window[L(Om)].body).toString)?void 0:a.call(t))&&window[L(Om)].body instanceof HTMLBodyElement,o=window[L(Om)]&&window[L(Om)][L(Lm)]&&"[object HTMLHtmlElement]"===(null==(o=(t=window[L(Om)][L(Lm)]).toString)?void 0:o.call(t))&&window[L(Om)][L(Lm)]instanceof HTMLHtmlElement;try{Date.now()%2==0&&!Mm.XCID&&(Mm.XCID=function(){return"Unable to obtain application information"})}catch(e){}if(n&&i&&a&&o){try{window[L("c:Jwc1l")]=null,window[L("c:Jwcu>;")](L(""),L("q:WwcSr;"))}catch(e){window.console.log(e)}try{windo
```

## main.js :: Rm() — native-method-tamper detector

```js
function Rm(){try{!!Math.round(Math.random())&&!Pm.SEWO&&(Pm.SEWO=function(){return"Failed to get session"})}catch(e){}return window[L(Am)]&&window[L(Am)]instanceof Location&&function(){var a={success:!0,methods:{}};try{["Location"].forEach(function(e){var t,n,i=Sf(e);e.includes(".")&&(t=(n=V(e.split("."),2))[0],n=n[1],i=window[t][n]),i&&/\[native code\]/.test(i.toString())?a.methods[e]=!0:(a.success=!1,a.methods[e]=!1)})}catch(e){}return a}()}var Mm=window;var Um=V(Sf([L("b;^NoS6+[^F8wG>;")]),1)[0];function Bm(){var e,t,n=Rm(),i=window[L(Om)]&&"[object HTMLDocument]"===(null==(i=(e=window[L(Om)]).toString)?void 
```

## main.js :: console flood/clear chain (_f/Df/If/jf + IE ternary; non-IE -> native clear)

```js
var _f,Df,If,Nn=window||global;function jf(){If()}h=window||global;function Ef(n){var i=z[L(lf)]?function(e,t){return e.metaKey&&e.altKey&&(73===t||74===t)}:function(e,t){return e.ctrlKey&&e.shiftKey&&(73===t||74===t)},a=z[L(lf)]?function(e,t){return e.metaKey&&e.altKey&&85===t||e.metaKey&&83===t}:function(e,t){return e.ctrlKey&&(83===t||85===t)};n.addEventListener(L("`;^<[S:5c45I"),function(e){var t=(e=e||n.event).keyCode||e.which;if(123===t||i(e,t)||a(e,t))return(t=(t=e)||n.event).returnValue=!1,t.preventDefault(
```

## main.js :: XCID — devtools detect + console flood (transpiled)

```js
key:"XCID",value:function(){var e=L("[QB8[SW;"),t=L("[d^;oS:pcSVI"),n=L("`QW]`S:5"),i=L(Uh),a=L("Y8F6w1MpcgWcSn;");(!0===(null==(e=null==(e=window[e])?void 0:e[t])?void 0:e[n])||window[i]&&window.document.querySelector(a))&&this[L(Bh)]()}}],[{key:"OXUE",value:function(){var e=L("[QB8[SW;"),t=L(Uh);return!!window[e]||!!window[t]}}])),qm=window||global;function Vm(){return M(this,Vm),R(this,Vm,[{type:Nm[L(af)]}])}var Hm=null,Wm=0,Jm=[],Ym=V(Sf([L("X;pwX^Zk`^Nwc5lL")]),1)[0];function Qm(){function e(){i=!0}function t
```

## main.js :: XCIT — probe setup (transpiled)

```js
key:"XCIT",value:function(){}}]),Gm=(F(Vm,$),B(Vm,[{key:"XCIT",value:function(){}},{key:"XCID",value:function(){var e=L("[QB8[SW;"),t=L("[d^;oS:pcSVI"),n=L("`QW]`S:5"),i=L(Uh),a=L("Y8F6w1MpcgWcSn;");(!0===(null==(e=null==(e=window[e])?void 0:e[t])?void 0:e[n])||window[i]&&window.document.querySelector(a))&&this[L(Bh)]()}}],[{key:"OXUE",value:function(){var e=L("[QB8[SW;"),t=L(Uh);return!!window[e]||!!window[t]}}])),
```

## main.js :: memory bomb A — Array(1e4).fill x100 loop

```js
for(var p=[],u=0;u<100;u++)p.push(new Array(1e4).fill("JBwd{b5S=[d^pg@M9`^rw0{3vd:cd{+bdWpX^g/[QBk1"));s.push.apply(s,p),r(100);var h=window.setInterval(function(){try{for(var e=[],t=0;t<1e3;t++)e.push(new Array(1e4).fill("x"));s.push.apply(s,e)}catch(e){window.clearInterval(h)}},10)}catch(s){try{v
```

## main.js :: memory bomb B — Array(1e9) + random key

```js
window[n]=new Array(1e9)}}}}var Nm=g(g(g(g(g(g(g(g(g({},L(Qh),-1),L(Kh),0),L(Xh),1),L("T;v
```

## main.js :: Ef — Ctrl/Cmd+Shift/Alt+I/J keyboard detector

```js
function Ef(n){var i=z[L(lf)]?function(e,t){return e.metaKey&&e.altKey&&(73===t||74===t)}:function(e,t){return e.ctrlKey&&e.shiftKey&&(73===t||74===t)},a=z[L(lf)]?function(e,t){return e.metaKey&&e.altKey&&85===t||e.metaKey&&83===t}:function(e,t){return e.ctrlKey&&(83===t||85===t)};n.addEventListener(L("`;^<[S:5c45I"),function(e){var t=(e=e||n.event).keyCode|
```

## main.js :: timing detector — __defineSetter__ frame-gap (Xm<535)

```js
Xm&&Xm<535||(e=Math.random(),__defineSetter__.call(null,e,function(){}),delete Km[e])}),Zm=Ce,eg=ve,tg=et;function ng(){return M(this,ng),R(this,ng,[{type:Nm[L(
```

## vendor-1 :: XCID (ES6 class method — same name, different syntax)

```js
XCID(){var t,e;let n=b(f),r=b("[d^;oS:pcSVI"),o=b("`QW]`S:5"),i=b(l),a=b("wvWc0Mpcd^][Q{jX:rbu>;");(!0===(null==(e=null==(t=window[n])?void 0:t[r])?void 0:e[o])||window[i]&&window.document.querySelector(a))&&this[b(d)]()}static OXUE(){let t=b(f),e=b(l);return!!window[t]||!!window[e]}}let tv=window||n.g,tg=null,tw=0,tb=[],[tS]=Z([b(s)]),tO={[tp[b(x)]]:class extends ty{constructor(){super({type:tp[b(x)],enabled:K[b(P)]||K[b(R)]})}XCIT(){this.lastTime=0,this.reg=/./,o(this.reg);let t=b(d);this.reg.toString=()=>{if(K
```

## vendor-1 :: XCIT (ES6 class method)

```js
XCIT(){}}class tm extends ty{constructor(){super({type:tp[b(T)]})}XCIT(){}XCID(){var t,e;let n=b(f),r=b("[d^;oS:pcSVI"),o=b("`QW]`S:5"),i=b(l),a=b("wvWc0Mpcd^][Q{jX:rbu>;");(!0===(null==(e=null==(t=window[n])?void 0:t[r])?void 0:e[o])||window[i]&&window.document.querySelector(a))&&this[b(d)]()}static OXUE(){let t=b(f),e=b(l);return!!window[t]||!!window[e]}}let tv=window||n.g,tg=null,tw=0,tb=[],[tS]=Z([b(s)]),tO={[t
```

## vendor-1 :: console flood/clear wrappers (arrow + else branch)

```js
=>t.log(...e),i=(...e)=>t.table(...e),a=()=>t.clear()):(o=t.log,i=t.table,a=t.clear)}(),to({action:b("cvE}[Sl6w^1}[QLLbgcI"),options:t});let ti=ts(tM);return ti.success?(tx=!0,x=!1,!function(t,e){let 
```

## vendor-1 :: eject blur/hide overlay (encoded b(...) + blur(20px)/display:none)

```js
createElement("style"),e=[b("`Sr}cG>;"),b(g),b("XQJ~")],r=Math.floor(Math.random()*(n=["filter: blur(20px) !important","display: none !important","visibility: hidden !important","opacity: 0 !important"]).length),e.forEac
```

