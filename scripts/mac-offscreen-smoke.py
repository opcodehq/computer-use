"""Verify inactive-Space input effects and fail-closed pointer ownership/geometry."""
import json, os, pathlib, subprocess, tempfile, time
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='cu-offscreen-') as temp:
    temp=pathlib.Path(temp);target=temp/'target';scope=temp/'scope';output=temp/'clicks'
    subprocess.run(['xcrun','swiftc',str(root/'tests/fixtures/macos/OffscreenTarget.swift'),'-o',str(target)],check=True)
    subprocess.run(['xcrun','swiftc','-parse-as-library',str(root/'native/macos/BackgroundInput.swift'),str(root/'tests/fixtures/macos/PointerScope.swift'),'-o',str(scope)],check=True)
    driver=subprocess.Popen([str(pathlib.Path(os.environ.get('CU_NATIVE_DIR',root/'native/macos/build'))/'desktop-driver')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method,**args):
        driver.stdin.write(json.dumps(dict(id=method,method=method,**args))+'\n');driver.stdin.flush();return json.loads(driver.stdout.readline())
    initial=call('inputState')['data']
    app=subprocess.Popen([str(target),str(output),'--inactive-space'])
    try:
        deadline=time.monotonic()+5
        while not pathlib.Path(str(output)+'-setup.json').exists() and app.poll() is None and time.monotonic()<deadline:time.sleep(.05)
        setup=json.loads(pathlib.Path(str(output)+'-setup.json').read_text())
        before=call('inputState')['data'];assert before['foregroundPID']==initial['foregroundPID'],('Fixture setup changed foreground',initial,before);s=call('snapshot',pid=app.pid,windowId=setup['windowId'])['data'];assert s['windowOnScreen'] is False,s
        node=next(n for n in s['nodes'] if n['name']=='Offscreen receiver')
        subprocess.run([str(scope),str(app.pid),str(setup['windowId'])],check=True)
        assert not output.exists(),'Refused pointer inputs changed the target'
        stale=call('execute',snapshotId='stale',action=dict(kind='backgroundClick',ref=node['ref']));assert not stale['ok'],stale
        result=call('execute',snapshotId=s['id'],action=dict(kind='backgroundClick',ref=node['ref']));assert result['ok'],result
        deadline=time.monotonic()+2
        while not output.exists() and time.monotonic()<deadline:time.sleep(.02)
        assert output.read_text()=='1','No independently observed standard button action'
        fresh=call('snapshot',pid=app.pid,windowId=setup['windowId'])['data'];assert fresh['windowOnScreen'] is False
        assert any(n['name']=='Offscreen receiver 1' for n in fresh['nodes'])
        after=call('inputState')['data'];print('Input state',before,after);assert before['foregroundPID']==after['foregroundPID'];assert before['cursor']==after['cursor'];assert before['hardwareMouseMoves']==after['hardwareMouseMoves']
        state=json.loads(pathlib.Path(str(output)+'-state.json').read_text());assert state['activeSpace']==setup['spaceBefore']==setup['spaceAfter']
        print('PASS: actual inactive-Space standard-button effect; stale ref/PID/window/geometry refusals; foreground, Space and hardware cursor preserved')
    finally:
        driver.stdin.close();driver.wait(timeout=5);app.terminate();app.wait(timeout=5)
