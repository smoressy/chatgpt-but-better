// index.js
const { spawn, spawnSync } = require('child_process');
const path = require('path');

// 1) Find a working Python interpreter
function locatePython() {
  const candidates = process.platform === 'win32'
    ? [ ['py', ['-3']], ['python', []], ['python3', []] ]
    : [ ['python3', []], ['python', []] ];

  for (const [cmd, baseArgs] of candidates) {
    try {
      const { status } = spawnSync(cmd, [...baseArgs, '--version'], { stdio: 'ignore' });
      if (status === 0) {
        return { cmd, baseArgs };
      }
    } catch (e) {}
  }
  throw new Error(
    'No suitable Python found. Ensure one of: python3, python, or (on Windows) py -3 is on your PATH.'
  );
}

const { cmd: PY_CMD, baseArgs: PY_BASE_ARGS } = locatePython();

// 2) Fire off gpt.py and capture its stdout & stderr
function chatWithAI(prompt) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'gpt.py');
    const args = [...PY_BASE_ARGS, script, prompt];
    const py = spawn(PY_CMD, args, { windowsHide: true });

    let out = '';
    let err = '';

    py.stdout.on('data', chunk => { out += chunk; });
    py.stderr.on('data', chunk => {
      const txt = chunk.toString();
      err += txt;
      // also show it immediately so you can debug Python errors
      console.error('[python stderr]', txt.trim());
    });

    py.on('error', reject);

    py.on('close', code => {
      if (code !== 0) {
        return reject(new Error(
          `gpt.py exited ${code}\n${err.trim() || '[no stderr output]'}`
        ));
      }
      resolve(out.trim());
    });
  });
}

// 3) Demo
(async () => {
  try {
    console.log(`Using: ${PY_CMD} ${PY_BASE_ARGS.join(' ')}`);
    const reply = await chatWithAI("Hello");
    console.log("AI says:", reply);
  } catch (e) {
    console.error("❌", e.message);
    process.exit(1);
  }
})();