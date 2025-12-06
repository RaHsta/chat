const WebSocket = require('ws');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

let currentDir = os.homedir();

console.log(`\x1b[36mGemini Relay Server running on port ${PORT}\x1b[0m`);
console.log(`\x1b[33mAllowing execution in: ${currentDir}\x1b[0m`);

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.send(JSON.stringify({ type: 'system', content: `Connected to Host: ${os.hostname()}` }));
  ws.send(JSON.stringify({ type: 'cwd', content: currentDir }));

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'command') {
        const cmdString = data.content.trim();
        console.log(`Executing: ${cmdString}`);
        
        // Handle 'cd' internally
        if (cmdString.startsWith('cd ')) {
           const target = cmdString.substring(3).trim();
           try {
             // Handle "cd ~" or similar if needed
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

        // CRITICAL: Pass env: process.env to allow access to PATH (git, node, code, etc.)
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