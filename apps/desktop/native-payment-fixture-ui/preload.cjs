const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('syntheticPayment', { request: payload => ipcRenderer.invoke('synthetic-payment', payload) })
