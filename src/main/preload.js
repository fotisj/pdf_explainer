const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  readPdfFile: (filePath) => ipcRenderer.invoke('pdf:readFile', filePath),

  getAnnotations: (filePath) => ipcRenderer.invoke('pdf:getAnnotations', filePath),
  saveAnnotation: (filePath, annotation) => ipcRenderer.invoke('pdf:saveAnnotation', filePath, annotation),
  saveDocumentNote: (filePath, note) => ipcRenderer.invoke('pdf:saveDocumentNote', filePath, note),
  deleteAnnotation: (filePath, id) => ipcRenderer.invoke('pdf:deleteAnnotation', filePath, id),
  updateAnnotationNote: (filePath, id, note) => ipcRenderer.invoke('pdf:updateAnnotationNote', filePath, id, note),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (settings) => ipcRenderer.invoke('settings:set', settings),

  aiConverse: (payload, streamId) => ipcRenderer.send('ai:converse-request', { payload, streamId }),
  aiSummarize: (payload) => ipcRenderer.invoke('ai:summarize-request', payload),
  onConverseChunk: (callback) => {
    const listener = (_event, chunk) => callback(chunk);
    ipcRenderer.on('ai:converse-chunk', listener);
    return () => ipcRenderer.removeListener('ai:converse-chunk', listener);
  },
  onConverseEnd: (callback) => {
    const listener = (_event, streamId) => callback(streamId);
    ipcRenderer.on('ai:converse-end', listener);
    return () => ipcRenderer.removeListener('ai:converse-end', listener);
  },

  getModels: () => ipcRenderer.invoke('models:list'),
  getModelInfo: (modelId) => ipcRenderer.invoke('models:get', modelId),

  getRecentDocuments: () => ipcRenderer.invoke('recentDocuments:get'),
  addRecentDocument: (filePath) => ipcRenderer.invoke('recentDocuments:add', filePath),
  removeRecentDocument: (filePath) => ipcRenderer.invoke('recentDocuments:remove', filePath),

  getLastViewedPage: (filePath) => ipcRenderer.invoke('document:getLastViewedPage', filePath),
  saveLastViewedPage: (filePath, pageNumber) => ipcRenderer.invoke('document:saveLastViewedPage', filePath, pageNumber),
});
