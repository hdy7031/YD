const {contextBridge,ipcRenderer}=require('electron');
const call=(name)=>(...args)=>ipcRenderer.invoke('dayhub:'+name,...args);
contextBridge.exposeInMainWorld('dayhub',{
 onSettings(callback){const fn=()=>callback();ipcRenderer.on('dayhub:settings',fn);return()=>ipcRenderer.removeListener('dayhub:settings',fn);},
 onStatus(callback){const fn=()=>callback();ipcRenderer.on('dayhub:status',fn);return()=>ipcRenderer.removeListener('dayhub:status',fn);},
 live:call('live'),window:call('window'),bubble:call('bubble'),presence:call('presence'),pointer:call('pointer'),companionAssets:call('companionAssets'),
 menuAction:call('menuAction'),
 onMenu(callback){const listener=(_event,value)=>callback(value);ipcRenderer.on('dayhub:menu',listener);return()=>ipcRenderer.removeListener('dayhub:menu',listener);},
 onLive(callback){const listener=(_event,value)=>callback(value);ipcRenderer.on('dayhub:live',listener);return()=>ipcRenderer.removeListener('dayhub:live',listener);},
 parseNotice:call('parseNotice'),clipboardText:call('clipboardText'),get:call('get'),change:call('change'),chooseSchedule:call('chooseSchedule'),importImage:call('importImage'),importImageBytes:call('importImageBytes'),pasteImage:call('pasteImage'),image:call('image'),ocr:call('ocr'),backup:call('backup'),restore:call('restore'),testNotification:call('testNotification'),toggle:call('toggle'),beginDrag:call('beginDrag'),drag:call('drag'),endDrag:call('endDrag'),
 subscribe(callback){const listener=()=>callback();ipcRenderer.on('dayhub:changed',listener);return()=>ipcRenderer.removeListener('dayhub:changed',listener);},
 onError(callback){const listener=(_event,message)=>callback(message);ipcRenderer.on('dayhub:error',listener);return()=>ipcRenderer.removeListener('dayhub:error',listener);}
});
