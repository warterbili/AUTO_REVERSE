const CDP=require('chrome-remote-interface'),http=require('http');
const PORT=parseInt(process.env.CDP_PORT||'9540',10);
const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// security-js append: expose ABC to top
const EXPOSE=`;(function(){var iv=setInterval(function(){try{if(window.ABC){window.top.__BOSS_ABC__=window.ABC;}}catch(e){}},20);setTimeout(function(){clearInterval(iv);},120000);})();`;
// front-end poller (RPC client) prepended to a static bundle
const POLLER=`(function(){if(window.__RPC3)return;window.__RPC3=1;var BE='http://127.0.0.1:8090';setInterval(function(){fetch(BE+'/pull').then(function(r){return r.json();}).then(function(t){if(t&&t.action==='gen'&&t.id!==window.__lt){window.__lt=t.id;var ABC=(window.top&&window.top.__BOSS_ABC__)||window.__BOSS_ABC__;var g;try{if(typeof ABC!=='function'){g={ok:false,err:'no ABC yet'};}else{var adj=parseInt(t.ts)+60*(480+(new Date()).getTimezoneOffset())*1000;g={ok:true,token:(new ABC()).z(t.seed,adj)};}}catch(e){g={ok:false,err:String(e&&e.message||e)};}fetch(BE+'/result',{method:'POST',body:JSON.stringify({id:t.id,g:g})}).catch(function(){});}}).catch(function(){});},800);})();`;
const PATCHES=[[/key:"XCID",value:function\(\)\{/g,'key:"XCID",value:function(){return;'],[/key:"XCIT",value:function\(\)\{/g,'key:"XCIT",value:function(){return;'],[/\bXCID\(\)\{/g,'XCID(){return;'],[/\bXCIT\(\)\{/g,'XCIT(){return;'],[/function Bm\(\)\{/g,'function Bm(){return;'],[/function Rm\(\)\{/g,'function Rm(){return;'],[/(function t\(\)\{)(if\(Sign\.encryptPwd)/g,'$1return;$2'],[/\(73===\w+\|\|74===\w+\)/g,'(!1)'],[/\b123===\w+/g,'!1'],[/\w+&&\w+<535/g,'!0'],[/new Array\(1e\d+\)/g,'new Array(1)'],[/\.repeat\(1e\d+\)/g,'.repeat(1)'],[/\(\)=>\w+\.clear\(\)/g,'()=>{}'],[/function\(\)\{return \w+\.clear\(\)\}/g,'function(){}'],[/(\.table,\w+=)\w+\.clear\b/g,'$1function(){}'],[/(\.table),\w+\.clear\)/g,'$1,function(){})']];
let injected=false;const cache={};
http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x').searchParams.get('u');try{if(!cache[u]){let b=await(await fetch(u,{headers:{'user-agent':UA,referer:'https://www.zhipin.com/'}})).text();if(/security-js/.test(u)){b=b+'\n'+EXPOSE;console.error('[rpc3] ABC exposer appended to security-js');}else{for(const[re,r]of PATCHES)b=b.replace(re,r);if(!injected){b=POLLER+'\n'+b;injected=true;console.error('[rpc3] poller injected (file-replacement) -> '+u.split('/').pop().slice(0,30));}}cache[u]=b;}res.writeHead(200,{'content-type':'application/javascript; charset=utf-8','access-control-allow-origin':'*','cache-control':'no-store'});res.end(cache[u]);}catch(e){res.writeHead(502);res.end('//'+e.message);}}).listen(8099,'127.0.0.1',async()=>{
 let c;for(let i=0;i<40;i++){try{c=await CDP({port:PORT});break;}catch(e){await sleep(500);}}
 const{Page,Network,Fetch,Runtime}=c;await Page.enable();await Network.enable();await Runtime.enable();await Network.setCacheDisabled({cacheDisabled:true});
 await Fetch.enable({patterns:[{urlPattern:'*.js*',requestStage:'Request'}]});
 Fetch.requestPaused(async ev=>{const id=ev.requestId,uu=ev.request.url;try{if((/security-js/.test(uu)||/static\.zhipin\.com\/.+\.js(\?|$)/.test(uu))&&!uu.includes('127.0.0.1'))await Fetch.continueRequest({requestId:id,url:'http://127.0.0.1:8099/?u='+encodeURIComponent(uu)});else await Fetch.continueRequest({requestId:id});}catch(e){try{await Fetch.continueRequest({requestId:id})}catch(_){}}});
 try{await Network.deleteCookies({name:'__zp_stoken__',domain:'.zhipin.com'});}catch(e){}
 await Page.navigate({url:'https://www.zhipin.com/web/geek/job?query=java&city=101010100'});
 for(let i=0;i<30;i++){await sleep(1000);try{if((await Runtime.evaluate({expression:'!!(window.top.__BOSS_ABC__)',returnByValue:true})).result.value){console.error('[rpc3] __BOSS_ABC__ exposed at ~'+i+'s');break;}}catch(e){}}
 console.error('[rpc3] armed; poller polling backend :8090');
 await new Promise(()=>{});
})
