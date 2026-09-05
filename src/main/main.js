const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const aiService = require('./services/aiService.js');
const pdfAnnotations = require('./utils/pdfAnnotations.js');
const openrouterModels = require('./utils/openrouterModels.js');

let store = {
  get: (key, defaultValue) => defaultValue,
  set: () => {},
};

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    backgroundColor: '#0f2027',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // Allow loading local files
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

async function initializeStore() {
  try {
    const Store = require('electron-store');
    store = new Store({
      schema: {
        openrouterApiKey: { type: 'string', default: '' },
        openrouterModel: { type: 'string', default: '' },
        recentModels: { type: 'array', default: [], items: { type: 'string' }, maxItems: 8 },
        recentDocuments: {
          type: 'array',
          default: [],
          items: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              name: { type: 'string' },
              lastAccessed: { type: 'string' },
            },
          },
          maxItems: 10,
        },
        documentSpecificData: {
          type: 'object',
          default: {},
          additionalProperties: {
            type: 'object',
            properties: {
              lastViewedPage: { type: 'number', default: 1 },
            },
          },
        },
      },
    });
  } catch (error) {
    console.error('Failed to initialize Electron Store:', error);
  }
}

app.whenReady().then(async () => {
  await initializeStore();
  createWindow();
  setupHandlers();
});

function sanitizePathKey(filePath) {
  return String(filePath || '').replace(/[.]/g, '_');
}

function setupHandlers() {
  aiService.updateSettings(store.get('openrouterApiKey', ''), store.get('openrouterModel', ''));

  ipcMain.handle('dialog:openFile', async () => {
    try {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
      });
      if (!result || result.canceled || !result.filePaths?.length) return null;
      const filePath = result.filePaths[0];
      if (!fs.existsSync(filePath)) return null;
      fs.accessSync(filePath, fs.constants.R_OK);
      addRecentDocument(filePath);
      return filePath;
    } catch (error) {
      console.error('Error showing open dialog:', error);
      return null;
    }
  });

  ipcMain.handle('pdf:readFile', async (event, filePath) => {
    try {
      const data = fs.readFileSync(filePath);
      return data.toString('base64');
    } catch (error) {
      console.error('Error reading PDF file:', error);
      throw error;
    }
  });

  ipcMain.handle('pdf:getAnnotations', async (event, filePath) => {
    try {
      return await pdfAnnotations.getAnnotations(filePath);
    } catch (error) {
      console.error('Error reading PDF annotations:', error);
      return [];
    }
  });

  ipcMain.handle('pdf:saveAnnotation', async (event, filePath, annotation) => {
    try {
      const id = await pdfAnnotations.saveAnnotation(filePath, annotation);
      return { success: true, id };
    } catch (error) {
      console.error('Error saving PDF annotation:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('pdf:saveDocumentNote', async (event, filePath, note) => {
    try {
      const id = await pdfAnnotations.saveDocumentNote(filePath, note);
      return { success: true, id };
    } catch (error) {
      console.error('Error saving document note:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('settings:get', async () => ({
    apiKey: store.get('openrouterApiKey', ''),
    model: store.get('openrouterModel', '') || aiService.getModel(),
    recentModels: store.get('recentModels', []),
  }));

  ipcMain.handle('settings:set', async (event, { apiKey, model }) => {
    try {
      store.set('openrouterApiKey', apiKey || '');
      store.set('openrouterModel', model || '');
      const trimmedModel = (model || '').trim();
      if (trimmedModel) {
        let recentModels = store.get('recentModels', []);
        if (!Array.isArray(recentModels)) recentModels = [];
        recentModels = [trimmedModel, ...recentModels.filter((m) => m !== trimmedModel)].slice(0, 8);
        store.set('recentModels', recentModels);
      }
      aiService.updateSettings(apiKey, model);
      return { success: true };
    } catch (error) {
      console.error('Error saving settings:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.on('ai:converse-request', async (event, { payload, streamId }) => {
    try {
      await aiService.converseAndStream(payload, streamId, (chunk) => {
        if (event.sender && !event.sender.isDestroyed()) event.sender.send('ai:converse-chunk', chunk);
      });
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('ai:converse-end', streamId);
    } catch (error) {
      console.error('Error in ai:converse-request:', error);
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('ai:converse-chunk', { streamId, type: 'error', content: error.message });
      }
    }
  });

  ipcMain.handle('ai:summarize-request', async (event, payload) => {
    try {
      return await aiService.summarizeConversation(payload);
    } catch (error) {
      console.error('Error in ai:summarize-request:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('models:list', async () => openrouterModels.listModels());
  ipcMain.handle('models:get', async (event, modelId) => openrouterModels.getModelInfo(modelId));

  ipcMain.handle('recentDocuments:get', async () => getRecentDocuments());
  ipcMain.handle('recentDocuments:add', async (event, filePath) => {
    addRecentDocument(filePath);
    return true;
  });
  ipcMain.handle('recentDocuments:remove', async (event, filePath) => {
    removeRecentDocument(filePath);
    return true;
  });

  ipcMain.handle('document:getLastViewedPage', async (event, filePath) => {
    const docData = store.get(`documentSpecificData.${sanitizePathKey(filePath)}`, {});
    return docData.lastViewedPage || 1;
  });

  ipcMain.handle('document:saveLastViewedPage', async (event, filePath, pageNumber) => {
    store.set(`documentSpecificData.${sanitizePathKey(filePath)}.lastViewedPage`, pageNumber);
    return true;
  });
}

function addRecentDocument(filePath) {
  if (!filePath) return;
  const name = path.basename(filePath);
  const docInfo = { path: filePath, name, lastAccessed: new Date().toISOString() };
  let recentDocs = store.get('recentDocuments', []);
  if (!Array.isArray(recentDocs)) recentDocs = [];
  recentDocs = recentDocs.filter((doc) => doc?.path !== filePath);
  recentDocs.unshift(docInfo);
  if (recentDocs.length > 10) recentDocs = recentDocs.slice(0, 10);
  store.set('recentDocuments', recentDocs);
}

function getRecentDocuments() {
  return store.get('recentDocuments', []);
}

function removeRecentDocument(filePath) {
  if (!filePath) return false;
  let recentDocs = store.get('recentDocuments', []);
  if (!Array.isArray(recentDocs)) return false;
  const updatedDocs = recentDocs.filter((doc) => doc?.path !== filePath);
  if (updatedDocs.length === recentDocs.length) return false;
  store.set('recentDocuments', updatedDocs);

  const docData = store.get('documentSpecificData', {});
  const key = sanitizePathKey(filePath);
  if (docData[key]) {
    delete docData[key];
    store.set('documentSpecificData', docData);
  }
  return true;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
