// ===== TAURI API =====
let invoke, appWindow;
try {
    invoke = window.__TAURI__.core.invoke;
    appWindow = window.__TAURI__.window.getCurrentWindow();
} catch (e) {
    console.error('Tauri API not available:', e);
    invoke = async () => { throw 'Tauri API not available'; };
    appWindow = { close: () => {}, minimize: () => {}, toggleMaximize: () => {} };
}

// ===== SCREENS =====
const splash = document.getElementById('splash');
const selector = document.getElementById('selector');
const viewer = document.getElementById('viewer');
const progressFill = document.getElementById('progressFill');
const splashStatus = document.getElementById('splashStatus');
const engineGrid = document.getElementById('engineGrid');

// ===== ENGINES =====
const ENGINES = [
    {
        id: 'local',
        name: 'Local Engine',
        desc: 'Motor JavaScript integrado. Conversión en tiempo real sin dependencias externas. Soporta ASCII, Braille, Complejo y Simple.',
        tag: 'LOCAL',
        tagClass: 'tag-local',
        icon: '>_',
        available: true,
        type: 'local'
    },
    {
        id: 'tahmid',
        name: 'Image-to-Braille',
        desc: 'Braille Unicode de alta calidad con dithering. Proyecto web open source por tahmid-chowdhury.',
        tag: 'WEB',
        tagClass: 'tag-web',
        icon: '...',
        available: true,
        type: 'web',
        url: 'https://tahmid-chowdhury.github.io/Image-to-Braille/'
    },
    {
        id: 'artty',
        name: 'artty',
        desc: 'Braille con color ANSI 24-bit. CLI y librería Python.',
        tag: 'CLI',
        tagClass: 'tag-cli',
        icon: 'art',
        available: false,
        type: 'cli',
        tool: 'artty',
        installCmd: 'pip install artty'
    },
    {
        id: 'img2braille',
        name: 'img2braille',
        desc: 'Braille Unicode con HTML y color ANSI. Descarga desde GitHub.',
        tag: 'CLI',
        tagClass: 'tag-cli',
        icon: 'i2b',
        available: false,
        type: 'cli',
        tool: 'img2braille',
        installCmd: 'github'
    },
    {
        id: 'img2braille-local',
        name: 'img2braille (Local)',
        desc: 'Variante incluida con la app. Permite fijar ancho y alto, o conservar la proporcion.',
        tag: 'LOCAL',
        tagClass: 'tag-local',
        icon: 'i2b+',
        available: false,
        type: 'cli',
        tool: 'img2braille_local',
        installCmd: 'bundled'
    },
    {
        id: 'jp2b',
        name: 'jp2b',
        desc: 'JPEG to Braille. CLI rápido escrito en Go.',
        tag: 'CLI',
        tagClass: 'tag-cli',
        icon: 'jp2',
        available: false,
        type: 'cli',
        tool: 'jp2b',
        installCmd: 'go install github.com/theZMC/jp2b/cmd/jp2b@latest'
    }
];

let currentEngine = null;
let hasPip = false;
let hasGo = false;

const TOOL_CHECK_TIMEOUT = 10000;

async function checkTool(name) {
    try {
        return !!await Promise.race([
            invoke('check_tool', { name }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TOOL_CHECK_TIMEOUT))
        ]);
    } catch (_) {
        return false;
    }
}

// This is the one source of truth for engine availability. The splash screen
// waits for these real checks instead of playing a timed animation first.
async function refreshEngineAvailability(onProgress = () => {}) {
    onProgress(5, 'Verificando Python y Go...');
    [hasPip, hasGo] = await Promise.all([checkTool('pip'), checkTool('go')]);

    const cliEngines = ENGINES.filter(eng => eng.type === 'cli');
    for (let index = 0; index < cliEngines.length; index++) {
        const eng = cliEngines[index];
        onProgress(20 + Math.round((index / cliEngines.length) * 70), `Verificando ${eng.name}...`);
        eng.available = await checkTool(eng.tool);
        if (eng.id === 'img2braille-local' && eng.available) {
            onProgress(20 + Math.round(((index + 0.5) / cliEngines.length) * 70), `Actualizando ${eng.name}...`);
            try { await invoke('ensure_img2braille_local'); } catch (_) {}
        }
    }
    onProgress(100, 'Listo');
}

// ===== SPLASH SCREEN =====
async function runSplash() {
    await refreshEngineAvailability((pct, text) => {
        progressFill.style.width = pct + '%';
        splashStatus.textContent = text;
    });

    progressFill.style.width = '100%';
    splashStatus.textContent = 'Buscando actualizaciones...';
    try {
        const { check } = window.__TAURI__.updater;
        const update = await check();
        if (update) {
            splashStatus.textContent = 'Actualizando a v' + update.version + '...';
            await update.downloadAndInstall();
            const { relaunch } = window.__TAURI__.process;
            await relaunch();
            return;
        }
    } catch (e) {
        console.log('Update check failed:', e);
    }

    showScreen('selector');
    buildSelector();
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function showScreen(name) {
    splash.classList.remove('active');
    selector.classList.remove('active');
    viewer.classList.remove('active');
    if (name === 'splash') splash.classList.add('active');
    if (name === 'selector') selector.classList.add('active');
    if (name === 'viewer') viewer.classList.add('active');
}

// ===== ENGINE SELECTOR =====
function buildSelector() {
    engineGrid.innerHTML = '';

    for (const eng of ENGINES) {
        const needsPip = eng.type === 'cli' && eng.tool !== 'jp2b';
        const needsGo = eng.type === 'cli' && eng.tool === 'jp2b';
        const runtimeMissing = (needsPip && !hasPip) || (needsGo && !hasGo);
        const runtimeName = needsPip ? 'Python' : needsGo ? 'Go' : '';
        const runtimeCmd = needsPip ? 'install_python' : needsGo ? 'install_go' : '';

        const card = document.createElement('div');
        card.className = 'engine-card';
        card.innerHTML = `
            <div class="engine-icon">${eng.icon}</div>
            <div class="engine-name">${eng.name}</div>
            <div class="engine-desc">${eng.desc}</div>
            <span class="engine-tag ${eng.available ? eng.tagClass : 'tag-missing'}">${eng.available ? eng.tag : 'NO INSTALADO'}</span>
            <div class="engine-actions">
                ${eng.type === 'cli' && runtimeMissing ? `<button class="engine-btn engine-btn-runtime" data-cmd="${runtimeCmd}" data-runtime="${runtimeName}">Instalar ${runtimeName}</button>` : ''}
                ${eng.type === 'cli' && !eng.available && !runtimeMissing ? `<button class="engine-btn engine-btn-install" data-engine="${eng.id}">Instalar</button>` : ''}
                ${eng.type === 'cli' && eng.available ? `<button class="engine-btn engine-btn-uninstall" data-engine="${eng.id}">Desinstalar</button>` : ''}
            </div>
            <div class="engine-status" id="status-${eng.id}">${runtimeMissing ? 'Necesita ' + runtimeName + ' para usar este motor' : ''}</div>
        `;

        if (eng.type === 'local' || eng.type === 'web') {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.engine-btn')) selectEngine(eng);
            });
        } else if (eng.available) {
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.engine-btn')) selectEngine(eng);
            });
        }

        engineGrid.appendChild(card);
    }

    // Runtime install buttons (download + extract silently)
    engineGrid.querySelectorAll('.engine-btn-runtime').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const cmd = btn.dataset.cmd;
            const runtimeName = btn.dataset.runtime;
            const statusEl = btn.closest('.engine-card').querySelector('.engine-status');
            btn.disabled = true;
            btn.textContent = 'Descargando ' + runtimeName + '...';
            if (statusEl) statusEl.textContent = 'Descargando e instalando ' + runtimeName + ', puede tardar un momento...';

            try {
                const result = await invoke(cmd);
                if (statusEl) statusEl.textContent = result;
                await refreshEngineAvailability();
                buildSelector();
            } catch (err) {
                if (statusEl) statusEl.textContent = 'Error: ' + err;
                btn.disabled = false;
                btn.textContent = 'Instalar ' + runtimeName;
            }
        });
    });

    // Install buttons
    engineGrid.querySelectorAll('.engine-btn-install').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const engId = btn.dataset.engine;
            const eng = ENGINES.find(x => x.id === engId);
            const status = document.getElementById('status-' + engId);
            btn.disabled = true;
            btn.textContent = 'Instalando...';
            status.textContent = 'Descargando ' + eng.tool + '...';

            try {
                const command = eng.tool === 'img2braille'
                    ? 'install_img2braille'
                    : eng.tool === 'img2braille_local'
                        ? 'install_img2braille_local'
                    : eng.tool === 'jp2b'
                        ? 'install_jp2b'
                        : 'install_tool';
                const result = command === 'install_tool'
                    ? await invoke(command, { name: eng.tool })
                    : await invoke(command);
                status.textContent = result;
                await refreshEngineAvailability();
                buildSelector();
            } catch (err) {
                status.textContent = 'Error: ' + err;
                btn.disabled = false;
                btn.textContent = 'Instalar';
            }
        });
    });

    // Uninstall buttons
    engineGrid.querySelectorAll('.engine-btn-uninstall').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const engId = btn.dataset.engine;
            const eng = ENGINES.find(x => x.id === engId);
            const status = document.getElementById('status-' + engId);
            btn.disabled = true;
            btn.textContent = 'Desinstalando...';

            try {
                const command = eng.tool === 'img2braille'
                    ? 'uninstall_img2braille'
                    : eng.tool === 'img2braille_local'
                        ? 'uninstall_img2braille_local'
                    : eng.tool === 'jp2b'
                        ? 'uninstall_jp2b'
                        : 'uninstall_tool';
                const result = command === 'uninstall_tool'
                    ? await invoke(command, { name: eng.tool })
                    : await invoke(command);
                status.textContent = result;
                await refreshEngineAvailability();
                buildSelector();
            } catch (err) {
                status.textContent = 'Error: ' + err;
                btn.disabled = false;
                btn.textContent = 'Desinstalar';
            }
        });
    });
}

function selectEngine(eng) {
    currentEngine = eng;
    document.getElementById('engineName').textContent = eng.name;

    const isLocal = eng.type === 'local';
    const isArtty = eng.id === 'artty';
    const isI2b = eng.id === 'img2braille' || eng.id === 'img2braille-local';
    const isI2bLocal = eng.id === 'img2braille-local';
    const isCliVisual = isArtty || isI2b;

    document.getElementById('localControls').style.display = isLocal ? 'flex' : 'none';
    document.getElementById('localControls2').style.display = isLocal ? 'flex' : 'none';
    document.getElementById('arttyControls').style.display = isArtty ? 'flex' : 'none';
    document.getElementById('img2brailleControls').style.display = isI2b ? 'flex' : 'none';
    document.getElementById('i2bHeightControl').style.display = isI2bLocal ? 'inline' : 'none';
    document.getElementById('preview').style.display = (isLocal || isCliVisual) ? 'flex' : 'none';
    document.getElementById('externalView').style.display = (isLocal || isCliVisual) ? 'none' : 'flex';
    document.getElementById('cliPlaceholder').style.display = (eng.type === 'cli' && !isCliVisual) ? 'flex' : 'none';
    document.getElementById('externalFrame').style.display = eng.type === 'web' ? 'block' : 'none';

    if (eng.type === 'web') {
        document.getElementById('externalFrame').src = eng.url;
    }

    if (isLocal || isCliVisual) {
        document.getElementById('externalFrame').src = '';
        resetLocalViewer();
    }

    if (eng.type === 'cli' && !isCliVisual) {
        document.getElementById('cliPreview').style.display = 'none';
        document.getElementById('cliPlaceholder').style.display = 'flex';
        document.getElementById('cliAscii').textContent = '';
    }

    showScreen('viewer');
}

function resetLocalViewer() {
    currentLocalImage = null;
    currentArttyFile = null;
    currentImg2brailleFile = null;
    img2brailleGeneration++;
    ascii.textContent = '';
    ascii.style.color = '#CE3669';
    dropZone.classList.remove('hidden');
    fileInput.value = '';
    info.textContent = '';
}

// ===== LOCAL ENGINE =====
const fileInput = document.getElementById('fileInput');
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const ascii = document.getElementById('ascii');
const dropZone = document.getElementById('dropZone');
const preview = document.getElementById('preview');
const info = document.getElementById('info');

const el = {
    width: document.getElementById('width'),
    height: document.getElementById('height'),
    mode: document.getElementById('mode'),
    customMap: document.getElementById('customMap'),
    threshold: document.getElementById('threshold'),
    thresholdVal: document.getElementById('thresholdVal'),
    grayscale: document.getElementById('grayscale'),
    negative: document.getElementById('negative'),
    flipX: document.getElementById('flipX'),
    flipY: document.getElementById('flipY'),
    color: document.getElementById('color'),
    bg: document.getElementById('bg'),
    fontSize: document.getElementById('fontSize'),
    fontSizeVal: document.getElementById('fontSizeVal')
};

let currentLocalImage = null;

const CHARSETS = {
    ascii: ' .:-=+*#%@',
    simple: ' .-+*#@',
    complex: ' .\'`^",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$',
    braille: null
};

const BRAILLE_MAP = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];

function renderBraille(data, w, h) {
    const threshold = parseInt(el.threshold.value);
    const cols = Math.floor(w / 2);
    const rows = Math.floor(h / 4);
    let result = '';
    for (let row = 0; row < rows; row++) {
        let line = '';
        for (let col = 0; col < cols; col++) {
            let dots = 0;
            for (let dy = 0; dy < 4; dy++) {
                for (let dx = 0; dx < 2; dx++) {
                    const px = col * 2 + dx;
                    const py = row * 4 + dy;
                    const idx = (py * w + px) * 4;
                    let r = data[idx], g = data[idx + 1], b = data[idx + 2];
                    if (el.grayscale.checked) { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray; }
                    if (el.negative.checked) { r = 255 - r; g = 255 - g; b = 255 - b; }
                    if (r * 0.299 + g * 0.587 + b * 0.114 < threshold) dots |= BRAILLE_MAP[dy][dx];
                }
            }
            line += String.fromCharCode(0x2800 + dots);
        }
        result += line + '\n';
    }
    return result;
}

function renderLocal(data, w, h) {
    const mode = el.mode.value;
    const cols = parseInt(el.width.value);
    const manualH = parseInt(el.height.value);
    const charW = w / cols;
    const charH = manualH > 0 ? h / manualH : charW * 0.5;
    const rows = manualH > 0 ? manualH : Math.floor(h / charH);

    if (mode === 'braille') {
        ascii.textContent = renderBraille(data, w, h);
    } else {
        let charset = el.customMap.value.trim() || CHARSETS[mode];
        let result = '';
        for (let row = 0; row < rows; row++) {
            let line = '';
            for (let col = 0; col < cols; col++) {
                let px = Math.floor(col * charW);
                let py = Math.floor(row * charH);
                if (el.flipX.checked) px = w - 1 - px;
                if (el.flipY.checked) py = h - 1 - py;
                px = Math.max(0, Math.min(px, w - 1));
                py = Math.max(0, Math.min(py, h - 1));
                const idx = (py * w + px) * 4;
                let r = data[idx], g = data[idx + 1], b = data[idx + 2];
                if (el.grayscale.checked) { const gray = r * 0.299 + g * 0.587 + b * 0.114; r = g = b = gray; }
                if (el.negative.checked) { r = 255 - r; g = 255 - g; b = 255 - b; }
                const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
                const charIdx = Math.floor((1 - brightness) * (charset.length - 1));
                line += charset[Math.min(charIdx, charset.length - 1)];
            }
            result += line + '\n';
        }
        ascii.textContent = result;
    }
    info.textContent = cols + 'x' + rows + ' | ' + mode;
}

let currentArttyFile = null;
let currentImg2brailleFile = null;
let img2brailleGeneration = 0;

function loadImageLocal(file) {
    if (currentEngine && currentEngine.id === 'artty') {
        currentArttyFile = file;
        dropZone.classList.add('hidden');
        generateArtty();
        return;
    }
    if (currentEngine && (currentEngine.id === 'img2braille' || currentEngine.id === 'img2braille-local')) {
        currentImg2brailleFile = file;
        dropZone.classList.add('hidden');
        generateImg2braille();
        return;
    }
    if (currentEngine && currentEngine.type === 'cli') {
        loadImageCli(file);
        return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            currentLocalImage = img;
            dropZone.classList.add('hidden');
            generateLocal();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

async function loadImageCli(file) {
    if (!currentEngine) return;
    const cliPreview = document.getElementById('cliPreview');
    const cliAscii = document.getElementById('cliAscii');
    const cliPlaceholder = document.getElementById('cliPlaceholder');

    cliPlaceholder.style.display = 'none';
    cliPreview.style.display = 'flex';
    cliAscii.textContent = 'Convirtiendo con ' + currentEngine.name + '...';
    cliAscii.style.color = '#863548';

    try {
        const arrayBuf = await file.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        const tempPath = await invoke('save_temp_image', {
            name: file.name,
            data: Array.from(uint8)
        });

        let result;
        if (currentEngine.id === 'img2braille') {
            result = await invoke('convert_img2braille', { imagePath: tempPath, width: 200 });
        } else if (currentEngine.id === 'img2braille-local') {
            result = await invoke('convert_img2braille_local', { imagePath: tempPath, width: 200, height: 0 });
        } else if (currentEngine.id === 'jp2b') {
            result = await invoke('convert_jp2b', { imagePath: tempPath });
        } else {
            result = 'Motor no soportado aún';
        }

        cliAscii.textContent = result;
        cliAscii.style.color = '#CE3669';
    } catch (err) {
        cliAscii.textContent = 'Error: ' + err;
        cliAscii.style.color = '#CE3669';
    }
}

async function generateArtty() {
    if (!currentArttyFile) return;
    const width = parseInt(document.getElementById('arttyWidth').value);
    const threshold = parseInt(document.getElementById('arttyThreshold').value);
    const color = document.getElementById('arttyColor').checked;
    const boost = parseInt(document.getElementById('arttyBoost').value) / 10;

    ascii.textContent = 'Convirtiendo con artty...';
    ascii.style.color = '#863548';
    info.textContent = 'artty: ' + width + ' chars, threshold ' + threshold;

    try {
        // Save file to temp (Tauri doesn't have file.path like Electron)
        const arrayBuf = await currentArttyFile.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        const tempPath = await invoke('save_temp_image', {
            name: currentArttyFile.name,
            data: Array.from(uint8)
        });

        const result = await invoke('convert_artty', {
            imagePath: tempPath,
            width: width,
            threshold: threshold,
            color: color,
            boost: boost
        });
        ascii.textContent = result;
        ascii.style.color = color ? '#fff' : '#CE3669';
    } catch (err) {
        ascii.textContent = 'Error: ' + err;
        ascii.style.color = '#CE3669';
    }
}

async function generateImg2braille() {
    if (!currentImg2brailleFile) return;

    const width = parseInt(document.getElementById('i2bWidth').value, 10);
    const height = parseInt(document.getElementById('i2bHeight').value, 10) || 0;
    const dither = document.getElementById('i2bDither').checked;
    const invert = document.getElementById('i2bInvert').checked;
    const autocontrast = document.getElementById('i2bAutocontrast').checked;
    const calc = document.getElementById('i2bCalc').value;
    const noempty = document.getElementById('i2bNoempty').checked;
    const mobile = document.getElementById('i2bMobile').checked;
    const generation = ++img2brailleGeneration;

    ascii.textContent = 'Convirtiendo con img2braille...';
    ascii.style.color = '#863548';
    info.textContent = currentEngine.name + ': ' + width + 'x' + (height || 'auto') + ' | ' + calc;

    try {
        const arrayBuf = await currentImg2brailleFile.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuf);
        const tempPath = await invoke('save_temp_image', {
            name: currentImg2brailleFile.name,
            data: Array.from(uint8)
        });
        const command = currentEngine.id === 'img2braille-local'
            ? 'convert_img2braille_local'
            : 'convert_img2braille';
        const result = await invoke(command, {
            imagePath: tempPath,
            width,
            ...(currentEngine.id === 'img2braille-local' ? { height, mobile } : {}),
            dither,
            invert,
            autocontrast,
            calc,
            noempty
        });

        if (generation !== img2brailleGeneration) return;
        ascii.textContent = result;
        ascii.style.color = '#CE3669';
    } catch (err) {
        if (generation !== img2brailleGeneration) return;
        ascii.textContent = 'Error: ' + err;
        ascii.style.color = '#CE3669';
    }
}

function generateLocal() {
    if (!currentLocalImage) return;
    const cols = parseInt(el.width.value);
    const scale = currentLocalImage.height / currentLocalImage.width;
    canvas.width = cols * 4;
    canvas.height = Math.floor(cols * scale * 0.5 * 4);
    ctx.drawImage(currentLocalImage, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    renderLocal(data, canvas.width, canvas.height);
}

// ===== DRAG & DROP =====
function setupDragDrop() {
    const targets = [document.body, dropZone, preview];
    targets.forEach(t => {
        t.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.add('dragging'); });
        t.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); dropZone.classList.remove('dragging'); });
        t.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            dropZone.classList.remove('dragging');
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) loadImageLocal(file);
        });
    });

    const cliPlaceholder = document.getElementById('cliPlaceholder');
    const cliPreview = document.getElementById('cliPreview');
    const cliTargets = [cliPlaceholder, cliPreview];
    cliTargets.forEach(t => {
        t.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); t.style.background = 'rgba(206, 54, 105, 0.1)'; });
        t.addEventListener('dragleave', (e) => { e.preventDefault(); e.stopPropagation(); t.style.background = ''; });
        t.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            t.style.background = '';
            const file = e.dataTransfer.files[0];
            if (file && file.type.startsWith('image/')) loadImageCli(file);
        });
    });
}

// ===== WINDOW CONTROLS =====
function setupWindowControls() {
    document.getElementById('closeBtn').addEventListener('click', () => appWindow.close());
    document.getElementById('closeBtn2').addEventListener('click', () => appWindow.close());
    document.getElementById('minBtn').addEventListener('click', () => appWindow.minimize());
    document.getElementById('minBtn2').addEventListener('click', () => appWindow.minimize());
    document.getElementById('maxBtn').addEventListener('click', () => appWindow.toggleMaximize());
    document.getElementById('maxBtn2').addEventListener('click', () => appWindow.toggleMaximize());

    // Drag: mousedown on title bar (skip buttons)
    ['selectorTitleBar', 'viewerTitleBar'].forEach(id => {
        const bar = document.getElementById(id);
        if (!bar) return;
        bar.addEventListener('mousedown', (e) => {
            if (e.target.closest('.win-btn') || e.target.closest('.back-btn')) return;
            appWindow.startDragging();
        });
    });

    // Maximize icon toggle
    async function updateMaxIcon() {
        try {
            const maximized = await appWindow.isMaximized();
            const svgRestore = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
            const svgMax = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
            document.getElementById('maxBtn').innerHTML = maximized ? svgRestore : svgMax;
            document.getElementById('maxBtn2').innerHTML = maximized ? svgRestore : svgMax;
        } catch (e) {}
    }
    updateMaxIcon();
    document.getElementById('maxBtn').addEventListener('click', () => setTimeout(updateMaxIcon, 200));
    document.getElementById('maxBtn2').addEventListener('click', () => setTimeout(updateMaxIcon, 200));
    window.addEventListener('resize', updateMaxIcon);
}

// ===== EVENTS =====
function setupEvents() {
    setupDragDrop();
    setupWindowControls();

    dropZone.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImageLocal(e.target.files[0]); });

    const cliPlaceholder = document.getElementById('cliPlaceholder');
    const cliFileInput = document.getElementById('cliFileInput');
    cliPlaceholder.addEventListener('click', () => cliFileInput.click());
    cliFileInput.addEventListener('change', (e) => { if (e.target.files[0]) loadImageCli(e.target.files[0]); });

    el.width.addEventListener('input', generateLocal);
    el.height.addEventListener('input', generateLocal);
    el.mode.addEventListener('change', generateLocal);
    el.customMap.addEventListener('input', generateLocal);
    el.threshold.addEventListener('input', () => { el.thresholdVal.textContent = el.threshold.value; generateLocal(); });
    el.grayscale.addEventListener('change', generateLocal);
    el.negative.addEventListener('change', generateLocal);
    el.flipX.addEventListener('change', generateLocal);
    el.flipY.addEventListener('change', generateLocal);
    el.color.addEventListener('input', () => { ascii.style.color = el.color.value; });
    el.bg.addEventListener('change', () => { ascii.style.background = el.bg.value === 'transparent' ? 'none' : el.bg.value; });
    el.fontSize.addEventListener('input', () => { el.fontSizeVal.textContent = el.fontSize.value; ascii.style.fontSize = el.fontSize.value + 'px'; });

    document.getElementById('btnCopy').addEventListener('click', () => navigator.clipboard.writeText(ascii.textContent));
    document.getElementById('btnDownload').addEventListener('click', () => {
        const blob = new Blob([ascii.textContent], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ascii-art.txt';
        a.click();
    });
    document.getElementById('btnNew').addEventListener('click', () => {
        resetLocalViewer();
        const cliPreview = document.getElementById('cliPreview');
        const cliPlaceholder = document.getElementById('cliPlaceholder');
        if (cliPreview) cliPreview.style.display = 'none';
        if (cliPlaceholder && currentEngine && currentEngine.type === 'cli') {
            cliPlaceholder.style.display = 'flex';
        }
        const cliAscii = document.getElementById('cliAscii');
        if (cliAscii) cliAscii.textContent = '';
    });
    document.getElementById('backBtn').addEventListener('click', () => showScreen('selector'));

    // Artty controls
    document.getElementById('arttyWidth').addEventListener('input', () => { if (currentArttyFile) generateArtty(); });
    document.getElementById('arttyThreshold').addEventListener('input', () => { document.getElementById('arttyThresholdVal').textContent = document.getElementById('arttyThreshold').value; if (currentArttyFile) generateArtty(); });
    document.getElementById('arttyBoost').addEventListener('input', () => { document.getElementById('arttyBoostVal').textContent = (parseInt(document.getElementById('arttyBoost').value) / 10).toFixed(1); if (currentArttyFile) generateArtty(); });
    document.getElementById('arttyColor').addEventListener('change', () => { if (currentArttyFile) generateArtty(); });

    // img2braille controls
    document.getElementById('i2bWidth').addEventListener('input', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bHeight').addEventListener('input', () => { if (currentImg2brailleFile && currentEngine.id === 'img2braille-local') generateImg2braille(); });
    document.getElementById('i2bDither').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bInvert').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bAutocontrast').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bCalc').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bNoempty').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
    document.getElementById('i2bMobile').addEventListener('change', () => { if (currentImg2brailleFile) generateImg2braille(); });
}

// ===== INIT =====
setupEvents();
runSplash();
