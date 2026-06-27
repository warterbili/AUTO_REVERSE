#!/usr/bin/env python3
"""L4 driver: inject trace-native.js into a process and collect its events into trace.json.

  run-frida.py --target com.app.pkg --module libsign.so --symbol sign [--spawn] \
               --argc 4 --out trace.json
  run-frida.py --pid 1234 --module libqjs.so --offset 0x1a2b0 --out trace.json

Needs: a device with frida-server running (USB) and `pip install frida`. NOT runnable on the
authoring machine (no device). The emitted trace.json drops straight into ../../src/aggregate.js.
"""
import argparse, json, sys, os

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target'); ap.add_argument('--pid', type=int)
    ap.add_argument('--module', required=True)
    ap.add_argument('--symbol'); ap.add_argument('--offset')
    ap.add_argument('--argc', type=int, default=4)
    ap.add_argument('--spawn', action='store_true')
    ap.add_argument('--out', default='trace.json')
    a = ap.parse_args()

    try:
        import frida
    except ImportError:
        sys.exit('pip install frida  (and run frida-server on the device)')

    here = os.path.dirname(os.path.abspath(__file__))
    src = open(os.path.join(here, 'trace-native.js'), 'r', encoding='utf-8').read()

    dev = frida.get_usb_device(timeout=10)
    events = []
    def on_message(msg, data):
        if msg.get('type') == 'send':
            events.append(msg['payload'])
        elif msg.get('type') == 'error':
            print('[frida-error]', msg.get('stack') or msg, file=sys.stderr)

    if a.spawn and a.target:
        pid = dev.spawn([a.target]); session = dev.attach(pid)
    elif a.pid:
        session = dev.attach(a.pid)
    elif a.target:
        session = dev.attach(a.target)
    else:
        sys.exit('need --target or --pid')

    params = {'module': a.module, 'symbol': a.symbol, 'offset': a.offset, 'argc': a.argc}
    script = session.create_script(src, parameters=params)
    script.on('message', on_message)
    script.load()
    if a.spawn and a.target:
        dev.resume(pid)

    print('[run-frida] tracing… Ctrl-C to stop and write', a.out, file=sys.stderr)
    try:
        sys.stdin.read()
    except KeyboardInterrupt:
        pass
    json.dump({'events': events, 'total': len(events), 'dropped': 0}, open(a.out, 'w'))
    print(f'[run-frida] wrote {len(events)} events -> {a.out}', file=sys.stderr)

if __name__ == '__main__':
    main()
