
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

    const harmoniumIdx = note - 48; // Map MIDI C4=60 → harmonium index

    if (isNoteOn && vel > 0) {
        handleKeyPress(harmoniumIdx, vel);
    } else if (isNoteOff) {
        handleKeyRelease(harmoniumIdx);
    }
}
/* -------------------------
   NOTE LOGIC
------------------------- */
function handleKeyPress(i, vel=0.8){
    if(!isStarted) return;
    heldKeys.add(i);
    if(activeNotes.has(i)) stopAudio(i); // handle repeat
    startAudio(i, vel); // no longer limit i<22
}

function handleKeyRelease(i){
    heldKeys.delete(i);
    if (isDroneMode || isSustain) { if (isSustain) sustainQueue.add(i); return; }
    stopAudio(i);
}

function startAudio(i, vel = 0.8) {
    if (activeNotes.has(i)) return;

    // Calculate total shift
    const totalShift = transposeShift + octaveShift * 12;

    // Compute note frequency
    const freq = Tone.Frequency(scale[i % 12] + (3 + Math.floor(i / 12))).transpose(totalShift);
    const noteName = freq.toNote();

    // Trigger sampler
    sampler.triggerAttack(noteName, Tone.now(), vel);
    if (isCoupler) sampler.triggerAttack(freq.transpose(12).toNote(), Tone.now(), vel * 0.5);
    if (isSubOct) sampler.triggerAttack(freq.transpose(-12).toNote(), Tone.now(), vel * 0.5);

    activeNotes.set(i, { name: noteName, vel });

    // Visual highlight only if key exists on screen
    const el = document.querySelector(`[data-idx="${i}"]`);
    if (el) el.classList.add('active');
}

function stopAudio(i){
    const d = activeNotes.get(i); if(!d) return;
    sampler.triggerRelease([d.name,
        Tone.Frequency(d.name).transpose(12).toNote(),
        Tone.Frequency(d.name).transpose(-12).toNote()], Tone.now());
    activeNotes.delete(i);
    document.querySelector(`[data-idx="${i}"]`)?.classList.remove('active');
}

function refreshAudio(){
    Array.from(activeNotes.entries()).forEach(([i,d])=>{ stopAudio(i); startAudio(i,d.vel); });
}

/* -------------------------
   TRANSPOSE / OCTAVE / NOTATION / RAGA
------------------------- */
function setTranspose(dir){ transposeShift=Math.max(-12,Math.min(12,transposeShift+dir)); document.getElementById('trans-display').innerText=(transposeShift>=0?"+":"")+transposeShift; toggleNotation(); applyRagaFilter(); refreshAudio(); }
function setOctave(v){ octaveShift=v; document.querySelectorAll('.oct-led').forEach(l=>l.classList.remove('active')); document.getElementById(['oct-low','oct-mid','oct-high'][v+1]).classList.add('active'); toggleNotation(); refreshAudio(); }

function toggleNotation(){
    const isIndian = document.getElementById('notation-checkbox')?.checked || false;
    document.querySelectorAll('.key').forEach(k=>{
        const i=parseInt(k.dataset.idx);
        let labelIdx=(i-transposeShift+12)%12;
        const noteTxt=k.querySelector('.note-txt'); if(!noteTxt) return;
        if(isIndian){
            let sargam=indianScale[labelIdx], keyOct=Math.floor((i+transposeShift)/12), totalOct=keyOct+octaveShift;
            let html=sargam; if(sargam===sargam.toLowerCase() && !["Sa","Pa","ma"].includes(sargam)) html=`<u>${sargam}</u>`; else if(sargam==='ma') html=`<span class="teevra">${sargam}</span>`;
            if(totalOct<=-2) noteTxt.innerHTML=`<span class="double-dot-below">${html}</span>`;
            else if(totalOct===-1) noteTxt.innerHTML=`<span class="dot-below">${html}</span>`;
            else if(totalOct===1) noteTxt.innerHTML=`<span class="dot-above">${html}</span>`;
            else if(totalOct>=2) noteTxt.innerHTML=`<span class="double-dot-above">${html}</span>`;
            else noteTxt.innerHTML=html;
        } else { noteTxt.innerText = scale[labelIdx]; }
    });
}

function cycleRaga(dir){
    currentRagaIdx+=dir; if(currentRagaIdx<0) currentRagaIdx=ragaKeys.length-1; if(currentRagaIdx>=ragaKeys.length) currentRagaIdx=0;
    document.getElementById('current-raga-name').innerText=ragaKeys[currentRagaIdx]==='none'?'Chromatic':ragaKeys[currentRagaIdx];
    applyRagaFilter();
}

function applyRagaFilter(ragaName){
    const selected=(ragaName||ragaKeys[currentRagaIdx]).toLowerCase();
    const allowed=ragas[selected];
    document.querySelectorAll('.key').forEach(el=>el.classList.remove('highlight-y','highlight-p','highlight-o','highlight-b','highlight-g','raga-dimmed'));
    if(selected==="none"||!allowed) return;
    let mask='highlight-y';
    if(['bhairav','todi','bhopali','shree'].includes(selected)) mask='highlight-o';
    else if(['malkauns','asavari','bhairavi','darbari'].includes(selected)) mask='highlight-b';
    else if(['khamaj','kafi','desh'].includes(selected)) mask='highlight-g';
    else if(['kalyan','purvi','marwa','yaman'].includes(selected)) mask='highlight-p';
    document.querySelectorAll('.key').forEach(el=>{
        const logicalNote=(parseInt(el.dataset.idx)+transposeShift+120)%12;
        if(allowed.includes(logicalNote)) el.classList.add(mask); else el.classList.add('raga-dimmed');
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
