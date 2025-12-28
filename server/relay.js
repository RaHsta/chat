
const WebSocket = require('ws');
const http = require('http');
const { spawn, exec, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

/**
 * ARCHITECT BRIDGE MASTER v4.0.0
 * -----------------------------------------
 * This is the core logic for the local agent.
 * 
 * OMNI-INSTALLER BLUEPRINT (COPY-PASTE FOR MANUAL SETUP):
 * Windows (CMD):
 *   curl -o setup.bat https://[YOUR_URL]/setup-script && setup.bat
 * 
 * Logic includes:
 * 1. Node.js detection
 * 2. Automatic binary download (Windows)
 * 3. Dependency resolution (ws)
 * 4. Handshake authentication
 */

const CONFIG = {
  TOKEN: process.env.ARCHITECT_TOKEN || null,
  PORTS: [8080, 8081, 8082, 8083],
  VERSION: "4.0.0",
  PLATFORM: os.platform(),
  IS_WIN: os.platform() === 'win32'
};

let currentDir = os.homedir();

async function getSystemTelemetry() {
  const isAdmin = await new Promise((res) => {
    if (CONFIG.IS_WIN) exec('net session', (err) => res(!err));
    else res(typeof process.getuid === 'function' && process.getuid() === 0);
  });
  return {
    version: CONFIG.VERSION,
    platform: CONFIG.PLATFORM,
    hostname: os.hostname(),
    arch: os.arch(),
    cpu: os.cpus()[0].model,
    uptime: os.uptime(),
    totalMemory: (os.totalmem() / 1024 / 1024 / 1024).toFixed(2) + "GB",
    isAdmin
  };
}

function startRelay(portIndex) {
  if (portIndex >= CONFIG.PORTS.length) {
    console.error('[CRITICAL] No ports available.');
    process.exit(1);
  }

  const port = CONFIG.PORTS[portIndex];
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200);
      res.end('OK');
    }
  });
  
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') startRelay(portIndex + 1);
    else console.error('[SERVER_ERROR]', err);
  });

  server.listen(port, () => {
    console.log(`\x1b[31m[ARCHITECT CORE v${CONFIG.VERSION} ONLINE]\x1b[0m`);
    console.log(`  LINK: \x1b[33mws://localhost:${port}\x1b[0m`);
    console.log(`  AUTH: \x1b[35m${CONFIG.TOKEN ? 'ACTIVE' : 'OPEN_Handshake'}\x1b[0m`);
    console.log('-----------------------------------------');

    const wss = new WebSocket.Server({ server });
    wss.on('connection', (ws) => {
      let authorized = !CONFIG.TOKEN;
      console.log(`[${new Date().toLocaleTimeString()}] Bridge request detected.`);

      const broadcastStatus = async (rid) => {
        const stats = await getSystemTelemetry();
        ws.send(JSON.stringify({ type: 'config', ...stats, requestId: rid }));
        ws.send(JSON.stringify({ type: 'cwd', content: currentDir, requestId: rid }));
      };

      if (authorized) {
        ws.send(JSON.stringify({ type: 'auth_success' }));
        broadcastStatus();
      }

      ws.on('message', async (raw) => {
        try {
          const msg = JSON.parse(raw);
          const rid = msg.requestId;

          if (msg.type === 'auth') {
            if (!CONFIG.TOKEN || msg.token === CONFIG.TOKEN) {
              authorized = true;
              console.log('[SECURITY] Auth successful.');
              ws.send(JSON.stringify({ type: 'auth_success', requestId: rid }));
              await broadcastStatus(rid);
            } else {
              console.warn('[SECURITY] Auth rejected.');
              ws.send(JSON.stringify({ type: 'auth_fail', requestId: rid }));
              ws.close();
            }
            return;
          }

          if (!authorized) return;

          switch (msg.type) {
            case 'command':
              const input = msg.content.trim();
              if (input.startsWith('cd ')) {
                const target = path.resolve(currentDir, input.substring(3).trim().replace('~', os.homedir()));
                if (fs.existsSync(target)) {
                  currentDir = target;
                  process.chdir(currentDir);
                  ws.send(JSON.stringify({ type: 'cwd', content: currentDir, requestId: rid }));
                } else {
                  ws.send(JSON.stringify({ type: 'error', content: 'Directory not found: ' + target, requestId: rid }));
                }
                break;
              }

              const shell = CONFIG.IS_WIN ? 'powershell.exe' : 'bash';
              const args = CONFIG.IS_WIN ? ['-NoProfile', '-Command', input] : ['-c', input];
              const proc = spawn(shell, args, { cwd: currentDir, shell: true });
              
              proc.stdout.on('data', (d) => ws.send(JSON.stringify({ type: 'output', content: d.toString(), requestId: rid })));
              proc.stderr.on('data', (d) => ws.send(JSON.stringify({ type: 'error', content: d.toString(), requestId: rid })));
              proc.on('close', (c) => ws.send(JSON.stringify({ type: 'exit', code: c, requestId: rid })));
              break;

            case 'read':
              const rPath = path.resolve(currentDir, msg.path);
              fs.readFile(rPath, 'utf8', (err, data) => {
                ws.send(JSON.stringify({ type: err ? 'error' : 'file_content', content: err ? err.message : data, requestId: rid }));
              });
              break;

            case 'write':
              const wPath = path.resolve(currentDir, msg.filename);
              fs.mkdir(path.dirname(wPath), { recursive: true }, (err) => {
                if (err) return ws.send(JSON.stringify({ type: 'error', content: err.message, requestId: rid }));
                fs.writeFile(wPath, msg.content, (err) => {
                  ws.send(JSON.stringify({ type: err ? 'error' : 'system', content: err ? err.message : 'Write operation successful.', requestId: rid }));
                });
              });
              break;

            case 'open':
              const opener = CONFIG.IS_WIN ? 'start ""' : (CONFIG.PLATFORM === 'darwin' ? 'open' : 'xdg-open');
              exec(`${opener} "${msg.target}"`);
              break;
          }
        } catch (e) {
          console.error('[BRIDGE_FAULT]', e);
        }
      });
    });
  });
}

startRelay(0);
