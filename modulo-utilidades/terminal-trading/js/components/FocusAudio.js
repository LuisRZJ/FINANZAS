(() => {
    const STYLE_ID = 'fti-focus-audio-style';
    const ROOT_ID = 'fti-focus-audio-root';
    const DEFAULT_VOLUME = 0.2;
    const DEFAULT_TYPE = 'pink';
    const NOISE_OPTIONS = [
        { value: 'white', label: 'Blanco' },
        { value: 'pink', label: 'Rosa' },
        { value: 'brown', label: 'Marrón' }
    ];

    let audioCtx = null;
    let gainNode = null;
    let sourceNode = null;
    let isOn = false;
    let noiseType = DEFAULT_TYPE;
    let volume = DEFAULT_VOLUME;

    const ensureAudio = () => {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Ctx();
        }
        if (!gainNode) {
            gainNode = audioCtx.createGain();
            gainNode.gain.value = volume;
            gainNode.connect(audioCtx.destination);
        }
    };

    const buildWhite = (data) => {
        for (let i = 0; i < data.length; i += 1) {
            data[i] = (Math.random() * 2 - 1) * 0.9;
        }
    };

    const buildPink = (data) => {
        const rows = new Array(16);
        let runningSum = 0;
        for (let i = 0; i < rows.length; i += 1) {
            rows[i] = Math.random() * 2 - 1;
            runningSum += rows[i];
        }
        let key = 0;
        const maxKey = (1 << rows.length) - 1;
        for (let i = 0; i < data.length; i += 1) {
            const lastKey = key;
            key = (key + 1) & maxKey;
            let diff = lastKey ^ key;
            let idx = 0;
            while (diff) {
                if (diff & 1) {
                    runningSum -= rows[idx];
                    rows[idx] = Math.random() * 2 - 1;
                    runningSum += rows[idx];
                }
                diff >>= 1;
                idx += 1;
            }
            data[i] = (runningSum / rows.length) + (Math.random() * 2 - 1) * 0.02;
            data[i] *= 0.9;
        }
    };

    const buildBrown = (data) => {
        let lastOut = 0;
        for (let i = 0; i < data.length; i += 1) {
            const white = Math.random() * 2 - 1;
            lastOut = (lastOut + (0.02 * white)) / 1.02;
            data[i] = lastOut * 3.5;
        }
    };

    const createNoiseBuffer = (type) => {
        ensureAudio();
        const length = audioCtx.sampleRate * 2;
        const buffer = audioCtx.createBuffer(1, length, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        if (type === 'white') buildWhite(data);
        if (type === 'pink') buildPink(data);
        if (type === 'brown') buildBrown(data);
        return buffer;
    };

    const stopSource = () => {
        if (!sourceNode) return;
        try { sourceNode.stop(); } catch (e) { }
        try { sourceNode.disconnect(); } catch (e) { }
        sourceNode = null;
        isOn = false;
    };

    const startSource = () => {
        ensureAudio();
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
        if (sourceNode) stopSource();
        sourceNode = audioCtx.createBufferSource();
        sourceNode.buffer = createNoiseBuffer(noiseType);
        sourceNode.loop = true;
        sourceNode.connect(gainNode);
        sourceNode.start();
        isOn = true;
    };

    const injectStyles = () => {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            #${ROOT_ID} {
                position: fixed;
                right: 18px;
                bottom: 18px;
                z-index: 9999;
                font-family: 'Inter', system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
                color: #cbd5e1;
            }
            #${ROOT_ID} .fti-focus-audio__toggle {
                width: 44px;
                height: 44px;
                border-radius: 12px;
                background: rgba(15, 23, 42, 0.92);
                border: 1px solid rgba(51, 65, 85, 0.8);
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
                color: #6ee7b7;
                transition: transform 0.15s ease, border-color 0.15s ease;
            }
            #${ROOT_ID} .fti-focus-audio__toggle:hover {
                transform: translateY(-1px);
                border-color: rgba(56, 189, 248, 0.9);
            }
            #${ROOT_ID} .fti-focus-audio__panel {
                position: absolute;
                right: 0;
                bottom: 52px;
                width: 220px;
                padding: 14px;
                background: rgba(2, 6, 23, 0.68);
                border: 1px solid rgba(51, 65, 85, 0.9);
                border-radius: 14px;
                box-shadow: 0 16px 30px rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(10px);
                -webkit-backdrop-filter: blur(10px);
                opacity: 0;
                transform: translateY(8px);
                pointer-events: none;
                transition: opacity 0.18s ease, transform 0.18s ease;
            }
            #${ROOT_ID} .fti-focus-audio__panel--open {
                opacity: 1;
                transform: translateY(0);
                pointer-events: auto;
            }
            #${ROOT_ID} .fti-focus-audio__title {
                font-size: 12px;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                color: #94a3b8;
                margin-bottom: 10px;
            }
            #${ROOT_ID} .fti-focus-audio__control {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 10px;
            }
            #${ROOT_ID} label {
                font-size: 12px;
                color: #a5b4fc;
            }
            #${ROOT_ID} select,
            #${ROOT_ID} input[type="range"] {
                width: 100%;
                background: #0f172a;
                color: #e2e8f0;
                border: 1px solid rgba(51, 65, 85, 0.8);
                border-radius: 8px;
                padding: 6px 8px;
                font-size: 12px;
                outline: none;
            }
            #${ROOT_ID} input[type="range"] {
                padding: 0;
                height: 24px;
            }
            #${ROOT_ID} .fti-focus-audio__power {
                width: 100%;
                padding: 8px 10px;
                border-radius: 10px;
                border: 1px solid rgba(16, 185, 129, 0.7);
                background: rgba(16, 185, 129, 0.15);
                color: #6ee7b7;
                font-size: 12px;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                cursor: pointer;
                transition: background 0.15s ease, border-color 0.15s ease;
            }
            #${ROOT_ID} .fti-focus-audio__power--off {
                border-color: rgba(148, 163, 184, 0.6);
                background: rgba(30, 41, 59, 0.8);
                color: #94a3b8;
            }
            #${ROOT_ID} .fti-focus-audio__icon svg {
                width: 22px;
                height: 22px;
            }
        `;
        document.head.appendChild(style);
    };

    const createMarkup = () => {
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.innerHTML = `
            <button class="fti-focus-audio__toggle" aria-label="Aislamiento acústico">
                <span class="fti-focus-audio__icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 18v-5a9 9 0 0 1 18 0v5" />
                        <rect x="2" y="18" width="4" height="4" rx="1" />
                        <rect x="18" y="18" width="4" height="4" rx="1" />
                        <path d="M7 18v-4a5 5 0 0 1 10 0v4" />
                    </svg>
                </span>
            </button>
            <div class="fti-focus-audio__panel">
                <div class="fti-focus-audio__title">Aislamiento</div>
                <div class="fti-focus-audio__control">
                    <label>Ruido</label>
                    <select class="fti-focus-audio__type"></select>
                </div>
                <div class="fti-focus-audio__control">
                    <label>Volumen</label>
                    <input class="fti-focus-audio__volume" type="range" min="0" max="1" step="0.01" value="${volume}">
                </div>
                <button class="fti-focus-audio__power fti-focus-audio__power--off">Apagado</button>
            </div>
        `;
        return root;
    };

    const bindUI = (root) => {
        const toggleButton = root.querySelector('.fti-focus-audio__toggle');
        const panel = root.querySelector('.fti-focus-audio__panel');
        const typeSelect = root.querySelector('.fti-focus-audio__type');
        const volumeInput = root.querySelector('.fti-focus-audio__volume');
        const powerButton = root.querySelector('.fti-focus-audio__power');

        NOISE_OPTIONS.forEach((option) => {
            const opt = document.createElement('option');
            opt.value = option.value;
            opt.textContent = option.label;
            if (option.value === noiseType) opt.selected = true;
            typeSelect.appendChild(opt);
        });

        const refreshPowerUI = () => {
            if (isOn) {
                powerButton.textContent = 'Encendido';
                powerButton.classList.remove('fti-focus-audio__power--off');
            } else {
                powerButton.textContent = 'Apagado';
                powerButton.classList.add('fti-focus-audio__power--off');
            }
        };

        toggleButton.addEventListener('click', () => {
            panel.classList.toggle('fti-focus-audio__panel--open');
        });

        typeSelect.addEventListener('change', (e) => {
            noiseType = e.target.value;
            if (isOn) startSource();
        });

        volumeInput.addEventListener('input', (e) => {
            volume = parseFloat(e.target.value);
            if (gainNode) {
                gainNode.gain.setTargetAtTime(volume, audioCtx.currentTime, 0.02);
            }
        });

        powerButton.addEventListener('click', () => {
            if (!audioCtx) ensureAudio();
            if (isOn) stopSource();
            else startSource();
            refreshPowerUI();
        });

        refreshPowerUI();
    };

    const init = () => {
        if (document.getElementById(ROOT_ID)) return;
        injectStyles();
        const root = createMarkup();
        document.body.appendChild(root);
        bindUI(root);
    };

    window.FTI_FocusAudio = { init };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
