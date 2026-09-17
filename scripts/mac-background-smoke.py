"""Background pointer regression with independent app-side evidence.
The disposable window is ordered behind existing windows, never activated.
"""
import json, pathlib, subprocess, tempfile, time
root=pathlib.Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='jev-background-') as temp:
    binary=str(pathlib.Path(temp)/'target'); result=pathlib.Path(temp)/'clicks.txt'
    subprocess.run(['swiftc',str(root/'tests/fixtures/macos/BackgroundTarget.swift'),'-o',binary],check=True)
    driver=subprocess.Popen([str(root/'native/macos/build/desktop-driver')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method,**args):
        driver.stdin.write(json.dumps(dict(id=method,method=method,**args))+'\n');driver.stdin.flush()
        reply=json.loads(driver.stdout.readline());assert reply['ok'],reply;return reply['data']
    before=call('inputState')
    app=subprocess.Popen([binary,str(result)])
    try:
        time.sleep(.7)
        snapshot=call('snapshot',pid=app.pid)
        target=next(n for n in snapshot['nodes'] if n['name'].startswith('Background target '))
        selected=target['name'][-1]
        target_result=pathlib.Path(str(result)+selected)
        sibling_result=pathlib.Path(str(result)+('B' if selected=='A' else 'A'))
        before=call('inputState')
        call('execute',snapshotId=snapshot['id'],action={'kind':'backgroundClick','ref':target['ref']})
        time.sleep(.3)
        after=call('inputState')
        summary={'cursorBefore':before['cursor'],'cursorAfter':after['cursor'],'virtualCursor':after['virtualCursor'],'receivedClicks':int(target_result.read_text()) if target_result.exists() else 0,'siblingClicks':int(sibling_result.read_text()) if sibling_result.exists() else 0,'foregroundUnchanged':before['foregroundPID']==after['foregroundPID'],'cursorUnchanged':before['cursor']==after['cursor'],'backgroundPointerAvailable':after['backgroundPointerAvailable'],'virtualCursorUpdated':after['virtualCursor'] is not None}
        print(json.dumps(summary),flush=True)
        assert summary['receivedClicks']==1,'Target did not receive exactly one click'
        assert summary['siblingClicks']==0,'Input leaked to sibling window'
        assert summary['foregroundUnchanged'],'Foreground app changed'
        assert summary['cursorUnchanged'],'Hardware cursor changed (or user moved it during measurement)'
        assert summary['virtualCursorUpdated'],'Virtual cursor did not update'
        snapshot=call('snapshot',pid=app.pid)
        field=next(n for n in snapshot['nodes'] if n['name']=='Background field '+selected)
        call('execute',snapshotId=snapshot['id'],action={'kind':'backgroundClick','ref':field['ref']})
        snapshot=call('snapshot',pid=app.pid)
        field=next(n for n in snapshot['nodes'] if n['name']=='Background field '+selected)
        before=call('inputState')
        call('execute',snapshotId=snapshot['id'],action={'kind':'backgroundText','ref':field['ref'],'text':'JEV_TEST'})
        snapshot=call('snapshot',pid=app.pid)
        field=next(n for n in snapshot['nodes'] if n['name']=='Background field '+selected)
        call('execute',snapshotId=snapshot['id'],action={'kind':'backgroundKey','ref':field['ref'],'text':'Enter'})
        after=call('inputState')
        submitted=pathlib.Path(str(result)+selected+'-submitted')
        assert submitted.exists() and submitted.read_text()=='JEV_TEST','App did not confirm typed text and Enter'
        assert not pathlib.Path(str(sibling_result)+'-text').exists(),'Typing leaked to sibling'
        print(json.dumps({'keyboardForegroundBefore':before['foregroundPID'],'keyboardForegroundAfter':after['foregroundPID'],'keyboardCursorBefore':before['cursor'],'keyboardCursorAfter':after['cursor'],'hardwareMouseMoves':after['hardwareMouseMoves']-before['hardwareMouseMoves']}),flush=True)
        assert before['foregroundPID']==after['foregroundPID'] and before['cursor']==after['cursor'],'Keyboard input-state invariant failed; inspect hardware activity before attributing cause'
        print('PASS: background text and Enter independently confirmed; sibling untouched; cursor and foreground unchanged.')

    finally:
        app.terminate();app.wait(timeout=5);driver.stdin.close();driver.wait(timeout=5)
