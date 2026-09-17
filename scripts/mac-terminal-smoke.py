"""Real shell echo through GUI-only background input; independent state verification."""
import json,pathlib,subprocess,tempfile,time
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='jev-terminal-') as temp:
    binary=str(pathlib.Path(temp)/'JevTerminalTest'); state=pathlib.Path(temp)/'state.json'
    subprocess.run(['swiftc',str(root/'tests/fixtures/macos/TerminalTarget.swift'),'-o',binary],check=True)
    app=subprocess.Popen([binary,str(state)])
    driver=subprocess.Popen([str(root/'native/macos/build/desktop-driver')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method,**args):
        driver.stdin.write(json.dumps(dict(id=method,method=method,**args))+'\n');driver.stdin.flush()
        r=json.loads(driver.stdout.readline());assert r['ok'],r;return r['data']
    def act(label,kind,text=None):
        s=call('snapshot',pid=app.pid);n=next(n for n in s['nodes'] if n['name']==label)
        action=dict(kind=kind,ref=n['ref'])
        if text is not None:action['text']=text
        return call('execute',snapshotId=s['id'],action=action)
    try:
        time.sleep(.5);before=call('inputState')
        act('Open terminal','backgroundClick')
        assert json.loads(state.read_text())['opened']
        act('Terminal input','backgroundClick')
        act('Terminal input','backgroundText','echo JEV_TEST_BACKGROUND_917')
        act('Terminal input','backgroundKey','Enter')
        s=call('snapshot',pid=app.pid)
        assert any(n['value'].strip()=='JEV_TEST_BACKGROUND_917' for n in s['nodes']),'Shell output missing from AX observation'
        actual=json.loads(state.read_text());assert actual['stdout']=='JEV_TEST_BACKGROUND_917\n' and actual['command']=='echo JEV_TEST_BACKGROUND_917'
        act('Close terminal','backgroundClick')
        assert not json.loads(state.read_text())['opened']
        after=call('inputState')
        assert before['foregroundPID']==after['foregroundPID'],'Foreground changed'
        print(json.dumps({'open':True,'type':True,'enter':True,'shellOutputVerified':True,'close':True,'foregroundUnchanged':True,'cursorUnchanged':before['cursor']==after['cursor'],'hardwareMouseMoves':after['hardwareMouseMoves']-before['hardwareMouseMoves']}))
        assert before['cursor']==after['cursor'] or after['hardwareMouseMoves']!=before['hardwareMouseMoves'],'Cursor changed without physical mouse input'
        if before['cursor']!=after['cursor']: print('Cursor equality inconclusive: hardware mouse input occurred concurrently.')
    finally:
        app.terminate();app.wait(timeout=5);driver.stdin.close();driver.wait(timeout=5)
