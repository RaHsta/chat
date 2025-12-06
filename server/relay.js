
const WebSocket = require('ws');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORTS = [8080, 8081, 8082];
let currentDir = os.homedir();

function startServer(index) {
  if (index >= PORTS.length) {
    console.error('All configured ports are in use. Please close existing relay instances.');
    process.exit(1);
  }

  const port = PORTS[index];
  console.log(`Attempting to start on port ${port}...`);

  // Create HTTP server first to handle EADDRINUSE robustly
  const server = http.createServer();

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use.`);
      startServer(index + 1);
    } else {
      console.error('Server error:', err);
    }
  });

  server.listen(port, () => {
    console.log(`\x1b[36mGemini Relay Server running on port ${port}\x1b[0m`);
    console.log(`\x1b[33mAllowing execution in: ${currentDir}\x1b[0m`);
    
    // Attach WebSocket server to the HTTP server
    const wss = new WebSocket.Server({ server });
    
    wss.on('connection', (ws) => {
      console.log('Client connected');
      ws.send(JSON.stringify({ type: 'system', content: `Connected to Host: ${os.hostname()}` }));
      ws.send(JSON.stringify({ type: 'cwd', content: currentDir }));
      
      // Check Admin
      if (os.platform() === 'win32') {
        require('child_process').exec('net session', function(err, so, se) {
          if(se.length === 0) {
             ws.send(JSON.stringify({ type: 'system', content: `ADMIN: TRUE` }));
          } else {
             ws.send(JSON.stringify({ type: 'system', content: `ADMIN: FALSE` }));
             ws.send(JSON.stringify({ type: 'error', content: `WARNING: Process running without Administrator privileges.\nAdmin rights are required for full functionality.` }));
          }
        });
      } else {
         if (process.getuid && process.getuid() === 0) {
             ws.send(JSON.stringify({ type: 'system', content: `ADMIN: TRUE` }));
         } else {
             ws.send(JSON.stringify({ type: 'system', content: `ADMIN: FALSE` }));
             // Optional: warn on non-root Linux if desired, but sticking to explicit Windows admin check request
         }
      }

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          if (data.type === 'command') {
            const cmdString = data.content.trim();
            console.log(`Executing: ${cmdString}`);
            
            if (cmdString.startsWith('cd ')) {
               const target = cmdString.substring(3).trim();
               try {
                 const resolvedTarget = target.replace('~', os.homedir());
                 const newDir = path.resolve(currentDir, resolvedTarget);
                 
                 if (fs.existsSync(newDir) && fs.lstatSync(newDir).isDirectory()) {
                     process.chdir(newDir);
                     currentDir = newDir;
                     ws.send(JSON.stringify({ type: 'cwd', content: currentDir }));
                     ws.send(JSON.stringify({ type: 'output', content: '' })); 
                 } else {
                     ws.send(JSON.stringify({ type: 'error', content: `cd: ${target}: No such directory` }));
                 }
               } catch (err) {
                 ws.send(JSON.stringify({ type: 'error', content: `cd: ${err.message}` }));
               }
               return;
            }

            const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
            const shellArgs = os.platform() === 'win32' ? ['-Command', cmdString] : ['-c', cmdString];

            // Pass env: process.env to allow access to PATH
            const child = spawn(shell, shellArgs, { 
                cwd: currentDir, 
                shell: true,
                env: process.env 
            });

            child.stdout.on('data', (chunk) => {
              ws.send(JSON.stringify({ type: 'output', content: chunk.toString() }));
            });

            child.stderr.on('data', (chunk) => {
              ws.send(JSON.stringify({ type: 'error', content: chunk.toString() }));
            });

            child.on('error', (err) => {
               ws.send(JSON.stringify({ type: 'error', content: `Failed to start: ${err.message}` }));
            });
          }
          else if (data.type === 'write') {
            const { filename, content } = data;
            const filePath = path.resolve(currentDir, filename);
            console.log(`Writing file: ${filePath}`);
            
            fs.writeFile(filePath, content, (err) => {
               if (err) {
                 ws.send(JSON.stringify({ type: 'error', content: `Write failed: ${err.message}` }));
               } else {
                 ws.send(JSON.stringify({ type: 'system', content: `Saved memory to ${filename}` }));
               }
            });
          }
        } catch (e) {
          console.error('Failed to parse message', e);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
      });
    });
  });
}

startServer(0);
