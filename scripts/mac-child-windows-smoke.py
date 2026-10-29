"""List and explicitly select all real AXChildren windows, including omitted AXWindows entries."""
import json, os, pathlib, subprocess, tempfile, time
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cu-child-windows-') as temp:
    binary=pathlib.Path(temp)/'target';ready=pathlib.Path(temp)/'ready.json'
    subprocess.run(['xcrun','swiftc',str(root/'tests/fixtures/macos/ChildWindowsTarget.swift'),'-o',str(binary)],check=True)
    driver=subprocess.Popen([str(pathlib.Path(os.environ.get('CU_NATIVE_DIR',root/'native/macos/build'))/'desktop-driver')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method,**args):
        driver.stdin.write(json.dumps(dict(id=method,method=method,**args))+'\n');driver.stdin.flush();return json.loads(driver.stdout.readline())
    initial=call('inputState')['data']
    app=subprocess.Popen([str(binary),str(ready)])
    try:
        deadline=time.monotonic()+5
        while not ready.exists() and app.poll() is None and time.monotonic()<deadline:time.sleep(.05)
        metadata=json.loads(ready.read_text());first,second=metadata['windows']
        reply=call('windows',pid=app.pid);assert reply['ok'],reply
        listed={w['windowId']:w for w in reply['data']}
        assert first in listed and second in listed, 'AXChildren window omitted from discovery: '+repr(reply)
        assert listed[second]['title']=='Owned child window B','Non-window AX child masqueraded as window'
        reply=call('snapshot',pid=app.pid,windowId=second);assert reply['ok'],reply
        assert reply['data']['windowId']==second and reply['data']['title']=='Owned child window B',reply
        after=call('inputState')['data'];assert after['foregroundPID']==initial['foregroundPID'],('Foreground changed during fixture',initial,after)
        assert after['cursor']==initial['cursor'],('Cursor changed during fixture',initial,after)
        print('PASS: all AXChildren windows discovered and second explicitly selected; non-window child filtered')
    finally:
        driver.stdin.close();driver.wait(timeout=5);app.terminate();app.wait(timeout=5)
