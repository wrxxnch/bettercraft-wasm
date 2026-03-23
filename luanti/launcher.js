'use strict';

// Configuração para o BetterCraft Web
const RELEASE_DIR = '/luanti';
const DEFAULT_PACKS_DIR = RELEASE_DIR;

const rtCSS = `
body {
  font-family: arial;
  margin: 0;
  padding: 0;
  background-color: black;
  overflow: hidden;
}

.emscripten {
  color: #aaaaaa;
  padding-right: 0;
  margin-left: auto;
  margin-right: auto;
  display: block;
}

div.emscripten {
  text-align: center;
  width: 100%;
  height: 100%;
}

canvas.emscripten {
  border: 0px none;
  background-color: black;
  width: 100%;
  height: 100%;
  display: block;
}

#controls {
  display: inline-block;
  vertical-align: top;
  height: 25px;
  z-index: 100;
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  padding: 10px;
  border-radius: 5px;
}

.console {
  width: 100%;
  margin: 0 auto;
  margin-top: 0px;
  border-left: 0px;
  border-right: 0px;
  padding-left: 0px;
  padding-right: 0px;
  display: block;
  background-color: black;
  color: white;
  font-family: 'Lucida Console', Monaco, monospace;
  outline: none;
}
`;

const rtHTML = `
  <div id="header" style="position: absolute; top: 0; left: 0; right: 0; z-index: 100;">
    <div class="emscripten">
      <span id="controls">
        <span>
          <select id="resolution" onchange="fixGeometry()">
            <option value="high">High Res</option>
            <option value="medium">Medium</option>
            <option value="low">Low Res</option>
          </select>
        </span>
        <span>
          <select id="aspectRatio" onchange="fixGeometry()">
            <option value="any">Fit Screen</option>
            <option value="4:3">4:3</option>
            <option value="16:9">16:9</option>
            <option value="5:4">5:4</option>
            <option value="21:9">21:9</option>
            <option value="32:9">32:9</option>
            <option value="1:1">1:1</option>
          </select>
        </span>
        <span><input id="console_button" type="button" value="Show Console" onclick="consoleToggle()"></span>
      </span>
      <div id="progressbar_div" style="display: none">
        <progress id="progressbar" value="0" max="100">0%</progress>
      </div>
    </div>
  </div>

  <div class="emscripten" id="canvas_container">
  </div>

  <div id="footer">
    <textarea id="console_output" class="console" rows="8" style="display: none; height: 200px"></textarea>
  </div>
`;

// Canvas criado antes do carregamento do módulo WASM
const mtCanvas = document.createElement('canvas');
mtCanvas.className = "emscripten";
mtCanvas.id = "canvas";
mtCanvas.oncontextmenu = (event) => {
  event.preventDefault();
};
mtCanvas.tabIndex = -1;
mtCanvas.width = 1024;
mtCanvas.height = 600;

var consoleButton;
var consoleOutput;
var progressBar;
var progressBarDiv;

function activateBody() {
    const extraCSS = document.createElement("style");
    extraCSS.innerText = rtCSS;
    document.head.appendChild(extraCSS);

    // Obter o container do jogo
    const gameContainer = document.getElementById('game-container');
    if (!gameContainer) {
        console.error('Container do jogo não encontrado');
        return;
    }

    // Limpar container
    gameContainer.innerHTML = '';

    const mtContainer = document.createElement('div');
    mtContainer.innerHTML = rtHTML;
    gameContainer.appendChild(mtContainer);

    const canvasContainer = document.getElementById('canvas_container');
    if (canvasContainer) {
        canvasContainer.appendChild(mtCanvas);
    }

    setupResizeHandlers();

    consoleButton = document.getElementById('console_button');
    consoleOutput = document.getElementById('console_output');
    consoleUpdate();

    progressBar = document.getElementById('progressbar');
    progressBarDiv = document.getElementById('progressbar_div');
    updateProgressBar(0, 0);
}

var PB_bytes_downloaded = 0;
var PB_bytes_needed = 0;
function updateProgressBar(doneBytes, neededBytes) {
    PB_bytes_downloaded += doneBytes;
    PB_bytes_needed += neededBytes;
    if (progressBar) {
        progressBarDiv.style.display = (PB_bytes_downloaded == PB_bytes_needed) ? "none" : "block";
        const pct = PB_bytes_needed ? Math.round(100 * PB_bytes_downloaded / PB_bytes_needed) : 0;
        progressBar.value = `${pct}`;
        progressBar.innerText = `${pct}%`;
    }
}

var mtLauncher = null;

class LaunchScheduler {
    constructor() {
        this.conditions = new Map();
        window.requestAnimationFrame(this.invokeCallbacks.bind(this));
    }

    isSet(name) {
        return this.conditions.get(name)[0];
    }

    addCondition(name, startCallback = null, deps = []) {
        this.conditions.set(name, [false, new Set(), startCallback]);
        for (const depname of deps) {
            this.addDep(name, depname);
        }
    }

    addDep(name, depname) {
        if (!this.isSet(depname)) {
            this.conditions.get(name)[1].add(depname);
        }
    }

    setCondition(name) {
        if (this.isSet(name)) {
            throw new Error('Scheduler condition set twice');
        }
        this.conditions.get(name)[0] = true;
        this.conditions.forEach(v => {
            v[1].delete(name);
        });
        window.requestAnimationFrame(this.invokeCallbacks.bind(this));
    }

    clearCondition(name, newCallback = null, deps = []) {
        if (!this.isSet(name)) {
            throw new Error('clearCondition called on unset condition');
        }
        const arr = this.conditions.get(name);
        arr[0] = false;
        arr[1] = new Set(deps);
        arr[2] = newCallback;
    }

    invokeCallbacks() {
        const callbacks = [];
        this.conditions.forEach(v => {
            if (!v[0] && v[1].size == 0 && v[2] !== null) {
                callbacks.push(v[2]);
                v[2] = null;
            }
        });
        callbacks.forEach(cb => cb());
    }
}
const mtScheduler = new LaunchScheduler();

function loadWasm() {
    const mtModuleScript = document.createElement("script");
    mtModuleScript.type = "text/javascript";
    mtModuleScript.src = RELEASE_DIR + "/luanti.js";
    mtModuleScript.async = true;
    document.head.appendChild(mtModuleScript);
}

function callMain() {
    const fullargs = [ './minetest', ...mtLauncher.args.toArray() ];
    const [argc, argv] = makeArgv(fullargs);
    emloop_invoke_main(argc, argv);
    emloop_request_animation_frame();
    mtScheduler.setCondition("main_called");
}

var emloop_pause;
var emloop_unpause;
var emloop_init_sound;
var emloop_invoke_main;
var emloop_install_pack;
var emloop_set_minetest_conf;
var irrlicht_want_pointerlock;
var irrlicht_force_pointerlock;
var irrlicht_resize;
var emsocket_init;
var emsocket_set_proxy;
var emsocket_set_vpn;

function emloop_ready() {
    emloop_pause = cwrap("emloop_pause", null, []);
    emloop_unpause = cwrap("emloop_unpause", null, []);
    emloop_init_sound = cwrap("emloop_init_sound", null, []);
    emloop_invoke_main = cwrap("emloop_invoke_main", null, ["number", "number"]);
    emloop_install_pack = cwrap("emloop_install_pack", null, ["number", "number", "number"]);
    emloop_set_minetest_conf = cwrap("emloop_set_minetest_conf", null, ["number"]);
    irrlicht_want_pointerlock = cwrap("irrlicht_want_pointerlock", "number");
    irrlicht_force_pointerlock = cwrap("irrlicht_force_pointerlock", null);
    irrlicht_resize = cwrap("irrlicht_resize", null, ["number", "number"]);
    emsocket_init = cwrap("emsocket_init", null, []);
    emsocket_set_proxy = cwrap("emsocket_set_proxy", null, ["number"]);
    emsocket_set_vpn = cwrap("emsocket_set_vpn", null, ["number"]);
    mtScheduler.setCondition("wasmReady");
}

function emloop_request_animation_frame() {
    emloop_pause();
    window.requestAnimationFrame(() => { emloop_unpause(); });
}

function makeArgv(args) {
    const argv = _malloc((args.length + 1) * 4);
    let i;
    for (i = 0; i < args.length; i++) {
        HEAPU32[(argv >>> 2) + i] = stringToNewUTF8(args[i]);
    }
    HEAPU32[(argv >>> 2) + i] = 0;
    return [i, argv];
}

var consoleText = [];
var consoleLengthMax = 1000;
var consoleTextLast = 0;
var consoleDirty = false;
function consoleUpdate() {
    if (consoleDirty) {
        if (consoleText.length > consoleLengthMax) {
            consoleText = consoleText.slice(-consoleLengthMax);
        }
        if (consoleOutput) {
            consoleOutput.value = consoleText.join('');
            consoleOutput.scrollTop = consoleOutput.scrollHeight;
        }
        consoleDirty = false;
    }
    window.requestAnimationFrame(consoleUpdate);
}

function consoleToggle() {
    if (consoleOutput) {
        consoleOutput.style.display = (consoleOutput.style.display == 'block') ? 'none' : 'block';
        if (consoleButton) {
            consoleButton.value = (consoleOutput.style.display == 'none') ? 'Show Console' : 'Hide Console';
        }
        fixGeometry();
    }
}

var enableTracing = false;
function consolePrint(text) {
    if (enableTracing) {
        console.trace(text);
    }
    consoleText.push(text + "\n");
    consoleDirty = true;
    if (mtLauncher && mtLauncher.onprint) {
        mtLauncher.onprint(text);
    }
}

var Module = {
    preRun: [],
    postRun: [],
    print: consolePrint,
    canvas: (function() {
        mtCanvas.addEventListener("webglcontextlost", function(e) { 
            alert('WebGL context lost. You will need to reload the page.'); 
            e.preventDefault(); 
        }, false);
        return mtCanvas;
    })(),
    setStatus: function(text) {
        if (text) Module.print('[wasm module status] ' + text);
    },
    totalDependencies: 0,
    monitorRunDependencies: function(left) {
        this.totalDependencies = Math.max(this.totalDependencies, left);
        if (!mtLauncher || !mtLauncher.onprogress) return;
        mtLauncher.onprogress('wasm_module', (this.totalDependencies-left) / this.totalDependencies);
    }
};

Module['printErr'] = Module['print'];
Module['mainScriptUrlOrBlob'] = RELEASE_DIR + '/worker.js';
Module['onFullScreen'] = () => { fixGeometry(); };
window.onerror = function(event) {
    consolePrint('Exception thrown, see JavaScript console');
};

function resizeCanvas(width, height) {
    const canvas = mtCanvas;
    if (canvas.width != width || canvas.height != height) {
        canvas.width = width;
        canvas.height = height;
        canvas.widthNative = width;
        canvas.heightNative = height;
    }
    irrlicht_resize(width, height);
}

function now() {
    return (new Date()).getTime();
}

var fixGeometryPause = 0;
function fixGeometry(override) {
    if (!override && now() < fixGeometryPause) {
        return;
    }
    const resolutionSelect = document.getElementById('resolution');
    const aspectRatioSelect = document.getElementById('aspectRatio');
    var canvas = mtCanvas;
    if (!canvas || !resolutionSelect || !aspectRatioSelect) return;
    
    var resolution = resolutionSelect.value;
    var aspectRatio = aspectRatioSelect.value;
    var screenX;
    var screenY;

    canvas.focus();

    var isFullScreen = document.fullscreenElement ? true : false;
    if (isFullScreen) {
        screenX = screen.width;
        screenY = screen.height;
    } else {
        var controls = document.getElementById('controls');
        var maximized = !window.screenTop && !window.screenY;
        if (controls) {
            controls.style = maximized ? 'display: none' : '';
        }

        var header = document.getElementById('header');
        var footer = document.getElementById('footer');
        var headerHeight = header ? header.offsetHeight : 0;
        var footerHeight = footer ? footer.offsetHeight : 0;
        screenX = document.documentElement.clientWidth - 6;
        screenY = document.documentElement.clientHeight - headerHeight - footerHeight - 6;
    }

    if (aspectRatio != 'any') {
        var parts = aspectRatio.split(':');
        var aspect = parseFloat(parts[0]) / parseFloat(parts[1]);
        var canvasAspect = screenX / screenY;
        if (canvasAspect > aspect) {
            screenX = Math.floor(screenY * aspect);
        } else {
            screenY = Math.floor(screenX / aspect);
        }
    }

    switch (resolution) {
        case 'high':
            break;
        case 'medium':
            screenX = Math.floor(screenX * 0.75);
            screenY = Math.floor(screenY * 0.75);
            break;
        case 'low':
            screenX = Math.floor(screenX * 0.5);
            screenY = Math.floor(screenY * 0.5);
            break;
    }

    resizeCanvas(screenX, screenY);
    fixGeometryPause = now() + 250;
}

function setupResizeHandlers() {
    window.addEventListener('resize', fixGeometry);
    window.addEventListener('fullscreenchange', fixGeometry);
    fixGeometry(true);
}

class MinetestArgs {
    constructor() {
        this.go = false;
        this.server = false;
        this.name = '';
        this.password = '';
        this.address = '';
        this.port = 0;
        this.gameid = '';
        this.packs = [];
        this.extra = [];
    }

    toArray() {
        const result = [];
        if (this.go) result.push('--go');
        if (this.server) result.push('--server');
        if (this.name) result.push('--name', this.name);
        if (this.password) result.push('--password', this.password);
        if (this.gameid) result.push('--gameid', this.gameid);
        if (this.address) result.push('--address', this.address);
        if (this.port) result.push('--port', this.port.toString());
        return result;
    }
}

class MinetestLauncher {
    constructor() {
        if (mtLauncher !== null) {
            throw new Error("There can be only one launcher");
        }
        mtLauncher = this;
        this.args = null;
        this.onprogress = null;
        this.onready = null;
        this.onerror = null;
        this.onprint = null;
        this.addedPacks = new Set();
        this.vpn = null;
        this.serverCode = null;
        this.clientCode = null;
        this.proxyUrl = "wss://minetest.dustlabs.io/proxy";
        this.packsDir = DEFAULT_PACKS_DIR;
        this.packsDirIsCors = false;
        this.minetestConf = new Map();

        mtScheduler.addCondition("wasmReady", loadWasm);
        mtScheduler.addCondition("launch_called");
        mtScheduler.addCondition("ready", this.#notifyReady.bind(this), ['wasmReady']);
        mtScheduler.addCondition("main_called", callMain, ['ready', 'launch_called']);
        this.addPack('base');
    }

    setProxy(url) {
        this.proxyUrl = url;
    }

    setPacksDir(url, is_cors) {
        this.packsDir = url;
        this.packsDirIsCors = is_cors;
    }

    #notifyReady() {
        mtScheduler.setCondition("ready");
        if (this.onready) this.onready();
    }

    isReady() {
        return mtScheduler.isSet("ready");
    }

    setVPN(serverCode, clientCode) {
        this.serverCode = serverCode;
        this.clientCode = clientCode;
        this.vpn = serverCode ? serverCode : clientCode;
    }

    setConf(key, value) {
        key = key.toString();
        value = value.toString();
        this.minetestConf.set(key, value);
    }

    #renderMinetestConf() {
        let lines = [];
        for (const [k, v] of this.minetestConf.entries()) {
            lines.push(`${k} = ${v}\n`);
        }
        return lines.join('');
    }

    setLang(lang) {
        this.setConf("language", lang);
    }

    checkPack(name) {
       if (!this.addedPacks.has(name)) {
           return 0;
       }
       if (mtScheduler.isSet("installed:" + name)) {
           return 2;
       }
       return 1;
    }

    addPacks(packs) {
        for (const pack of packs) {
            this.addPack(pack);
        }
    }

    async addPack(name) {
        if (mtScheduler.isSet("launch_called")) {
            throw new Error("Cannot add packs after launch");
        }
        if (name == 'minetest_game' || name == 'devtest' || this.addedPacks.has(name))
            return;
        this.addedPacks.add(name);

        const fetchedCond = "fetched:" + name;
        const installedCond = "installed:" + name;

        let chunks = [];
        let received = 0;
        const installPack = () => {
            const data = _malloc(received);
            let offset = 0;
            for (const arr of chunks) {
                HEAPU8.set(arr, data + offset);
                offset += arr.byteLength;
            }
            emloop_install_pack(stringToNewUTF8(name), data, received);
            _free(data);
            mtScheduler.setCondition(installedCond);
            if (this.onprogress) {
                this.onprogress(`download:${name}`, 1.0);
                this.onprogress(`install:${name}`, 1.0);
            }
        };
        mtScheduler.addCondition(fetchedCond, null);
        mtScheduler.addCondition(installedCond, installPack, ["wasmReady", fetchedCond]);
        mtScheduler.addDep("main_called", installedCond);

        const packUrl = this.packsDir + '/' + name + '.pack';
        let resp;
        try {
            resp = await fetch(packUrl, this.packsDirIsCors ? { credentials: 'omit' } : {});
        } catch (err) {
            if (this.onerror) {
                this.onerror(`${err}`);
            } else {
                alert(`Error while loading ${packUrl}. Please refresh page`);
            }
            throw new Error(`${err}`);
        }
        var contentLength = resp.headers.get('Content-Length');
        if (contentLength) {
            contentLength = parseInt(contentLength);
            updateProgressBar(0, contentLength);
        }
        let reader = resp.body.getReader();
        while (true) {
            const {done, value} = await reader.read();
            if (done) {
                break;
            }
            chunks.push(value);
            received += value.byteLength;
            if (contentLength) {
                updateProgressBar(value.byteLength, 0);
                if (this.onprogress) {
                    this.onprogress(`download:${name}`, received / contentLength);
                }
            }
        }
        mtScheduler.setCondition(fetchedCond);
    }

    launch(args) {
        if (!this.isReady()) {
            throw new Error("launch called before onready");
        }
        if (!(args instanceof MinetestArgs)) {
            throw new Error("launch called without MinetestArgs");
        }
        if (mtScheduler.isSet("launch_called")) {
            throw new Error("launch called twice");
        }
        this.args = args;
        if (this.args.gameid) {
            this.addPack(this.args.gameid);
        }
        this.addPacks(this.args.packs);
        activateBody();
        fixGeometry();
        if (this.minetestConf.size > 0) {
            const contents = this.#renderMinetestConf();
            console.log("minetest.conf is: ", contents);
            const confBuf = stringToNewUTF8(contents);
            emloop_set_minetest_conf(confBuf);
            _free(confBuf);
        }
        emloop_init_sound();
        emsocket_init();
        const proxyBuf = stringToNewUTF8(this.proxyUrl);
        emsocket_set_proxy(proxyBuf);
        _free(proxyBuf);
        if (this.vpn) {
            const vpnBuf = stringToNewUTF8(this.vpn);
            emsocket_set_vpn(vpnBuf);
            _free(vpnBuf);
        }
        if (args.go) {
            irrlicht_force_pointerlock();
        }
        mtScheduler.setCondition("launch_called");
    }
}

// Exportar para o escopo global
window.MinetestArgs = MinetestArgs;

window.MinetestLauncher = MinetestLauncher;

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        try {
            new MinetestLauncher();
            if (window.onLauncherReady) {
                window.onLauncherReady();
            }
        } catch (err) {
            console.error('Erro ao inicializar launcher:', err);
        }
    });
} else {
    try {
        new MinetestLauncher();
        if (window.onLauncherReady) {
            window.onLauncherReady();
        }
    } catch (err) {
        console.error('Erro ao inicializar launcher:', err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    try {
        const launcher = new MinetestLauncher();

        const args = new MinetestArgs();
        args.gameid = "bettercraft";

        launcher.onready = () => {
            launcher.launch(args);
        };

    } catch (err) {
        console.error('Erro ao inicializar launcher:', err);
    }
});