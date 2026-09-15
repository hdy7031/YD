const {contextBridge,ipcRenderer}=require('electron');
const call=(name)=>(...args)=>ipcRenderer.invoke('dayhub:'+name,...args);
contextBridge.exposeInMainWorld('dayhub',{
 version:call('version'),
 onSettings(callback){const fn=()=>callback();ipcRenderer.on('dayhub:settings',fn);return()=>ipcRenderer.removeListener('dayhub:settings',fn);},
 onStatus(callback){const fn=()=>callback();ipcRenderer.on('dayhub:status',fn);return()=>ipcRenderer.removeListener('dayhub:status',fn);},
  live:call('live'),window:call('window'),bubble:call('bubble'),presence:call('presence'),pointer:call('pointer'),cursorInside:call('cursorInside'),dockSize:call('dockSize'),companionAssets:call('companionAssets'),avatarVisualReady:call('avatarVisualReady'),reportHitRegions:call('hitRegions'),
  onPointer(callback){const listener=(_event,state)=>callback(state);ipcRenderer.on('dayhub:pointerState',listener);return()=>ipcRenderer.removeListener('dayhub:pointerState',listener);},
 menuAction:call('menuAction'),
 onMenu(callback){const listener=(_event,value)=>callback(value);ipcRenderer.on('dayhub:menu',listener);return()=>ipcRenderer.removeListener('dayhub:menu',listener);},
 onLive(callback){const listener=(_event,value)=>callback(value);ipcRenderer.on('dayhub:live',listener);return()=>ipcRenderer.removeListener('dayhub:live',listener);},
  parseNotice:call('parseNotice'),clipboardText:call('clipboardText'),get:call('get'),change:call('change'),chooseSchedule:call('chooseSchedule'),chooseICS:call('chooseICS'),commitICSImport:call('commitICSImport'),chooseTabular:call('chooseTabular'),commitTabularImport:call('commitTabularImport'),importImage:call('importImage'),importImageBytes:call('importImageBytes'),pasteImage:call('pasteImage'),image:call('image'),ocr:call('ocr'),backup:call('backup'),restore:call('restore'),testNotification:call('testNotification'),toggle:call('toggle'),beginDrag:call('beginDrag'),drag:call('drag'),endDrag:call('endDrag'),
 subscribe(callback){const listener=()=>callback();ipcRenderer.on('dayhub:changed',listener);return()=>ipcRenderer.removeListener('dayhub:changed',listener);},
 onError(callback){const listener=(_event,message)=>callback(message);ipcRenderer.on('dayhub:error',listener);return()=>ipcRenderer.removeListener('dayhub:error',listener);}
});
