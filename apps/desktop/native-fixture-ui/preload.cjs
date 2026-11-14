const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('syntheticReview', {
  request: payload => ipcRenderer.invoke('synthetic-review', payload)
})
