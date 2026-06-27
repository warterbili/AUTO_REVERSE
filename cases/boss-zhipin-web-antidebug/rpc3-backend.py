import json, time, threading, requests, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
LOGIN={c['name']:c['value'] for c in json.load(open('.cookies.json'))}
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
H={'user-agent':UA,'referer':'https://www.zhipin.com/web/geek/job?query=java&city=101010100','accept':'application/json, text/plain, */*','x-requested-with':'XMLHttpRequest'}
JOB='https://www.zhipin.com/wapi/zpgeek/search/joblist.json'; P={'scene':1,'query':'java','city':101010100,'page':1,'pageSize':30}
st={'task':{}, 'result':None}; lock=threading.Lock()
class Hd(BaseHTTPRequestHandler):
    def _c(self): self.send_header('access-control-allow-origin','*')
    def do_OPTIONS(self): self.send_response(204); self._c(); self.end_headers()
    def do_GET(self):
        with lock: t=dict(st['task'])
        self.send_response(200); self._c(); self.send_header('content-type','application/json'); self.end_headers(); self.wfile.write(json.dumps(t).encode())
    def do_POST(self):
        n=int(self.headers.get('content-length',0)); b=self.rfile.read(n).decode()
        with lock: st['result']=json.loads(b)
        self.send_response(200); self._c(); self.end_headers(); self.wfile.write(b'ok')
    def log_message(self,*a): pass
def front_gen(seed,ts):
    tid=str(time.time())
    with lock: st['task']={'action':'gen','seed':seed,'ts':ts,'id':tid}; st['result']=None
    for _ in range(25):
        time.sleep(1)
        with lock: r=st['result']
        if r and r.get('id')==tid:
            with lock: st['task']={}
            return r.get('g',{})
    with lock: st['task']={}
    return {'ok':False,'err':'front-end timeout'}
def driver():
    s=requests.Session(); s.headers.update(H)
    for k,v in LOGIN.items():
        if k!='__zp_stoken__': s.cookies.set(k,v,domain='.zhipin.com')
    print('[BE] driver up. waiting for front-end ABC, then gen+encode+send...')
    for attempt in range(12):
        j=s.get(JOB,params=P,timeout=15).json(); zd=j.get('zpData') or {}
        seed,ts=zd.get('seed'),zd.get('ts')
        print('[BE] challenge code=%s seed=%s'%(j.get('code'),(seed or '')[:10]))
        if not seed: time.sleep(2); continue
        g=front_gen(seed,ts)
        if not g.get('ok'): print('[BE] front-end gen: %s (retry)'%g.get('err')); time.sleep(3); continue
        tok=g['token']
        enc=urllib.parse.quote(tok, safe='')   # <<< THE FIX: URL-encode the token
        print('[BE] front-end returned token len=%d ; URL-encoded len=%d'%(len(tok),len(enc)))
        s.cookies.set('__zp_stoken__', enc, domain='.zhipin.com')
        j2=s.get(JOB,params=P,timeout=15).json(); jl=(j2.get('zpData') or {}).get('jobList') or []
        print('[BE] Python request with OUR token -> code=%s msg=%s jobs=%d'%(j2.get('code'),j2.get('message'),len(jl)))
        for job in jl[:5]: print('   -',job.get('jobName'),'|',job.get('brandName'),'|',job.get('salaryDesc'))
        print('[BE] VERDICT:', 'EXTERNAL PYTHON + OUR-GENERATED TOKEN WORKS' if jl else 'blocked code=%s'%j2.get('code'))
        if jl: return
    print('[BE] done (no data)')
threading.Thread(target=lambda: ThreadingHTTPServer(('127.0.0.1',8090),Hd).serve_forever(),daemon=True).start()
print('[BE] :8090 up'); time.sleep(1); driver()
