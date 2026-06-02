import { WorkletSynthesizer } from "https://unpkg.com/spessasynth_lib@4.3.0/dist/index.js";

let octaveShift = 0,
    transposeShift = 0,
    reservoir = 100,
    isStarted = false,
    isManual = false,
    isDroneMode = false,
    isCoupler = false,
    isSubOct = false,
    isSustain = false,
    LabelsHidden = false,
    baseVol = 0.8,
    pumpCharge = 0;
    
let synth, audioCtx, volumeNode, analyser;

const activeNotes = new Map(),
      heldKeys = new Set(),
      sustainQueue = new Set();

const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

const indianScale = ["Sa","re","Re","ga","Ga","Ma","ma","Pa","dha","Dha","ni","Ni"];

const keyMap = {
    'a':12, 'w':13, 's':14, 'e':15, 'd':16, 'f':17, 't':18, 
    'g':19, 'y':20, 'h':21, 'u':22, 'j':23, 'k':24, 'o':25, 
    'l':26, 'p':27, ';':28, "'":29
};

const ragas = {
    "none": [],
    "bilawal": [0,2,4,5,7,9,11],
    "kalyan": [0,2,4,6,7,9,11],
    "khamaj": [0,2,4,5,7,9,10],
    "bhairav": [0,1,4,5,7,8,11],
    "bhairavi": [0,1,3,5,7,8,10],
    "kafi": [0,2,3,5,7,9,10],
    "asavari": [0,2,3,5,7,8,10],
    "purvi": [0,1,4,6,7,8,11],
    "marwa": [0,1,4,6,7,9,11],
    "todi": [0,1,3,6,7,8,11],
    "desh": [0,2,4,5,7,9,10,11],
    "shree": [0,1,4,6,7,8,11],
    "bhopali": [0,2,4,7,9],
    "malkauns": [0,3,5,8,10]
};
let currentRagaIdx = 0;

let isStrictRaga = false;

const ragaKeys = Object.keys(ragas);

const canvas = document.getElementById('visualizer-canvas'), ctx = canvas.getContext('2d');

function initKeyboard() {
    const kb = document.getElementById('keyboard');
    const kbWrapper = document.querySelector('.keyboard-wrapper');
    if (!kb || !kbWrapper) return;

    kb.innerHTML = '';

    let isDragging = false;
    let startX, scrollLeft, mouseStartX, mouseStartY;

    for (let i = 0; i < 48; i++) {
        const k = document.createElement('div');
        const noteName = scale[i % 12];
        const displayOctave = Math.floor(i / 12) + 2; 
        
        k.className = `key ${noteName.includes('#') ? 'black' : 'white'}`;
        k.dataset.idx = i;
        k.innerHTML = `<span class="note-txt">${noteName}${displayOctave}</span>`;
        kb.appendChild(k);

        k.onmousedown = e => {
            if (e.button === 0) {
                k.classList.add('active');
                const rect = k.getBoundingClientRect();
                const velocity = ((e.clientY - rect.top) / rect.height) * 0.7 + 0.3;
                handleKeyPress(i, velocity);
            } else if (e.button === 2) {
                isDragging = true;
                kbWrapper.classList.add('grabbing');
                startX = e.pageX - kbWrapper.offsetLeft;
                scrollLeft = kbWrapper.scrollLeft;
                mouseStartX = e.clientX;
                mouseStartY = e.clientY;
            }
        };

        k.onmouseup = e => {
            if (e.button === 0) {
                k.classList.remove('active');
                handleKeyRelease(i);
            }
        };

        k.onmouseleave = () => {
            if (k.classList.contains('active')) {
                k.classList.remove('active');
                handleKeyRelease(i);
            }
        };
    }

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const x = e.pageX - kbWrapper.offsetLeft;
        const walk = (x - startX) * 1.2; 
        kbWrapper.scrollLeft = scrollLeft - walk;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 2) {
            isDragging = false;
            kbWrapper.classList.remove('grabbing');
        }
    });

    kbWrapper.addEventListener('scroll', () => {
        const maxScroll = kbWrapper.scrollWidth - kbWrapper.clientWidth;
        if (maxScroll <= 0) return;

        const scrollRatio = kbWrapper.scrollLeft / maxScroll;
        let targetOctave = 0;

        if (scrollRatio < 0.33) {
            targetOctave = -1;
        } else if (scrollRatio > 0.66) {
            targetOctave = 1;
        }

        document.querySelectorAll('.oct-led').forEach(l => l.classList.remove('active'));
        
        let targetId = "oct-mid";
        if (targetOctave === -1) targetId = "oct-low";
        if (targetOctave === 1) targetId = "oct-high";

        const led = document.getElementById(targetId);
        if (led) led.classList.add('active');
    });

    setTimeout(() => {
        const targetKey = kb.querySelector('[data-idx="5"]');
        if (targetKey && kbWrapper) {
            kbWrapper.scrollLeft = targetKey.offsetLeft + 1;
        }
    }, 300);
}

function setupUIButtons() {
    const manualToggle = document.getElementById("manual-toggle");
    manualToggle?.addEventListener("change", e => {
        isManual = e.target.checked;
        reservoir = isManual ? 0 : 100;
        document.getElementById('meter-ui').style.display = isManual ? 'block' : 'none';
        
        if (synth) {
            if (!isManual) {
                synth.controllerChange(0, 11, 127);
            } else {
                synth.controllerChange(0, 11, 0);
            }
        }
    });

    const notationCheckbox = document.getElementById("notation-checkbox");
    const notationContainer = notationCheckbox?.closest('.switch-group') || notationCheckbox;
    
    notationContainer?.addEventListener("contextmenu", e => {
        e.preventDefault(); 
        LabelsHidden = !LabelsHidden;
        notationContainer.style.opacity = LabelsHidden ? "0.4" : "1";
        toggleNotation();
    });

    notationCheckbox?.addEventListener("change", toggleNotation);

    document.getElementById("sub-oct-toggle")?.addEventListener("change", e => {
        isSubOct = e.target.checked;
        refreshAudio();
    });

    document.getElementById("coupler-toggle")?.addEventListener("change", e => {
        isCoupler = e.target.checked;
        refreshAudio();
    });

    const holdBtn = document.getElementById("hold-btn");
    holdBtn?.addEventListener("click", () => {
        isDroneMode = !isDroneMode;
        holdBtn.classList.toggle("active");
        if (!isDroneMode) {
            activeNotes.forEach((_, i) => { if (!heldKeys.has(i)) stopAudio(i); });
        } else {
            heldKeys.forEach(i => { if (!activeNotes.has(i)) startAudio(i); });
        }
    });

    document.getElementById('vol')?.addEventListener("input", e => {
        baseVol = parseFloat(e.target.value);
        if (synth) {
            const midiVol = Math.floor(baseVol * 127);
            synth.controllerChange(0, 7, midiVol);
        }
    });
    
    document.getElementById('sus')?.addEventListener("input", e => {
        const val = parseFloat(e.target.value);
        const minSliderVal = parseFloat(e.target.min) || 0.05;
        const maxSliderVal = parseFloat(e.target.max) || 2;
        
        const norm = (val - minSliderVal) / (maxSliderVal - minSliderVal);
        const midiVal = Math.floor(norm * 127);
        
        if (synth) synth.controllerChange(0, 72, midiVal);
    });

    document.getElementById('rev')?.addEventListener("input", e => {
        const val = parseFloat(e.target.value);
        const midiVal = Math.floor(val * 127);
        if (synth) synth.controllerChange(0, 91, midiVal);
    });

    document.getElementById('chorus-slider')?.addEventListener("input", e => {
        const val = parseFloat(e.target.value);
        const maxSliderVal = parseFloat(e.target.max) || 0.2;
        const midiVal = Math.floor((val / maxSliderVal) * 127);
        if (synth) synth.controllerChange(0, 93, midiVal);
    });

    document.querySelector(".trans-left")?.addEventListener("click", () => setTranspose(-1));
    document.querySelector(".trans-right")?.addEventListener("click", () => setTranspose(1));

    document.querySelectorAll(".oct-unit").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => setOctave(parseInt(el.dataset.octave)));
    });

    document.querySelector(".stepper-left")?.addEventListener("click", () => cycleRaga(-1));
    document.querySelector(".stepper-right")?.addEventListener("click", () => cycleRaga(1));
}

async function setupMIDI() {
    if (!navigator.requestMIDIAccess) return console.warn("WebMIDI not supported");

    try {
        const midiAccess = await navigator.requestMIDIAccess();
        midiAccess.onstatechange = e => console.log(e.port.name, e.port.state);

        const select = document.getElementById('midi-select');
        const midiGroup = document.getElementById('midi-control-group');
        select.innerHTML = '<option value="">MIDI (OFF)</option>';

        const inputs = Array.from(midiAccess.inputs.values());
        inputs.forEach(input => {
            const opt = document.createElement('option');
            opt.value = input.id;
            opt.textContent = input.name;
            select.appendChild(opt);
        });

        select.onchange = () => {
            const portId = select.value;
            inputs.forEach(input => input.onmidimessage = null);
            if (!portId) {
                midiGroup.classList.remove('active');
                return;
            }
            midiGroup.classList.add('active');
            const input = inputs.find(i => i.id === portId);
            if (input) input.onmidimessage = handleMidiMessage;
        };
    } catch (e) {
        console.error("MIDI failed:", e);
    }
}

function handleMidiMessage(event) {
    const [status, note, velocity] = event.data;
    const isNoteOn = (status & 0xf0) === 0x90;
    const isNoteOff = ((status & 0xf0) === 0x80) || (isNoteOn && velocity === 0);
    const vel = velocity / 127;
    const harmoniumIdx = note - 48; 

    if (isNoteOn && vel > 0) {
        handleKeyPress(harmoniumIdx, vel);
    } else if (isNoteOff) {
        handleKeyRelease(harmoniumIdx);
    }
}

function handleKeyPress(i, vel = 0.8) {
    if (!isStarted) return;

    if (isStrictRaga) {
        const selectedRaga = ragaKeys[currentRagaIdx];
        const allowedNotes = ragas[selectedRaga];
        
        if (selectedRaga !== "none" && allowedNotes) {
            const adjustedIdx = i - transposeShift;
            const logicalNote = ((adjustedIdx % 12) + 12) % 12;
            
            if (!allowedNotes.includes(logicalNote)) return; 
        }
    }

    if (isDroneMode && activeNotes.has(i)) {
        stopAudio(i);
        heldKeys.add(i); 
        heldKeys.delete(i); 
        return;
    }

    heldKeys.add(i);
    if (activeNotes.has(i)) stopAudio(i); 
    startAudio(i, vel);
}

function handleKeyRelease(i) {
    heldKeys.delete(i);
    if (isDroneMode) return;

    if (isSustain) {
        sustainQueue.add(i);
        return;
    }
    
    stopAudio(i);
}

function startAudio(i, vel = 0.8) {
    if (activeNotes.has(i) || !synth) return;

    const baseMidi = 48 + i; 
    const totalShift = transposeShift + octaveShift * 12;
    const targetMidi = baseMidi + totalShift;
    const midiVelocity = Math.floor(vel * 127);

    synth.noteOn(0, targetMidi, midiVelocity);

    if (isCoupler) {
        synth.noteOn(0, targetMidi + 12, Math.floor(midiVelocity * 0.5));
    }

    if (isSubOct) {
        synth.noteOn(0, targetMidi - 12, Math.floor(midiVelocity * 0.5));
    }

    activeNotes.set(i, { 
        playedMidi: targetMidi, 
        vel: vel,
        couplerActive: isCoupler, 
        subOctActive: isSubOct 
    });

    const el = document.querySelector(`[data-idx="${i}"]`);
    if (el) el.classList.add('active');
}

function stopAudio(i) {
    const d = activeNotes.get(i);
    if (!d || !synth) return;

    synth.noteOff(0, d.playedMidi);

    if (d.couplerActive) {
        synth.noteOff(0, d.playedMidi + 12);
    }
    if (d.subOctActive) {
        synth.noteOff(0, d.playedMidi - 12);
    }

    activeNotes.delete(i);
    const el = document.querySelector(`[data-idx="${i}"]`);
    if (el) el.classList.remove('active');
}

function refreshAudio(forceRestart = false) {
    if (!synth) return;

    if (forceRestart) {
        const notesToRestart = Array.from(activeNotes.entries());
        notesToRestart.forEach(([i]) => stopAudio(i));
        notesToRestart.forEach(([i, d]) => startAudio(i, d.vel));
    } else {
        activeNotes.forEach((d, i) => {
            const midiVelocity = Math.floor(d.vel * 127);

            if (isCoupler && !d.couplerActive) {
                synth.noteOn(0, d.playedMidi + 12, Math.floor(midiVelocity * 0.5));
                d.couplerActive = true;
            } else if (!isCoupler && d.couplerActive) {
                synth.noteOff(0, d.playedMidi + 12);
                d.couplerActive = false;
            }

            if (isSubOct && !d.subOctActive) {
                synth.noteOn(0, d.playedMidi - 12, Math.floor(midiVelocity * 0.5));
                d.subOctActive = true;
            } else if (!isSubOct && d.subOctActive) {
                synth.noteOff(0, d.playedMidi - 12);
                d.subOctActive = false;
            }
        });
    }
}

function setTranspose(dir) {
    transposeShift = Math.max(-12, Math.min(12, transposeShift + dir));
    document.getElementById('trans-display').innerText = 
        transposeShift === 0 ? "T" : (transposeShift > 0 ? "+" : "") + transposeShift;
    
    toggleNotation();
    applyRagaFilter();
    refreshAudio(true); 
}

function setOctave(v) {
    octaveShift = v;
    document.querySelectorAll('.oct-led').forEach(l => l.classList.remove('active'));
    let targetId = "";
    if (v === -1) targetId = "oct-low";
    else if (v === 0) targetId = "oct-mid";
    else if (v === 1) targetId = "oct-high";

    const led = document.getElementById(targetId);
    if (led) led.classList.add('active');
    
    toggleNotation();
    refreshAudio(true);
}

function toggleNotation() {
    const checkbox = document.getElementById('notation-checkbox');
    const isIndian = checkbox ? checkbox.checked : false;

    document.querySelectorAll('.key').forEach(k => {
        const noteTxt = k.querySelector('.note-txt');
        if (!noteTxt) return; 

        if (LabelsHidden) {
            noteTxt.innerHTML = '';
            return;
        }

        const i = parseInt(k.dataset.idx);
        let labelIdx = (i - transposeShift) % 12;
        while (labelIdx < 0) labelIdx += 12;

        if (isIndian) {
            let sargam = indianScale[labelIdx];
            let keyOctave = Math.floor((i + transposeShift) / 12);
            let totalOctave = keyOctave + octaveShift;
            let finalHTML = sargam;

            if (sargam === sargam.toLowerCase() && !["Sa", "Pa", "ma"].includes(sargam)) {
                finalHTML = `<u>${sargam}</u>`;
            } else if (sargam === 'ma') {
                finalHTML = `<span class="teevra">${sargam}</span>`;
            }

            if (totalOctave <= -2) {
                noteTxt.innerHTML = `<span class="double-dot-below">${finalHTML}</span>`;
            } else if (totalOctave === -1) {
                noteTxt.innerHTML = `<span class="dot-below">${finalHTML}</span>`;
            } else if (totalOctave === 1) {
                noteTxt.innerHTML = `<span class="dot-above">${finalHTML}</span>`;
            } else if (totalOctave >= 2) {
                noteTxt.innerHTML = `<span class="double-dot-above">${finalHTML}</span>`;
            } else {
                noteTxt.innerHTML = finalHTML;
            }
        } else {
            const noteName = scale[labelIdx];
            let physicalOctave = Math.floor(i / 12) + 2;
            let currentOctave = physicalOctave;

            if (noteName === "C") {
                noteTxt.innerHTML = `${noteName}<span class="octave-num">${currentOctave}</span>`;
            } else {
                noteTxt.innerText = noteName;
            }
        }
    });
}

function cycleRaga(dir){
    currentRagaIdx += dir; 
    if(currentRagaIdx < 0) currentRagaIdx = ragaKeys.length - 1; 
    if(currentRagaIdx >= ragaKeys.length) currentRagaIdx = 0;
    
    const label = document.getElementById('current-raga-name');
    label.innerText = ragaKeys[currentRagaIdx] === 'none' ? 'Chromatic' : ragaKeys[currentRagaIdx];
    label.classList.toggle('is-locked', isStrictRaga);
    
    applyRagaFilter();
}

function applyRagaFilter(ragaName) {
    const selected = (ragaName || ragaKeys[currentRagaIdx]).toLowerCase();
    const allowed = ragas[selected];
    
    document.querySelectorAll('.key').forEach(el => {
        el.classList.remove('highlight-y', 'highlight-p', 'highlight-o', 'highlight-b', 'highlight-g', 'raga-dimmed', 'raga-locked');
        
        if (selected === "none" || !allowed) return;

        const i = parseInt(el.dataset.idx);
        const adjustedIdx = i - transposeShift;
        const logicalNote = ((adjustedIdx % 12) + 12) % 12;

        if (allowed.includes(logicalNote)) {
            let mask = 'highlight-y';
            if (['kalyan','purvi','marwa'].includes(selected)) mask = 'highlight-p';
            if (['bhairav','todi','bhopali','shree'].includes(selected)) mask = 'highlight-o';
            if (['malkauns','asavari','bhairavi'].includes(selected)) mask = 'highlight-b';
            if (['khamaj','kafi','desh'].includes(selected)) mask = 'highlight-g';
            el.classList.add(mask);
        } else {
            el.classList.add(isStrictRaga ? 'raga-locked' : 'raga-dimmed');
        }
    });
}

function toggleSustain(s){
    isSustain = s;
    if (synth) {
        synth.controllerChange(0, 64, s ? 127 : 0);
    }
    if(!s){
        isDroneMode = false;
        document.getElementById("hold-btn")?.classList.remove("active");
        activeNotes.forEach((_, i) => { if (!heldKeys.has(i)) stopAudio(i); });
        sustainQueue.clear();
    }
}

function loop() {
    if (isManual) {
        const targetFill = Math.min(100, reservoir + pumpCharge); 
        
        reservoir += (targetFill - reservoir) * 0.04; 
        
        pumpCharge *= 0.95; 
        const drain = 0.02 + activeNotes.size * 0.03; 
        reservoir = Math.max(0, reservoir - drain);

        if (synth) {
            // Map reservoir (0-100) directly to Expression CC 11 (0-127)
            const expressionVal = Math.floor((reservoir / 100) * 127);
            const clampedExpression = Math.min(127, Math.max(0, expressionVal));
            
            synth.controllerChange(0, 11, clampedExpression);
        }
    }

    const airFillEl = document.getElementById('air-fill');
    if (airFillEl) {
        airFillEl.style.width = reservoir + "%";
    }

    requestAnimationFrame(loop);
}

let smoothedDataArray = null;

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);
    if (!analyser) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    if (!smoothedDataArray || smoothedDataArray.length !== bufferLength) {
        smoothedDataArray = new Float32Array(bufferLength);
        for (let i = 0; i < bufferLength; i++) {
            smoothedDataArray[i] = dataArray[i];
        }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.beginPath(); 
    ctx.strokeStyle = "rgba(212,175,55,0.8)"; 
    ctx.lineWidth = 1.5; 

    // Lower = smoother/slower. Higher = more reactive/jumpy.
    const smoothingFactor = 0.25; 

    for (let i = 0; i < bufferLength; i++) {
        smoothedDataArray[i] += (dataArray[i] - smoothedDataArray[i]) * smoothingFactor;

        const v = smoothedDataArray[i] / 128.0;
        const x = (i / bufferLength) * canvas.width;
        const y = (v * 0.5) * canvas.height;

        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
}

document.getElementById('start-btn').onclick = async () => {
    audioCtx = new AudioContext();

    const processorUrl = "https://unpkg.com/spessasynth_lib@4.3.0/dist/spessasynth_processor.min.js";
    const processorCode = await (await fetch(processorUrl)).text();
    const blob = new Blob([processorCode], { type: "application/javascript" });
    const blobUrl = URL.createObjectURL(blob);

    await audioCtx.audioWorklet.addModule(blobUrl);
    URL.revokeObjectURL(blobUrl);
    
    const sfont = await (await fetch("./harmonium.sf2")).arrayBuffer();
    synth = new WorkletSynthesizer(audioCtx);
    await synth.soundBankManager.addSoundBank(sfont, "main");
    await synth.isReady;

    volumeNode = audioCtx.createGain();
    synth.connect(volumeNode);
    volumeNode.connect(audioCtx.destination);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 1024; 
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    synth.connect(analyser);
    analyser.connect(volumeNode);
    volumeNode.connect(audioCtx.destination);
    
    await audioCtx.resume();
    synth.programChange(0, 0); 

    isStarted = true;
    document.getElementById('overlay')?.remove();
    initKeyboard();
    setupUIButtons();
    setupMIDI();
    toggleNotation();
    loop();
    drawVisualizer();

    window.addEventListener('contextmenu', e => e.preventDefault(), false);
    window.addEventListener('dragstart', e => e.preventDefault(), false);

    const ragaNameLabel = document.getElementById('current-raga-name');
    if (ragaNameLabel) {
        ragaNameLabel.addEventListener("click", () => {
            isStrictRaga = !isStrictRaga;
            ragaNameLabel.classList.toggle('is-locked', isStrictRaga);
            applyRagaFilter();
        });
    }

    window.onkeydown = (e) => {
        if (e.repeat) return;
        if (e.code === 'Space') {
            e.preventDefault();
            if (isManual) pumpCharge = Math.min(pumpCharge + 70, 100);
            return;
        }
        if (e.key === 'Shift') {
            toggleSustain(true);
            return;
        }
        const idx = keyMap[e.key.toLowerCase()];
        if (idx !== undefined) handleKeyPress(idx);
    };

    window.onkeyup = (e) => {
        if (e.key === 'Shift') toggleSustain(false);
        const idx = keyMap[e.key.toLowerCase()];
        if (idx !== undefined) handleKeyRelease(idx);
    };
};

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}
