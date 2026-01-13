
/* -------------------------
   GLOBAL VARIABLES
------------------------- */
let octaveShift = 0,
    transposeShift = 0,
    reservoir = 100,
    isStarted = false,
    isManual = false,
    isDroneMode = false,
    isCoupler = false,
    isSubOct = false,
    isSustain = false,
    baseVol = -12,
    pumpCharge = 0;

const activeNotes = new Map(),
      heldKeys = new Set(),
      sustainQueue = new Set();

const scale = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const indianScale = ["Sa","re","Re","ga","Ga","Ma","ma","Pa","dha","Dha","ni","Ni"];
const keyMap = {'a':0,'w':1,'s':2,'e':3,'d':4,'f':5,'t':6,'g':7,'y':8,'h':9,'u':10,'j':11,'k':12,'o':13,'l':14,'p':15,';':16,"'":17};

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


/* -------------------------
   AUDIO SETUP
------------------------- */
const reverb = new Tone.Reverb({ decay: 4, wet: 0.3 }).toDestination();
const chorus = new Tone.Chorus(4,2.5,0.5).connect(reverb).start();
chorus.wet.value = 0;

const sampler = new Tone.Sampler({
    urls: {"C3":"100_Sa_B_harmonium1_1.mp3","G3":"100_Pa_M_harmonium1_1.mp3","C4":"100_Sa_H_harmonium1_1.mp3"},
    baseUrl:"https://raw.githubusercontent.com/rtalwar26/midi-harmonium/master/audio/harmonium/"
}).connect(chorus);

/* Visualizer */
const wave = new Tone.Waveform(512);
sampler.connect(wave);
const canvas = document.getElementById('visualizer-canvas'), ctx = canvas.getContext('2d');

/* -------------------------
   KEYBOARD SETUP
------------------------- */
function initKeyboard() {
    const kb = document.getElementById('keyboard');
    kb.innerHTML = '';
    for (let i = 0; i < 22; i++) {
        const k = document.createElement('div');
        k.className = `key ${scale[i%12].includes('#') ? 'black':'white'}`;
        k.dataset.idx = i;
        k.innerHTML = `<span class="note-txt"></span>`;
        kb.appendChild(k);

        k.onmousedown = e => {
            e.preventDefault();
            const rect = k.getBoundingClientRect();
            const y = e.clientY - rect.top;
            const velocity = (y / rect.height) * 0.7 + 0.3;
            handleKeyPress(i, velocity);
        };
        k.onmouseup = () => handleKeyRelease(i);
        k.onmouseleave = () => handleKeyRelease(i);
    }
}

/* -------------------------
   UI BUTTONS / SLIDERS
------------------------- */
function setupUIButtons() {
    // Manual Toggle
    const manualToggle = document.getElementById("manual-toggle");
    manualToggle?.addEventListener("change", e => {
        isManual = e.target.checked;
        reservoir = isManual ? 0 : 100;
        document.getElementById('meter-ui').style.display = isManual ? 'block' : 'none';
    });

    // Sub-Oct Toggle
    document.getElementById("sub-oct-toggle")?.addEventListener("change", e => {
        isSubOct = e.target.checked;
        refreshAudio();
    });

    // Coupler Toggle
    document.getElementById("coupler-toggle")?.addEventListener("change", e => {
        isCoupler = e.target.checked;
        refreshAudio();
    });

    // Drone/Hold
    const holdBtn = document.getElementById("hold-btn");
    holdBtn?.addEventListener("click", () => {
        isDroneMode = !isDroneMode;
        holdBtn.classList.toggle("active");
        if (!isDroneMode) {
            activeNotes.forEach((_,i) => { if (!heldKeys.has(i)) stopAudio(i); });
        } else {
            heldKeys.forEach(i => { if (!activeNotes.has(i)) startAudio(i); });
        }
    });

    // Sliders
    document.getElementById('vol')?.addEventListener("input", e => baseVol = parseFloat(e.target.value));
    document.getElementById('sus')?.addEventListener("input", e => sampler.release = parseFloat(e.target.value));
    document.getElementById('rev')?.addEventListener("input", e => reverb.wet.value = parseFloat(e.target.value));
    document.getElementById('chorus-slider')?.addEventListener("input", e => {
        const val = parseFloat(e.target.value);
        chorus.depth = val;
        chorus.wet.value = val>0 ? 0.4 : 0;
    });

    // Transpose Buttons
    document.querySelector(".trans-left")?.addEventListener("click", () => setTranspose(-1));
    document.querySelector(".trans-right")?.addEventListener("click", () => setTranspose(1));

    // Octave Buttons
    document.querySelectorAll(".oct-unit").forEach(el => {
        el.style.cursor = "pointer";
        el.addEventListener("click", () => setOctave(parseInt(el.dataset.octave)));
    });

    // Notation Toggle
    document.getElementById("notation-checkbox")?.addEventListener("change", toggleNotation);

    // Raga stepper
    document.querySelector(".stepper-left")?.addEventListener("click", () => cycleRaga(-1));
    document.querySelector(".stepper-right")?.addEventListener("click", () => cycleRaga(1));
}

/* -------------------------
   MIDI SETUP
------------------------- */
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

            // Reset all inputs
            inputs.forEach(input => input.onmidimessage = null);

            // If no device selected → LED off
            if (!portId) {
                midiGroup.classList.remove('active');
                return;
            }

            // Activate LED
            midiGroup.classList.add('active');

            // Assign the MIDI callback
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

    // Use 36 (C2) as the floor to ensure common MIDI keyboards 
    // align better with the harmonium's starting range.
    const harmoniumIdx = note - 36; 

    if (isNoteOn && vel > 0) {
        handleKeyPress(harmoniumIdx, vel);
    } else if (isNoteOff) {
        handleKeyRelease(harmoniumIdx);
    }
}
/* -------------------------
   NOTE LOGIC
------------------------- */
function handleKeyPress(i, vel = 0.8) {
   if (!isStarted) return;

    // --- STRICT RAGA GATE ---
    if (isStrictRaga) {
        const selectedRaga = ragaKeys[currentRagaIdx];
        const allowedNotes = ragas[selectedRaga];
        
        if (selectedRaga !== "none" && allowedNotes) {
            // Subtract transposeShift to check the note's position relative to the root Sa
            const adjustedIdx = i - transposeShift;
            const logicalNote = ((adjustedIdx % 12) + 12) % 12;
            
            if (!allowedNotes.includes(logicalNote)) return; 
        }
    }

    if (isDroneMode && activeNotes.has(i)) {
        stopAudio(i);
        heldKeys.add(i); // Still track the physical key state
        heldKeys.delete(i); 
        return;
    }

    heldKeys.add(i);
    if (activeNotes.has(i)) stopAudio(i); 
    startAudio(i, vel);
}

function handleKeyRelease(i) {
    heldKeys.delete(i);
    
    // EXPLICIT CHECK: If Drone is on, don't stop the audio on release
    if (isDroneMode) return;

    if (isSustain) {
        sustainQueue.add(i);
        return;
    }
    
    stopAudio(i);
}


function startAudio(i, vel = 0.8) {
    if (activeNotes.has(i)) return;

    const totalShift = transposeShift + octaveShift * 12;
    const baseOctave = 3; 
    const pitch = Tone.Frequency(scale[((i % 12) + 12) % 12] + (baseOctave + Math.floor(i / 12))).transpose(totalShift);
    const noteName = pitch.toNote();

    sampler.triggerAttack(noteName, Tone.now(), vel);
    if (isCoupler) sampler.triggerAttack(pitch.transpose(12).toNote(), Tone.now(), vel * 0.5);
    if (isSubOct) sampler.triggerAttack(pitch.transpose(-12).toNote(), Tone.now(), vel * 0.5);

    // Save state once
    activeNotes.set(i, { 
        name: noteName, 
        vel: vel,
        couplerActive: isCoupler, 
        subOctActive: isSubOct 
    });

    const el = document.querySelector(`[data-idx="${i}"]`);
    if (el) el.classList.add('active');
}

function stopAudio(i) {
    const d = activeNotes.get(i);
    if (!d) return;

    // Release base note plus both potential side notes
    const p = Tone.Frequency(d.name);
    sampler.triggerRelease([
        d.name,
        p.transpose(12).toNote(),
        p.transpose(-12).toNote()
    ], Tone.now());

    activeNotes.delete(i);
    const el = document.querySelector(`[data-idx="${i}"]`);
    if (el) el.classList.remove('active');
}

function refreshAudio(forceRestart = false) {
    if (forceRestart) {
        // 1. Create a static snapshot of current notes to avoid modifying Map during iteration
        const notesToRestart = Array.from(activeNotes.entries());
        
        // 2. Clear all current sounds
        notesToRestart.forEach(([i]) => {
            stopAudio(i);
        });

        // 3. Restart them (startAudio will now use the updated transpose/octave shifts)
        notesToRestart.forEach(([i, d]) => {
            startAudio(i, d.vel);
        });
    } else {
        // Smooth Toggle Logic for Coupler/Sub-Oct (No restart)
        activeNotes.forEach((d, i) => {
            const totalShift = transposeShift + octaveShift * 12;
            const pitch = Tone.Frequency(scale[((i % 12) + 12) % 12] + (3 + Math.floor(i / 12))).transpose(totalShift);
            
            const couplerNote = pitch.transpose(12).toNote();
            const subOctNote = pitch.transpose(-12).toNote();

            if (isCoupler && !d.couplerActive) {
                sampler.triggerAttack(couplerNote, Tone.now(), d.vel * 0.5);
                d.couplerActive = true;
            } else if (!isCoupler && d.couplerActive) {
                sampler.triggerRelease(couplerNote, Tone.now());
                d.couplerActive = false;
            }

            if (isSubOct && !d.subOctActive) {
                sampler.triggerAttack(subOctNote, Tone.now(), d.vel * 0.5);
                d.subOctActive = true;
            } else if (!isSubOct && d.subOctActive) {
                sampler.triggerRelease(subOctNote, Tone.now());
                d.subOctActive = false;
            }
        });
    }
}

/* -------------------------
   TRANSPOSE / OCTAVE / NOTATION / RAGA
------------------------- */
function setTranspose(dir) {
    transposeShift = Math.max(-12, Math.min(12, transposeShift + dir));
    document.getElementById('trans-display').innerText = 
        transposeShift === 0 ? "T" : (transposeShift > 0 ? "+" : "") + transposeShift;
    
    toggleNotation();
    applyRagaFilter();
    refreshAudio(true); // <--- Add true here to restart notes with new pitch
}

function setOctave(v) {
    octaveShift = v;

    // 1. Remove active class from ALL possible LEDs
    document.querySelectorAll('.oct-led').forEach(l => l.classList.remove('active'));

    // 2. Explicitly map the value to the ID to prevent calculation errors
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
        const i = parseInt(k.dataset.idx);
        let labelIdx = (i - transposeShift) % 12;
        while (labelIdx < 0) labelIdx += 12;

        const noteTxt = k.querySelector('.note-txt');
        if (!noteTxt) return; 

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
            // --- Western Mode (Restored Octave Numbers) ---
            const noteName = scale[labelIdx];
            let currentOctave = Math.floor(i / 12) + 3 + octaveShift;

            if (noteName === "C") {
                noteTxt.innerHTML = `${noteName}<span class="octave-num">${currentOctave}</span>`;
            } else {
                noteTxt.innerText = noteName;
            }
        }
    });
}

function cycleRaga(dir){
    currentRagaIdx+=dir; if(currentRagaIdx<0) currentRagaIdx=ragaKeys.length-1; if(currentRagaIdx>=ragaKeys.length) currentRagaIdx=0;
    document.getElementById('current-raga-name').innerText=ragaKeys[currentRagaIdx]==='none'?'Chromatic':ragaKeys[currentRagaIdx];
    applyRagaFilter();
}

function applyRagaFilter(ragaName) {
    const selected = (ragaName || ragaKeys[currentRagaIdx]).toLowerCase();
    const allowed = ragas[selected];
    
    document.querySelectorAll('.key').forEach(el => {
        // 1. Reset all possible visual states
        el.classList.remove('highlight-y', 'highlight-p', 'highlight-o', 'highlight-b', 'highlight-g', 'raga-dimmed', 'raga-locked');
        
        if (selected === "none" || !allowed) return;

        // 2. Calculate the "Relative Sa" based on Transpose
        // This ensures the coloring moves with your Transpose setting
        const i = parseInt(el.dataset.idx);
        const adjustedIdx = i - transposeShift;
        const logicalNote = ((adjustedIdx % 12) + 12) % 12;

        // 3. Apply coloring or locking
        if (allowed.includes(logicalNote)) {
            // Determine which color mask to use based on the Raga
            let mask = 'highlight-y'; // Default Yellow
            if (['kalyan','purvi','marwa'].includes(selected)) mask = 'highlight-p';
            if (['bhairav','todi','bhopali','shree'].includes(selected)) mask = 'highlight-o';
            if (['malkauns','asavari','bhairavi'].includes(selected)) mask = 'highlight-b';
            if (['khamaj','kafi','desh'].includes(selected)) mask = 'highlight-g';
            
            el.classList.add(mask);
        } else {
            // If not in the raga, dim it or lock it
            el.classList.add(isStrictRaga ? 'raga-locked' : 'raga-dimmed');
        }
    });
}

/* -------------------------
   SUSTAIN
------------------------- */
function toggleSustain(s){
    isSustain=s;
    if(!s){
        isDroneMode=false;
        document.getElementById("hold-btn")?.classList.remove("active");
        activeNotes.forEach((_,i)=>{if(!heldKeys.has(i)) stopAudio(i);});
        sustainQueue.clear();
    }
}

/* -------------------------
   VISUALIZER & MANUAL LOOP
------------------------- */
function loop(){
    if(isManual){
        reservoir=Math.min(100,reservoir+(pumpCharge*0.12));
        pumpCharge*=0.85;
        reservoir=Math.max(0,reservoir-(0.05+activeNotes.size*0.04));
    }
    document.getElementById('air-fill').style.width=reservoir+"%";
    sampler.volume.rampTo(isManual?(reservoir<0.01?-100:baseVol+Tone.gainToDb(reservoir/70)):baseVol,0.1);
    requestAnimationFrame(loop);
}

function drawVisualizer(){
    requestAnimationFrame(drawVisualizer);
    const b = wave.getValue();
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.beginPath(); ctx.strokeStyle="rgba(212,175,55,0.8)"; ctx.lineWidth=1;
    for(let i=0;i<512;i++){
        const x=(i/512)*canvas.width, y=(0.5+b[i]*0.4)*canvas.height;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.stroke();
}

/* -------------------------
   START BUTTON
------------------------- */
document.getElementById('start-btn').onclick = async () => {
    await Tone.start();
    isStarted = true;
    document.getElementById('overlay')?.remove();
    initKeyboard();
    setupUIButtons();
    setupMIDI();
    toggleNotation();
    loop();
    drawVisualizer();

    window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
}, false);

// Disable dragging of elements (prevents ghost images of keys/labels when clicking)
window.addEventListener('dragstart', (e) => {
    e.preventDefault();
}, false);

document.getElementById("strict-raga-toggle")?.addEventListener("change", e => {
    isStrictRaga = e.target.checked;
    // Visually update the keys immediately
    applyRagaFilter(); 
});

document.getElementById("strict-raga-toggle")?.addEventListener("change", e => {
    isStrictRaga = e.target.checked;
    applyRagaFilter(); // Refresh visual state immediately
});


    // ----- KEYBOARD & PUMP HANDLER -----
    window.onkeydown = (e) => {
        if (e.repeat) return;

        // Pump bellows
        if (e.code === 'Space') {
            e.preventDefault();
            if (isManual) pumpCharge = Math.min(pumpCharge + 70, 100);
            return;
        }

        // Sustain
        if (e.key === 'Shift') {
            toggleSustain(true);
            return;
        }

        // Normal key presses
        const idx = keyMap[e.key.toLowerCase()];
        if (idx !== undefined) handleKeyPress(idx);
    };

    window.onkeyup = (e) => {
        if (e.key === 'Shift') toggleSustain(false);
        const idx = keyMap[e.key.toLowerCase()];
        if (idx !== undefined) handleKeyRelease(idx);
    };
};


let currentMidi = null;
let animationFrameId = null; // To track and stop the loop

document.addEventListener('DOMContentLoaded', () => {
    const songFileInput = document.getElementById('song-file-input');
    const songLabel = document.getElementById('song-label');
    const playBtn = document.getElementById('midi-play');
    const stopBtn = document.getElementById('midi-stop');
    const progressBar = document.getElementById('midi-progress-bar');
    const progressContainer = document.querySelector('.midi-progress-container');
    const tempoSlider = document.getElementById('tempo-slider');

    // --- 1. MIDI FILE LOADING ---
    songFileInput?.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            currentMidi = new Midi(arrayBuffer);
            
            // Sync UI and Transport
            const midiBpm = currentMidi.header.tempos[0]?.bpm || 120;
            updateTempo(midiBpm);
            prepareMidiTransport();

            if (songLabel) songLabel.innerText = file.name.substring(0, 10) + "...";
        } catch (err) {
            console.error("Midi Load Error:", err);
        }
    });

    // --- 2. TRANSPORT CONTROLS ---
    playBtn?.addEventListener('click', async () => {
        await Tone.start();
        if (Tone.Transport.state === 'started') {
            Tone.Transport.pause();
            playBtn.innerText = '▶';
        } else {
            Tone.Transport.start();
            playBtn.innerText = '⏸';
            startProgressLoop(); // Start the single loop
        }
    });

    stopBtn?.addEventListener('click', () => {
        Tone.Transport.stop();
        if (playBtn) playBtn.innerText = '▶';
        if (progressBar) progressBar.style.width = '0%';
        
        // Panic: Kill all sound and UI highlights
        cancelAnimationFrame(animationFrameId);
        document.querySelectorAll('.key').forEach(k => {
            k.classList.remove('active', 'midi-active');
            handleKeyRelease(parseInt(k.dataset.idx)); 
        });
    });

    // --- 3. TEMPO & PROGRESS LOGIC ---
    tempoSlider?.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        Tone.Transport.bpm.value = val;
        const display = document.getElementById('bpm-display');
        if (display) display.innerText = Math.round(val);
    });

    progressContainer?.addEventListener('click', (e) => {
        if (!currentMidi) return;
        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        
        Tone.Transport.seconds = percent * currentMidi.duration;
        if (progressBar) progressBar.style.width = (percent * 100) + '%';
    });
});

// --- HELPER FUNCTIONS ---

function prepareMidiTransport() {
    Tone.Transport.cancel(); // Wipe previous schedule

    currentMidi.tracks.forEach(track => {
        track.notes.forEach(note => {
            const keyIdx = note.midi - 48;
            if (keyIdx >= 0 && keyIdx < 100) { 
                Tone.Transport.schedule((time) => {
                    handleKeyPress(keyIdx, note.velocity);
                    Tone.Draw.schedule(() => {
                        document.querySelector(`.key[data-idx="${keyIdx}"]`)?.classList.add('midi-active');
                    }, time);
                }, note.time);

                Tone.Transport.schedule((time) => {
                    handleKeyRelease(keyIdx);
                    Tone.Draw.schedule(() => {
                        document.querySelector(`.key[data-idx="${keyIdx}"]`)?.classList.remove('midi-active');
                    }, time);
                }, note.time + note.duration);
            }
        });
    });
}

function startProgressLoop() {
    // Prevent multiple loops from running at once
    cancelAnimationFrame(animationFrameId);
    
    const update = () => {
        const progressBar = document.getElementById('midi-progress-bar');
        if (currentMidi && Tone.Transport.state === 'started') {
            const progress = (Tone.Transport.seconds / currentMidi.duration) * 100;
            if (progressBar) progressBar.style.width = Math.min(progress, 100) + '%';
        }
        animationFrameId = requestAnimationFrame(update);
    };
    update();
}

function updateTempo(val) {
    const bpm = Math.round(val);
    Tone.Transport.bpm.value = bpm;
    const slider = document.getElementById('tempo-slider');
    const display = document.getElementById('bpm-display');
    if (slider) slider.value = bpm;
    if (display) display.innerText = bpm;
}