// Per-process scheduling priority / CPU affinity (power-saver vs performance
// modes) and app CPU/RAM stats. Extracted from public/electron.js (WS-ARCH).
const os = require('os');

function registerSystemIpc({ ipcMain, app, execFile }) {
  // All app process PIDs (main + renderers + GPU + utility).
  const allAppPids = () => {
    const pids = new Set([process.pid]);
    try {
      app.getAppMetrics().forEach((m) => {
        if (m.pid) pids.add(m.pid);
      });
    } catch {
      /* getAppMetrics can throw very early in startup */
    }
    return [...pids];
  };

  const setAffinityLinux = (pids, range) =>
    pids.forEach((pid) => execFile('taskset', ['-cp', range, String(pid)], () => {}));
  const setAffinityWin = (pids, mask) =>
    pids.forEach((pid) =>
      execFile(
        'powershell',
        ['-Command', `try { (Get-Process -Id ${pid}).ProcessorAffinity = ${mask} } catch {}`],
        () => {},
      ),
    );
  const setPriority = (pids, level) =>
    pids.forEach((pid) => {
      try {
        os.setPriority(pid, level);
      } catch {
        /* not permitted / process gone */
      }
    });

  // On Unix a process may lower its own priority freely but needs CAP_SYS_NICE
  // to raise it again — errors are swallowed. On Windows it is fully reversible.
  ipcMain.handle('set-power-saver-priority', () => {
    const pids = allAppPids();
    const totalCores = os.cpus().length;
    const allowedCores = Math.max(1, Math.floor(totalCores / 2));
    setPriority(pids, os.constants.priority.PRIORITY_BELOW_NORMAL);
    if (process.platform === 'linux') setAffinityLinux(pids, `0-${allowedCores - 1}`);
    else if (process.platform === 'win32')
      setAffinityWin(pids, Math.round(Math.pow(2, allowedCores)) - 1);
    // macOS: no user-space affinity API; the priority drop above is the best available.
  });

  const restoreFull = () => {
    const pids = allAppPids();
    const totalCores = os.cpus().length;
    setPriority(pids, os.constants.priority.PRIORITY_NORMAL);
    if (process.platform === 'linux') setAffinityLinux(pids, `0-${totalCores - 1}`);
    else if (process.platform === 'win32')
      setAffinityWin(pids, Math.round(Math.pow(2, totalCores)) - 1);
  };
  ipcMain.handle('restore-process-priority', restoreFull);
  ipcMain.handle('set-performance-priority', restoreFull);

  const PROC_LABEL = {
    Browser: 'MAIN',
    Tab: 'RNDR',
    Renderer: 'RNDR',
    GPU: 'GPU',
    Utility: 'UTIL',
    Crashpad: 'CRSH',
  };

  ipcMain.handle('get-system-stats', () => {
    try {
      const metrics = app.getAppMetrics();

      // CPU percentages can exceed 100 on multi-core; cap the displayed sum.
      const totalCpu = metrics.reduce((s, m) => s + (m.cpu?.percentCPUUsage ?? 0), 0);

      const byType = {};
      for (const m of metrics) {
        const label = PROC_LABEL[m.type] ?? m.type.slice(0, 4).toUpperCase();
        byType[label] = (byType[label] ?? 0) + (m.cpu?.percentCPUUsage ?? 0);
      }
      const processBreakdown = Object.entries(byType)
        .map(([label, pct]) => ({ label, pct: Math.round(pct) }))
        .filter((e) => e.pct > 0)
        .sort((a, b) => b.pct - a.pct);

      const appMemKb = metrics.reduce((s, m) => s + (m.memory?.workingSetSize ?? 0), 0);

      return {
        cpuPercent: Math.min(100, Math.round(totalCpu)),
        cores: os.cpus().length,
        appMemBytes: appMemKb * 1024,
        totalRamBytes: os.totalmem(),
        freeRamBytes: os.freemem(),
        processBreakdown,
      };
    } catch {
      return null;
    }
  });
}

module.exports = { registerSystemIpc };
