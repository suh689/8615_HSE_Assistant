const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "HSE 智能指挥官",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 隐藏默认菜单栏，让界面更像现代应用
  win.setMenuBarVisibility(false);

  // 如果是打包后的环境，加载 dist 目录下的 index.html
  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    // 开发环境下加载本地服务
    win.loadURL('http://localhost:3000');
  }
}

// 数据库文件路径 (存储在用户数据目录，保证打包后可读写)
const dbPath = path.join(app.getPath('userData'), 'hse_database.json');

// 初始化默认数据
const defaultData = {
  knowledgeBase: `1. 夏季作业：TWL 监测 2359 次，空调 BUS 覆盖，中暑率下降 80%+。
2. 驾驶管理：3+4 老带新机制，高级雇员结对，沙漠驾驶“五不准”，副驾驶监督职责。
3. 培训数据：98 次培训，覆盖 463 人；效果验证 1259 人次。
4. 审计面谈：管理层访谈 94 人次；交叉审计 168 次（含 6 次夜间审计）；管理层检查 35 次。
5. 工具更新：2026 版动态野外检查清单，实时化风险管控。`
};

if (!fs.existsSync(dbPath)) {
  fs.writeFileSync(dbPath, JSON.stringify(defaultData, null, 2), 'utf-8');
}

// IPC 处理器：读取数据
ipcMain.handle('get-hse-data', async () => {
  try {
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath, 'utf-8');
      return JSON.parse(data);
    }
    return defaultData;
  } catch (error) {
    console.error('Failed to read DB:', error);
    return defaultData;
  }
});

// IPC 处理器：保存数据
ipcMain.handle('save-hse-data', async (event, newData) => {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(newData, null, 2), 'utf-8');
    return { success: true };
  } catch (error) {
    console.error('Failed to save DB:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
