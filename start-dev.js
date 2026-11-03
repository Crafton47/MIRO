const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const net = require('net');
const fs = require('fs');

const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

function getLanIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const networkFile = path.join(__dirname, '.certs', 'network.json');
const configured = fs.existsSync(networkFile) ? JSON.parse(fs.readFileSync(networkFile, 'utf8').replace(/^\uFEFF/, '')) : {};
const lanIp = process.env.MIRO_LAN_IP || configured.lanIp || getLanIp();
const protocol = process.env.MIRO_HTTPS === 'false' ? 'http' : 'https';
if (protocol === 'https' && !fs.existsSync(process.env.MIRO_TLS_CERT || path.join(__dirname, '.certs', 'miro.pem'))) {
  console.error('Run npm run setup:https first. See NETWORK_SETUP.md for trusted phone HTTPS.');
  process.exit(1);
}

console.log('\x1b[36m%s\x1b[0m', '==================================================');
console.log('\x1b[36m%s\x1b[0m', '🚀 Launching MIRO Ride-Hailing Platform');
console.log('\x1b[36m%s\x1b[0m', `   💻 Laptop Rider:    ${protocol}://localhost:5173`);
console.log('\x1b[36m%s\x1b[0m', `   📱 Mobile Driver:   ${protocol}://${lanIp}:5173`);
console.log('\x1b[36m%s\x1b[0m', `   📡 Backend Server:  http://${lanIp}:3000`);
console.log('\x1b[36m%s\x1b[0m', '==================================================');

function checkPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', (err) => {
        if (err.code === 'EADDRINUSE') resolve(true);
        else resolve(false);
      })
      .once('listening', () => {
        tester.once('close', () => resolve(false)).close();
      })
      .listen(port);
  });
}

let backend = null;
let frontend = null;

async function start() {
  const backendRunning = await checkPort(3000);
  const frontendRunning = await checkPort(5173);

  if (backendRunning) {
    console.log('\x1b[33m%s\x1b[0m', 'ℹ️  Backend is already listening on port 3000 (reusing existing process).');
  } else {
    backend = spawn(`${npmCmd} run dev`, {
      cwd: path.join(__dirname, 'backend'),
      stdio: 'inherit',
      shell: true,
    });
  }

  if (frontendRunning) {
    console.log('\x1b[33m%s\x1b[0m', 'ℹ️  Frontend is already running on port 5173 (or alternate port).');
  } else {
    frontend = spawn(`${npmCmd} run dev`, {
      cwd: path.join(__dirname, 'frontend'),
      stdio: 'inherit',
      shell: true,
    });
  }
}

start();

function cleanup() {
  console.log('\n\x1b[33m%s\x1b[0m', 'Shutting down services...');
  if (backend && !backend.killed && backend.pid) {
    if (isWin) {
      spawn('taskkill', ['/pid', backend.pid.toString(), '/f', '/t']);
    } else {
      backend.kill('SIGINT');
    }
  }
  if (frontend && !frontend.killed && frontend.pid) {
    if (isWin) {
      spawn('taskkill', ['/pid', frontend.pid.toString(), '/f', '/t']);
    } else {
      frontend.kill('SIGINT');
    }
  }
  process.exit();
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
