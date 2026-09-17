"""Own native transport against a disposable Electron app, with app-side readback."""
import argparse, json, pathlib, subprocess, tempfile, time
parser=argparse.ArgumentParser();parser.add_argument("--semantic",action="store_true");args=parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
electron = root / 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'
with tempfile.TemporaryDirectory(prefix='jev-electron-') as temp:
    folder = pathlib.Path(temp); evidence = folder/'state.json'
    (folder/'package.json').write_text(json.dumps({'name':'jev-native-fixture','main':'main.cjs'}))
    (folder/'main.cjs').write_text('''const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('fs');let win,count=0;
const output=process.argv[2]; fs.writeFileSync(output,JSON.stringify({clicks:0}));
ipcMain.on('clicked',()=>{count++;fs.writeFileSync(output,JSON.stringify({clicks:count}));});
app.whenReady().then(async()=>{await app.dock.hide();win=new BrowserWindow({show:false,width:400,height:240,webPreferences:{nodeIntegration:true,contextIsolation:false}});
win.loadURL('data:text/html,'+encodeURIComponent('<title>Jev native Electron fixture</title><button onclick="require(\\'electron\\').ipcRenderer.send(\\'clicked\\');this.innerText=\\'Clicked\\'">Test native click</button>'));
win.webContents.once('did-finish-load',()=>win.showInactive());});
app.on('window-all-closed',()=>app.quit());''')
    app = subprocess.Popen([str(electron),str(folder),str(evidence)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    driver = subprocess.Popen([str(root/'native/macos/build/desktop-driver')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    def call(method,**args):
        driver.stdin.write(json.dumps(dict(id=method,method=method,**args))+'\n');driver.stdin.flush()
        reply=json.loads(driver.stdout.readline());assert reply['ok'],reply;return reply['data']
    try:
        deadline=time.monotonic()+15
        while True:
            try:
                snapshot=call('snapshot',pid=app.pid)
                target=next(n for n in snapshot['nodes'] if n['name']=='Test native click')
                break
            except (AssertionError,StopIteration):
                if time.monotonic()>=deadline: raise
                time.sleep(.2)
        before=call('inputState')
        call('execute',snapshotId=snapshot['id'],action={'kind':'press' if args.semantic else 'backgroundClick','ref':target['ref']})
        time.sleep(.3)
        after=call('inputState');state=json.loads(evidence.read_text())
        fresh=call('snapshot',pid=app.pid)
        result={'clicks':state['clicks'],'axChanged':any(n['name']=='Clicked' for n in fresh['nodes']),
            'foregroundUnchanged':before['foregroundPID']==after['foregroundPID'],
            'cursorUnchanged':before['cursor']==after['cursor'],'hardwareMouseMoves':after['hardwareMouseMoves']-before['hardwareMouseMoves']}
        print(json.dumps(result),flush=True)
        assert result['clicks']==1 and result['axChanged'],'Native Electron click not verified exactly once'
        assert result['foregroundUnchanged'],'Foreground changed during measurement'
        assert result['cursorUnchanged'] or result['hardwareMouseMoves']>0,'Cursor moved without physical input'
    finally:
        app.terminate();app.wait(timeout=5);driver.stdin.close();driver.wait(timeout=5)
