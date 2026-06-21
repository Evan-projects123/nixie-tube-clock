/* script.js - (unchanged, works with the new responsive CSS) */
// Helper function to turn "1" into "I" for authentic Nixie styling
function formatDigit(digit) {
    return digit === '1' ? 'I' : digit;
}

// Safely update elements and trigger the gas glow animation only if the character changed
function setTubeTextWithFade(element, newText) {
    if (element.textContent !== newText) {
        element.textContent = newText;
        if (settings.pulse) {
            element.classList.remove('animate-glow');
            void element.offsetWidth; // Force reflow
            element.classList.add('animate-glow');
        } else {
            element.classList.remove('animate-glow');
        }
    }
}

// --- HARDWARE APP CONFIGURATION ---
let settings = {
    flicker: true,
    slotMachine: true,
    pulse: true,
    mouse: true,
    brightness: "HIGH",  
    colon: "BLINK",      
    fadeSpd: "NORM",     
    ignite: true,
    marqueeSpd: 0.5,
    critFlash: 15, // Battery flash threshold setting
    alarmSoundId: 1, // Default alarm sound ID (0 = No Sound, 1-999999 = Procedural Sounds)
    volume: 100 // New master sound engine volume (0% to 100%)
};

// Application Modes: 0 = CLOCK, 1 = TIMER, 2 = STOPWATCH, 3 = METRONOME, 4 = ALARM
let appMode = 0;

// Sub-Menu States for Settings configuration
let subMenuMode = 0;
let batterySubMenu = false; // Isolated configuration state for the battery menu

const menuKeys = ["flicker", "slotMachine", "pulse", "mouse", "brightness", "colon", "fadeSpd", "ignite", "marqueeSpd", "volume"];
const menuLabels = ["FLICKER", "SLOT MACH", "PULSE", "MOUSE", "BRIGHTNESS", "COLON", "FADE SPEED", "IGNITE", "MARQUEE SPD", "VOLUME"];

const multiOptions = {
    brightness: ["HIGH", "MED", "LOW"],
    colon: ["BLINK", "SOLID", "OFF"],
    fadeSpd: ["SLOW", "NORM", "FAST"]
};

// --- FUNCTIONAL VARIABLES ---
let lastMinute = -1;
let isShuffling = false;
let isCharging = false; // Tracks whether the host system is plugged into power

// Timer State Data
let timerDuration = 0; 
let timerRunning = false;
let timerInterval = null;
let setupTimerVals = { hours: 0, minutes: 0, seconds: 0 };
let timerExpiryTime = 0; 
let timerAlertActive = false; 

// Stopwatch State Data
let stopwatchTime = 0; 
let stopwatchRunning = false;
let stopwatchInterval = null;
let stopwatchStartTime = 0; 

// Marquee dynamic runner storage
let marqueeInterval = null;

// Mechanical Marquee Animator State Machine parameters
let activeSlideView = "TIMER"; // "TIMER" or "STOPWATCH"
let taskSlideStep = 0;         // Tracks indices across sliding layout offsets
let taskHoldCounter = 0;       // Monitors the 3.0-second delay threshold

// Tracking timeouts and intervals for the hardware button repeat rates
let keyHoldTimeout = null;     
let keyRepeatInterval = null;  
let activeKey = null;          

// --- METRONOME STATE DATA ---
let metronomeBpm = 120;
let metronomeRunning = false;
let metronomeAnimationOn = true;
let metronomeInterval = null;
let metronomeStep = 0; // Tracks the visual pendulum swing position
let metroEditDigitIdx = 2; // 0 = Hundreds, 1 = Tens, 2 = Ones digit editing

// --- ALARM STATE DATA ---
let alarmTime = { hours: 6, minutes: 0, seconds: 0 }; 
let alarmEnabled = false;
let alarmAlertActive = false;
let alarmDismissedForMinute = false;
let alarmSoundEditDigitIdx = 5; // Global index 0-5 (0 = Hundred Thousands ... 5 = Ones). Defaults to Page 2, Ones digit.

// --- PROCEDURAL WEB AUDIO ENGINE ---
let audioCtx = null;
let alarmAudioInterval = null;

function initAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playProceduralSound(id, isPreview = false) {
    if (id === 0 || settings.volume === 0) return;
    initAudioContext();
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    const now = audioCtx.currentTime;
    
    // Parse individual sound profiles across 1-999999 possibilities
    const types = ['sine', 'square', 'triangle', 'sawtooth'];
    const type = types[id % 4];
    
    // Extract our 6 architectural digits
    const L100k = Math.floor(id / 100000);              // Digit 1: Filter Mode & Base Brightness
    const L10k = Math.floor((id % 100000) / 10000);     // Digit 2: Tremolo/Stutter Modulation Speed
    const L1k = Math.floor((id % 10000) / 1000);        // Digit 3: Envelope Attack Swell
    const hundreds = Math.floor((id % 1000) / 100);     // Digit 4: Base Frequency Bracket
    const tens = Math.floor((id % 100) / 10);           // Digit 5: Pitch Glide/Slide
    const ones = id % 10;                               // Digit 6: Total Duration

    // --- 1. CORE OSCILLATOR & PITCH ---
    const baseFreq = 100 + (hundreds * 80); // Establish a predictable pitch grid
    const osc = audioCtx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(baseFreq, now);

    // Apply Pitch Glide (Tens digit)
    if (tens > 0) {
        const targetFreq = baseFreq * (1 + (tens * 0.15));
        osc.frequency.linearRampToValueAtTime(targetFreq, now + (isPreview ? 0.1 : 0.25));
    }

    // --- 2. BIQUAD FILTER NODE (L100k Digit) ---
    const filter = audioCtx.createBiquadFilter();
    // Alternates between lowpass and bandpass depending on if the digit is even/odd
    filter.type = (L100k % 2 === 0) ? 'lowpass' : 'bandpass';
    
    // Base filter brightness determined by L100k magnitude
    const initialCutoff = 200 + (L100k * 400);
    filter.frequency.setValueAtTime(initialCutoff, now);
    // Sweep the filter downwards over the course of the note for an analog "plop/wow" sound
    filter.frequency.exponentialRampToValueAtTime(80, now + (isPreview ? 0.15 : 0.3));
    filter.Q.setValueAtTime(L100k * 1.5, now); // Higher value makes the filter sound sharper/ringier

    // --- 3. TREMOLO MODULATION / STUTTER LFO (L10k Digit) ---
    let lfo = null;
    let lfoGain = null;
    if (L10k > 0) {
        lfo = audioCtx.createOscillator();
        lfoGain = audioCtx.createGain();
        
        lfo.type = 'sine';
        lfo.frequency.setValueAtTime(L10k * 4, now); // Stutter speeds from 4Hz up to 36Hz
        lfoGain.gain.setValueAtTime(0.4, now);       // Tremolo depth mix
        
        lfo.connect(lfoGain);
        // Modulate our master volume node below using the LFO
    }

    // --- 4. AMPLITUDE ENVELOPE & VOLUME BOOST ---
    const gainNode = audioCtx.createGain();
    const duration = isPreview ? 0.2 : (0.15 + (ones * 0.05));
    
    // Allow volume to scale much higher (e.g., if settings.volume can go up to 200)
    // 100% volume now equals a clean baseline, anything above starts pushing into overdrive
    const volumeMultiplier = settings.volume / 100; 
    const targetGain = 0.15 * volumeMultiplier;
    
    // Dynamic Attack Swell based on L1k
    const attackTime = isPreview ? 0.01 : (L1k * 0.03);
    
    gainNode.gain.setValueAtTime(0, now);
    gainNode.gain.linearRampToValueAtTime(targetGain, now + attackTime);
    gainNode.gain.setValueAtTime(targetGain, now + Math.max(attackTime, duration - 0.05));
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);

    // --- 5. ANALOG OVERDRIVE / LIMITER STAGE ---
    const distortion = audioCtx.createWaveShaper();
    
    // Simple soft-clipping curve to make "loud" sounds crunchy instead of crackly
    function makeDistortionCurve(amount) {
        const k = typeof amount === 'number' ? amount : 50;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = (i * 2) / n_samples - 1;
            curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
        }
        return curve;
    }

    // Only apply saturation if we are intentionally pushing the volume past 100%
    if (settings.volume > 100) {
        distortion.curve = makeDistortionCurve(settings.volume - 100);
        distortion.oversample = '4x';
    }

    // --- 6. AUDIO ROUTING NODE CHAIN ---
    osc.connect(filter);
    filter.connect(gainNode);
    
    if (settings.volume > 100) {
        // Route through overdrive if boosted
        gainNode.connect(distortion);
        distortion.connect(audioCtx.destination);
    } else {
        // Route clean if normal volume
        gainNode.connect(audioCtx.destination);
    }
    
    if (lfo && lfoGain) {
        lfoGain.connect(gainNode.gain);
        lfo.start(now);
        lfo.stop(now + duration);
    }

    osc.start(now);
    osc.stop(now + duration);
}

function startAlarmAudioLoop() {
    if (alarmAudioInterval) clearInterval(alarmAudioInterval);
    if (settings.alarmSoundId === 0) return;

    const loopIntervalRate = 420 + ((settings.alarmSoundId * 13) % 700); 

    alarmAudioInterval = setInterval(() => {
        if (alarmAlertActive || timerAlertActive) {
            playProceduralSound(settings.alarmSoundId, false);
        } else {
            clearInterval(alarmAudioInterval);
            alarmAudioInterval = null;
        }
    }, loopIntervalRate);
}

// --- LOCALSTORAGE PERSISTENCE CONTROLLERS ---
function savePreferences() {
    const preferenceBundle = {
        settings: settings,
        appMode: appMode,
        setupTimerVals: setupTimerVals,
        timerRunning: timerRunning,
        timerDuration: timerDuration,
        timerExpiryTime: timerExpiryTime,
        timerAlertActive: timerAlertActive,
        stopwatchRunning: stopwatchRunning,
        stopwatchTime: stopwatchTime,
        stopwatchStartTime: stopwatchStartTime,
        metronomeBpm: metronomeBpm,
        metronomeAnimationOn: metronomeAnimationOn,
        alarmTime: alarmTime,
        alarmEnabled: alarmEnabled,
        alarmAlertActive: alarmAlertActive
    };
    localStorage.setItem('nixie_clock_preferences', JSON.stringify(preferenceBundle));
}

function loadPreferences() {
    const rawData = localStorage.getItem('nixie_clock_preferences');
    if (!rawData) return;
    
    try {
        const parsed = JSON.parse(rawData);
        if (parsed.settings) settings = { ...settings, ...parsed.settings };
        if (typeof parsed.appMode === 'number') appMode = parsed.appMode;
        if (parsed.setupTimerVals) setupTimerVals = { ...setupTimerVals, ...parsed.setupTimerVals };
        
        if (typeof parsed.metronomeBpm === 'number') metronomeBpm = parsed.metronomeBpm;
        if (typeof parsed.metronomeAnimationOn === 'boolean') metronomeAnimationOn = parsed.metronomeAnimationOn;

        if (parsed.alarmTime) alarmTime = { ...alarmTime, ...parsed.alarmTime };
        if (typeof parsed.alarmEnabled === 'boolean') alarmEnabled = parsed.alarmEnabled;
        if (parsed.alarmAlertActive) triggerAlarmAlert();

        if (typeof parsed.stopwatchTime === 'number') stopwatchTime = parsed.stopwatchTime;
        if (parsed.stopwatchRunning) {
            stopwatchStartTime = parsed.stopwatchStartTime;
            const overallElapsedMs = Date.now() - stopwatchStartTime;
            stopwatchTime = Math.floor(overallElapsedMs / 50);
            stopwatchRunning = true;
            startStopwatchInterval();
        }

        if (typeof parsed.timerDuration === 'number') timerDuration = parsed.timerDuration;
        if (parsed.timerAlertActive) {
            triggerTimerAlert();
        } else if (parsed.timerRunning) {
            timerExpiryTime = parsed.timerExpiryTime;
            const remainingSecs = Math.ceil((timerExpiryTime - Date.now()) / 1000);
            if (remainingSecs > 0) {
                timerDuration = remainingSecs;
                timerRunning = true;
                startTimerInterval();
            } else {
                triggerTimerAlert();
            }
        }
    } catch (e) {
        console.error("Error reading cached hardware configurations profile", e);
    }
}

// --- UTILITY STRING ALIGNMENT PAD HELPERS ---
function getCenteredMenuString(label, value) {
    if (label === "FLICKER") return value ? "  FLICKER: ON   " : "  FLICKER: OFF  ";
    if (label === "SLOT MACH") return value ? " SLOT MACH: ON  " : " SLOT MACH: OFF ";
    if (label === "PULSE") return value ? "   PULSE: ON    " : "   PULSE: OFF   ";
    if (label === "MOUSE") return value ? "  MOUSE: SHOW   " : "  MOUSE: HIDE   ";
    if (label === "BRIGHTNESS") {
        if (value === "HIGH") return "BRIGHTNESS: HIGH";
        if (value === "MED")  return "BRIGHTNESS: MED ";
        if (value === "LOW")  return "BRIGHTNESS: LOW ";
    }
    if (label === "COLON") {
        if (value === "BLINK") return "  COLON: BLINK  ";
        if (value === "SOLID") return "  COLON: SOLID  ";
        if (value === "OFF")   return "   COLON: OFF   ";
    }
    if (label === "FADE SPEED") {
        if (value === "SLOW") return " FADE SPD: SLOW ";
        if (value === "NORM") return " FADE SPD: NORM ";
        if (value === "FAST") return " FADE SPD: FAST ";
    }
    if (label === "IGNITE") return value ? "  IGNITE: ON    " : "  IGNITE: OFF   ";
    if (label === "MARQUEE SPD") {
        const speedStr = value.toFixed(1) + "s";
        return `MARQUEE SPD:${speedStr.padStart(4, ' ')}`;
    }
    if (label === "VOLUME") {
        const volStr = String(value).padStart(3, '0') + "%";
        return `  VOLUME: ${volStr} `;
    }
    return " ".repeat(16);
}

function getCenteredTimerSetupString(mode, val) {
    const formattedStr = String(val).padStart(2, '0');
    if (mode === 1) return `   HOURS: ${formattedStr}    `;
    if (mode === 2) return `  MINUTES: ${formattedStr}   `;
    if (mode === 3) return `  SECONDS: ${formattedStr}   `;
    return " ".repeat(16);
}

function getCenteredAlarmSetupString(mode) {
    if (mode === 1) return `   SET HOURS    `;
    if (mode === 2) return `  SET MINUTES   `;
    if (mode === 3) return `  SET SECONDS   `; 
    if (mode === 4) return alarmEnabled ? "   ALARM: ON    " : "   ALARM: OFF   ";
    if (mode === 5) {
        const sndStr = String(settings.alarmSoundId).padStart(6, '0');
        
        // Page 1: Hundred Thousands, Tens of Thousands, Thousands [indices 0, 1, 2]
        if (alarmSoundEditDigitIdx <= 2) {
            let ht = alarmSoundEditDigitIdx === 0 ? `[${sndStr[0]}]` : ` ${sndStr[0]} `;
            let tt = alarmSoundEditDigitIdx === 1 ? `[${sndStr[1]}]` : ` ${sndStr[1]} `;
            let th = alarmSoundEditDigitIdx === 2 ? `[${sndStr[2]}]` : ` ${sndStr[2]} `;
            return `SND P1:${ht}${tt}${th}`;
        } 
        // Page 2: Hundreds, Tens, Ones [indices 3, 4, 5]
        else {
            let h = alarmSoundEditDigitIdx === 3 ? `[${sndStr[3]}]` : ` ${sndStr[3]} `;
            let t = alarmSoundEditDigitIdx === 4 ? `[${sndStr[4]}]` : ` ${sndStr[4]} `;
            let o = alarmSoundEditDigitIdx === 5 ? `[${sndStr[5]}]` : ` ${sndStr[5]} `;
            return `SND P2:${h}${t}${o}`;
        }
    }
    return " ".repeat(16);
}

// --- APPLY HARDWARE SETTINGS TO ENVIRONMENT VARIABLES ---
function applyHardwareSettingsToCSS() {
    const root = document.documentElement;
    
    if (settings.brightness === "HIGH") {
        root.style.setProperty('--nixie-brightness', '1');
        root.style.setProperty('--nixie-glow-intensity', '1');
    } else if (settings.brightness === "MED") {
        root.style.setProperty('--nixie-brightness', '0.65');
        root.style.setProperty('--nixie-glow-intensity', '0.6');
    } else if (settings.brightness === "LOW") {
        root.style.setProperty('--nixie-brightness', '0.35');
        root.style.setProperty('--nixie-glow-intensity', '0.25');
    }

    const separators = document.querySelectorAll('.separator');
    separators.forEach(sep => {
        sep.classList.remove('colon-blink', 'colon-hide');
        if (settings.colon === "BLINK") sep.classList.add('colon-blink');
        if (settings.colon === "OFF") sep.classList.add('colon-hide');
    });

    if (settings.fadeSpd === "SLOW") root.style.setProperty('--nixie-fade-duration', '0.28s');
    if (settings.fadeSpd === "NORM") root.style.setProperty('--nixie-fade-duration', '0.18s');
    if (settings.fadeSpd === "FAST") root.style.setProperty('--nixie-fade-duration', '0.08s');

    if (settings.ignite) {
        root.style.setProperty('--nixie-flash-color', '#ffaa66');
    } else {
        root.style.setProperty('--nixie-flash-color', '#ff5500');
    }
}

// --- REAL-TIME BATTERY HARDWARE MANAGER ---
function initBatteryMonitor() {
    const batteryDisplay = document.getElementById('batteryDisplay');
    const batteryTubes = document.querySelectorAll('.tube-battery');
    if (batteryTubes.length < 3) return;

    function updateBatteryStatus(battery) {
        const level = Math.round(battery.level * 100);
        isCharging = battery.charging || false;
        
        const levelString = String(level).padStart(3, ' ');

        setTubeTextWithFade(batteryTubes[0], formatDigit(levelString[0]));
        setTubeTextWithFade(batteryTubes[1], formatDigit(levelString[1]));
        setTubeTextWithFade(batteryTubes[2], formatDigit(levelString[2]));

        if (level <= settings.critFlash && !isCharging) {
            batteryDisplay.classList.add('battery-crit-flash');
        } else {
            batteryDisplay.classList.remove('battery-crit-flash');
        }
    }

    if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
            updateBatteryStatus(battery);
            battery.onlevelchange = () => updateBatteryStatus(battery);
            battery.onchargingchange = () => updateBatteryStatus(battery);
        });
    } else {
        const mockBattery = { level: 0.12, charging: false };
        updateBatteryStatus(mockBattery);
    }
}

// --- ENGINE ALARM WATCHDOG ---
function checkAlarmEngine(now) {
    if (!alarmEnabled || alarmAlertActive) return;
    if (appMode === 4 && subMenuMode !== 0) return;
    
    const currentHrs = now.getHours();
    const currentMins = now.getMinutes();
    const currentSecs = now.getSeconds();
    
    if (currentHrs === alarmTime.hours && 
        currentMins === alarmTime.minutes && 
        currentSecs === alarmTime.seconds) {
        if (!alarmDismissedForMinute) {
            triggerAlarmAlert();
        }
    } else {
        if (currentSecs !== alarmTime.seconds) {
            alarmDismissedForMinute = false; 
        }
    }
}

function triggerAlarmAlert() {
    alarmAlertActive = true;
    document.querySelectorAll('.tube').forEach(tube => {
        tube.classList.add('timer-expired-flash');
    });
    savePreferences();
    startAlarmAudioLoop();
}

function updateMainDisplay() {
    if (isShuffling) return;

    const h1 = document.getElementById('h1');
    const h2 = document.getElementById('h2');
    const m1 = document.getElementById('m1');
    const m2 = document.getElementById('m2');
    const s1 = document.getElementById('s1');
    const s2 = document.getElementById('s2');

    const now = new Date();
    checkAlarmEngine(now);

    if (appMode === 0) { 
        if (subMenuMode === 10) { // Volume option displays active % configuration across tubes
            const volStr = String(settings.volume).padStart(3, '0');
            setTubeTextWithFade(h1, ' ');
            setTubeTextWithFade(h2, ' ');
            setTubeTextWithFade(m1, ' ');
            setTubeTextWithFade(m2, formatDigit(volStr[0]));
            setTubeTextWithFade(s1, formatDigit(volStr[1]));
            setTubeTextWithFade(s2, formatDigit(volStr[2]));
        } else {
            const currentMin = now.getMinutes();
            if (lastMinute !== -1 && currentMin !== lastMinute) {
                lastMinute = currentMin;
                runSlotMachineEffect(updateMainDisplay);
                return;
            }
            lastMinute = currentMin;

            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(currentMin).padStart(2, '0');
            const seconds = String(now.getSeconds()).padStart(2, '0');

            setTubeTextWithFade(h1, formatDigit(hours[0]));
            setTubeTextWithFade(h2, formatDigit(hours[1]));
            setTubeTextWithFade(m1, formatDigit(minutes[0]));
            setTubeTextWithFade(m2, formatDigit(minutes[1]));
            setTubeTextWithFade(s1, formatDigit(seconds[0]));
            setTubeTextWithFade(s2, formatDigit(seconds[1]));
        }

    } else if (appMode === 1) { 
        let displayTotalSecs = timerDuration;
        if (!timerRunning && !timerAlertActive) {
            displayTotalSecs = (setupTimerVals.hours * 3600 + setupTimerVals.minutes * 60 + setupTimerVals.seconds);
        }
        
        const hrs = String(Math.floor(displayTotalSecs / 3600)).padStart(2, '0');
        const mins = String(Math.floor((displayTotalSecs % 3600) / 60)).padStart(2, '0');
        const secs = String(displayTotalSecs % 60).padStart(2, '0');

        setTubeTextWithFade(h1, formatDigit(hrs[0]));
        setTubeTextWithFade(h2, formatDigit(hrs[1]));
        setTubeTextWithFade(m1, formatDigit(mins[0]));
        setTubeTextWithFade(m2, formatDigit(mins[1]));
        setTubeTextWithFade(s1, formatDigit(secs[0]));
        setTubeTextWithFade(s2, formatDigit(secs[1]));

    } else if (appMode === 2) { 
        const totalSeconds = Math.floor(stopwatchTime / 20);
        const minsTotal = Math.floor(totalSeconds / 60);
        const secsTotal = totalSeconds % 60;
        
        const remainingMs = (stopwatchTime % 20) * 5; 

        const dispMins = String(minsTotal).padStart(2, '0');
        const dispSecs = String(secsTotal).padStart(2, '0');
        const dispDeci = String(remainingMs).padStart(2, '0');

        setTubeTextWithFade(h1, formatDigit(dispMins[0]));
        setTubeTextWithFade(h2, formatDigit(dispMins[1]));
        setTubeTextWithFade(m1, formatDigit(dispSecs[0]));
        setTubeTextWithFade(m2, formatDigit(dispSecs[1]));
        setTubeTextWithFade(s1, formatDigit(dispDeci[0]));
        setTubeTextWithFade(s2, formatDigit(dispDeci[1]));

    } else if (appMode === 3) { 
        const bpmString = String(metronomeBpm).padStart(3, '0');
        setTubeTextWithFade(h1, ' ');
        setTubeTextWithFade(h2, ' ');
        setTubeTextWithFade(m1, ' ');
        setTubeTextWithFade(m2, formatDigit(bpmString[0]));
        setTubeTextWithFade(s1, formatDigit(bpmString[1]));
        setTubeTextWithFade(s2, formatDigit(bpmString[2]));

    } else if (appMode === 4) {
        if (subMenuMode === 5) {
            // Displays all 6 digits on the clock panel while navigating pages
            const sndStr = String(settings.alarmSoundId).padStart(6, '0');
            setTubeTextWithFade(h1, formatDigit(sndStr[0]));
            setTubeTextWithFade(h2, formatDigit(sndStr[1]));
            setTubeTextWithFade(m1, formatDigit(sndStr[2]));
            setTubeTextWithFade(m2, formatDigit(sndStr[3]));
            setTubeTextWithFade(s1, formatDigit(sndStr[4]));
            setTubeTextWithFade(s2, formatDigit(sndStr[5]));
        } else {
            const alHrs = String(alarmTime.hours).padStart(2, '0');
            const alMins = String(alarmTime.minutes).padStart(2, '0');
            const alSecs = String(alarmTime.seconds).padStart(2, '0');
            
            setTubeTextWithFade(h1, formatDigit(alHrs[0]));
            setTubeTextWithFade(h2, formatDigit(alHrs[1]));
            setTubeTextWithFade(m1, formatDigit(alMins[0]));
            setTubeTextWithFade(m2, formatDigit(alMins[1]));
            setTubeTextWithFade(s1, formatDigit(alSecs[0]));
            setTubeTextWithFade(s2, formatDigit(alSecs[1]));
        }
    }
}

setInterval(updateMainDisplay, 50);

// --- MARQUEE RENDER PROCESSOR ---
const DISPLAY_SIZE = 16;
let marqueeScrollIndex = 0;
const miniTubes = document.querySelectorAll('.tube-mini');

function getClockMarqueeString() {
    const now = new Date();
    const dayName = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const monthName = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
    const dateNum = now.getDate();
    const year = now.getFullYear();
    const infoString = `${dayName}, ${monthName} ${dateNum}, ${year}`;
    const padding = ' '.repeat(DISPLAY_SIZE);
    return padding + infoString + padding;
}

function getTimerRunningString() {
    const hrs = String(Math.floor(timerDuration / 3600)).padStart(2, '0');
    const mins = String(Math.floor((timerDuration % 3600) / 60)).padStart(2, '0');
    const secs = String(timerDuration % 60).padStart(2, '0');
    return ` TIMER ${hrs}:${mins}:${secs} `;
}

function getStopwatchRunningString() {
    const totalSeconds = Math.floor(stopwatchTime / 20);
    const hrsTotal = String(Math.floor(totalSeconds / 3600)).padStart(2, '0');
    const minsTotal = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, '0');
    const secsTotal = String(totalSeconds % 60).padStart(2, '0');
    const remainingMs = String((stopwatchTime % 20) * 5).padStart(2, '0');
    return ` STW ${hrsTotal}:${minsTotal}:${secsTotal}.${remainingMs}`;
}

function updateMarquee() {
    let outString = " ".repeat(16);

    if (batterySubMenu) {
        const formattedVal = String(settings.critFlash).padStart(2, '0');
        outString = `CRIT FLASH:  ${formattedVal}%`;
    } else if (alarmAlertActive) {
        outString ="CLICK TO DISMISS";
    } else if (appMode === 0) { 
        if (subMenuMode !== 0) {
            outString = getCenteredMenuString(menuLabels[subMenuMode - 1], settings[menuKeys[subMenuMode - 1]]);
        } else {
            const isTimerActive = (timerRunning || timerAlertActive);
            const isStwActive = stopwatchRunning;

            if (isTimerActive || isStwActive) {
                if (activeSlideView === "TIMER" && !isTimerActive) {
                    activeSlideView = "STOPWATCH";
                    taskSlideStep = 0;
                } else if (activeSlideView === "STOPWATCH" && !isStwActive) {
                    activeSlideView = "TIMER";
                    taskSlideStep = 0;
                }

                let msg = "";
                if (activeSlideView === "TIMER") {
                    msg = timerAlertActive ? "    EXPIRED     " : getTimerRunningString();
                } else {
                    msg = getStopwatchRunningString();
                }
                
                const paddedMsg = " ".repeat(16) + msg + " ".repeat(16);

                if (taskSlideStep < 16) {
                    outString = paddedMsg.substr(taskSlideStep, 16);
                    taskSlideStep++;
                } else if (taskSlideStep === 16) {
                    outString = msg;
                    taskHoldCounter++;
                    
                    const holdTicksReq = 3.0 / settings.marqueeSpd;
                    if (taskHoldCounter >= holdTicksReq) {
                        if (isTimerActive && isStwActive) {
                            taskSlideStep++;
                        }
                        taskHoldCounter = 0; 
                    }
                } else if (taskSlideStep > 16 && taskSlideStep < 32) {
                    outString = paddedMsg.substr(taskSlideStep, 16);
                    taskSlideStep++;
                } else {
                    taskSlideStep = 0;
                    activeSlideView = (activeSlideView === "TIMER") ? "STOPWATCH" : "TIMER";
                    outString = " ".repeat(16);
                }

            } else {
                const fullText = getClockMarqueeString();
                outString = fullText.substr(marqueeScrollIndex, DISPLAY_SIZE);
                marqueeScrollIndex++;
                if (marqueeScrollIndex > fullText.length - DISPLAY_SIZE) marqueeScrollIndex = 0;
                taskSlideStep = 0;
                taskHoldCounter = 0;
            }
        }
    } else if (appMode === 1) { 
        if (subMenuMode !== 0) {
            const keys = ["hours", "minutes", "seconds"];
            outString = getCenteredTimerSetupString(subMenuMode, setupTimerVals[keys[subMenuMode - 1]]);
        } else {
            if (timerAlertActive) {
                outString = "    EXPIRED     ";
            } else if (timerRunning) {
                const expiryDate = new Date(timerExpiryTime);
                const expH = String(expiryDate.getHours()).padStart(2, '0');
                const expM = String(expiryDate.getMinutes()).padStart(2, '0');
                const expS = String(expiryDate.getSeconds()).padStart(2, '0');
                outString = `EXPIRES ${expH}:${expM}:${expS}`; 
            } else {
                outString = "  CLICK TO SET  ";
            }
        }
    } else if (appMode === 2) { 
        outString = stopwatchRunning ? "   RUNNING...   " : "STOPWATCH  READY";
    } else if (appMode === 3) { 
        if (subMenuMode === 1) {
            outString = metronomeAnimationOn ? "ANIMATION: ON   " : "ANIMATION: OFF  ";
        } else if (subMenuMode === 2) {
            const bpmStr = String(metronomeBpm).padStart(3, '0');
            let h = metroEditDigitIdx === 0 ? `[${bpmStr[0]}]` : ` ${bpmStr[0]} `;
            let t = metroEditDigitIdx === 1 ? `[${bpmStr[1]}]` : ` ${bpmStr[1]} `;
            let o = metroEditDigitIdx === 2 ? `[${bpmStr[2]}]` : ` ${bpmStr[2]} `;
            outString = `EDIT: ${h}${t}${o}`;
        } else {
            if (metronomeRunning && metronomeAnimationOn) {
                let pos = metronomeStep;
                if (pos > 8) pos = 16 - pos; 
                
                let track = Array(16).fill(' ');
                track[pos] = 'o';
                outString = track.join('');
            } else {
                outString = metronomeRunning ? "    TICKING     " : "METRONOME READY ";
            }
        }
    } else if (appMode === 4) {
        if (subMenuMode !== 0) {
            outString = getCenteredAlarmSetupString(subMenuMode);
        } else {
            outString = alarmEnabled ? "  ALARM IS  ON" : "  ALARM IS OFF";
        }
    }

    for (let i = 0; i < DISPLAY_SIZE; i++) {
        setTubeTextWithFade(miniTubes[i], formatDigit(outString[i] || ' '));
    }
}

function initializeMarqueeClock() {
    if (marqueeInterval) clearInterval(marqueeInterval);
    marqueeInterval = setInterval(updateMarquee, settings.marqueeSpd * 1000);
}

// --- METRONOME ENGINE ---
function startMetronomeEngine() {
    if (metronomeInterval) clearInterval(metronomeInterval);
    const stepDelay = (60 / metronomeBpm * 1000) / 8; 
    
    metronomeInterval = setInterval(() => {
        if (!metronomeRunning) return;
        metronomeStep = (metronomeStep + 1) % 16;
        updateMarquee();
    }, stepDelay);
}

// --- CLICK TRIGGERS HANDLERS ---
const mainClockPanel = document.getElementById('mainClockPanel');
const marqueePanel = document.getElementById('marqueePanel');
const batteryDisplay = document.getElementById('batteryDisplay');

function dismissAlertsIfActive() {
    let handled = false;
    if (timerAlertActive) {
        timerAlertActive = false;
        document.querySelectorAll('.tube').forEach(tube => tube.classList.remove('timer-expired-flash'));
        handled = true;
    }
    if (alarmAlertActive) {
        alarmAlertActive = false;
        alarmDismissedForMinute = true; 
        document.querySelectorAll('.tube').forEach(tube => tube.classList.remove('timer-expired-flash'));
        handled = true;
    }
    if (handled) {
        if (alarmAudioInterval) {
            clearInterval(alarmAudioInterval);
            alarmAudioInterval = null;
        }
        savePreferences();
        updateMainDisplay();
        updateMarquee();
    }
    return handled;
}

mainClockPanel.addEventListener('click', () => {
    if (dismissAlertsIfActive()) return;
    if (subMenuMode !== 0 || batterySubMenu) return;

    appMode = (appMode + 1) % 5; 
    marqueeScrollIndex = 0;
    taskSlideStep = 0;
    taskHoldCounter = 0; 
    
    if (appMode === 3) {
        startMetronomeEngine();
    } else {
        if (metronomeInterval) clearInterval(metronomeInterval);
        metronomeRunning = false;
    }
    
    savePreferences(); 
    updateMarquee();
    updateMainDisplay();
});

mainClockPanel.addEventListener('contextmenu', (e) => {
    if (dismissAlertsIfActive()) {
        e.preventDefault();
        return;
    }
    if (appMode === 2) {
        e.preventDefault(); 
        if (stopwatchRunning) {
            clearInterval(stopwatchInterval);
            stopwatchRunning = false;
        }
        stopwatchTime = 0;
        savePreferences();
        updateMainDisplay();
        updateMarquee();
    } else if (appMode === 3) {
        e.preventDefault();
        metronomeRunning = !metronomeRunning;
        if (metronomeRunning) startMetronomeEngine();
        updateMarquee();
    }
});

marqueePanel.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dismissAlertsIfActive()) return;
    if (batterySubMenu) return; 

    initAudioContext();

    if (appMode === 0) { 
        subMenuMode = (subMenuMode + 1) % 11; // Expanded to 11 options to handle volume loop selection
        if (subMenuMode === 0) {
            marqueeScrollIndex = 0;
            taskSlideStep = 0;
            taskHoldCounter = 0;
        }
    } else if (appMode === 1) { 
        if (timerRunning) {
            toggleTimer(); 
        } else {
            subMenuMode = (subMenuMode + 1) % 4;
            if (subMenuMode === 0) {
                if (setupTimerVals.hours || setupTimerVals.minutes || setupTimerVals.seconds) {
                    timerDuration = setupTimerVals.hours * 3600 + setupTimerVals.minutes * 60 + setupTimerVals.seconds;
                    toggleTimer();
                } else {
                    savePreferences();
                }
            }
        }
    } else if (appMode === 2) { 
        toggleStopwatch();
    } else if (appMode === 3) { 
        subMenuMode = (subMenuMode + 1) % 3;
        if (subMenuMode === 0) startMetronomeEngine();
    } else if (appMode === 4) {
        subMenuMode = (subMenuMode + 1) % 6;
        if (subMenuMode === 5) {
            alarmSoundEditDigitIdx = 5; // Default focus to Ones digit when sound sub-menu opens
        }
        savePreferences();
    }
    updateMarquee();
    updateMainDisplay();
});

batteryDisplay.addEventListener('click', (e) => {
    e.stopPropagation();
    if (dismissAlertsIfActive()) return;

    subMenuMode = 0;
    batterySubMenu = !batterySubMenu;
    if (!batterySubMenu) {
        marqueeScrollIndex = 0;
        taskSlideStep = 0;
        taskHoldCounter = 0;
        
        if (navigator.getBattery) {
            navigator.getBattery().then(b => {
                isCharging = b.charging;
                const level = Math.round(b.level * 100);
                if (level <= settings.critFlash && !isCharging) {
                    batteryDisplay.classList.add('battery-crit-flash');
                } else {
                    batteryDisplay.classList.remove('battery-crit-flash');
                }
            });
        }
    }
    updateMarquee();
    updateMainDisplay();
});

function triggerTimerAlert() {
    if (timerInterval) clearInterval(timerInterval);
    timerRunning = false;
    timerDuration = 0;
    timerAlertActive = true;
    
    document.querySelectorAll('.tube').forEach(tube => {
        tube.classList.add('timer-expired-flash');
    });
    
    savePreferences();
    updateMainDisplay();
    updateMarquee();
    startAlarmAudioLoop();
}

function startTimerInterval() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        const remaining = Math.ceil((timerExpiryTime - Date.now()) / 1000);
        if (remaining > 0) {
            timerDuration = remaining;
            updateMainDisplay();
        } else {
            triggerTimerAlert();
        }
    }, 100); 
}

function toggleTimer() {
    if (timerRunning) {
        clearInterval(timerInterval);
        timerRunning = false;
        savePreferences();
    } else {
        timerRunning = true;
        timerExpiryTime = Date.now() + (timerDuration * 1000);
        startTimerInterval();
        savePreferences();
    }
}

function startStopwatchInterval() {
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    stopwatchInterval = setInterval(() => {
        const elapsedMs = Date.now() - stopwatchStartTime;
        stopwatchTime = Math.floor(elapsedMs / 50);
        updateMainDisplay();
    }, 50);
}

function toggleStopwatch() {
    if (stopwatchRunning) {
        clearInterval(stopwatchInterval);
        stopwatchRunning = false;
        savePreferences();
    } else {
        stopwatchRunning = true;
        stopwatchStartTime = Date.now() - (stopwatchTime * 50);
        startStopwatchInterval();
        savePreferences();
    }
}

function modifySettingValue(direction) {
    if (timerAlertActive || alarmAlertActive) return; 

    if (batterySubMenu) {
        if (direction === "up") {
            if (settings.critFlash < 99) settings.critFlash++;
        } else {
            if (settings.critFlash > 1) settings.critFlash--;
        }
        savePreferences();
    } else if (appMode === 0) { 
        const key = menuKeys[subMenuMode - 1];
        if (key === "volume") { // Handle incremental shifts from 0% to 100%
            if (direction === "up") {
                if (settings.volume < 125) settings.volume += 1;
            } else {
                if (settings.volume > 0) settings.volume -= 1;
            }
            // Trigger quick real-time tone click burst to preview volume profile changes
            playProceduralSound(settings.alarmSoundId || 1, true);
        } else if (key === "marqueeSpd") {
            if (direction === "up") {
                if (settings.marqueeSpd < 9.9) settings.marqueeSpd = parseFloat((settings.marqueeSpd + 0.1).toFixed(1));
            } else {
                if (settings.marqueeSpd > 0.1) settings.marqueeSpd = parseFloat((settings.marqueeSpd - 0.1).toFixed(1));
            }
            initializeMarqueeClock(); 
        } else if (multiOptions[key]) {
            const options = multiOptions[key];
            let idx = options.indexOf(settings[key]);
            if (direction === "up") {
                idx = (idx + 1) % options.length;
            } else {
                idx = (idx - 1 + options.length) % options.length;
            }
            settings[key] = options[idx];
        } else {
            settings[key] = !settings[key];
            if (key === 'mouse' && settings.mouse) document.body.classList.remove('hide-cursor');
        }
        applyHardwareSettingsToCSS();
        savePreferences(); 

    } else if (appMode === 1) { 
        const keys = ["hours", "minutes", "seconds"];
        const key = keys[subMenuMode - 1];
        const maxLimit = key === "hours" ? 99 : 59;

        if (direction === "up" && setupTimerVals[key] < maxLimit) {
            setupTimerVals[key]++;
        } else if (direction === "down" && setupTimerVals[key] > 0) {
            setupTimerVals[key]--;
        }
    } else if (appMode === 3) {
        if (subMenuMode === 1) {
            if (direction === "up" || direction === "down") metronomeAnimationOn = !metronomeAnimationOn;
        } else if (subMenuMode === 2) {
            let bpmStr = String(metronomeBpm).padStart(3, '0').split('');
            let currentDigitVal = parseInt(bpmStr[metroEditDigitIdx]);
            if (direction === "up") {
                currentDigitVal = (currentDigitVal + 1) % 10;
            } else if (direction === "down") {
                currentDigitVal = (currentDigitVal - 1 + 10) % 10;
            }
            bpmStr[metroEditDigitIdx] = currentDigitVal;
            let finalBpm = parseInt(bpmStr.join(''));
            if (finalBpm > 999) finalBpm = 999;
            if (finalBpm < 1) finalBpm = 1;
            metronomeBpm = finalBpm;
        }
    } else if (appMode === 4) {
        if (subMenuMode === 1) { 
            if (direction === "up") alarmTime.hours = (alarmTime.hours + 1) % 24;
            else alarmTime.hours = (alarmTime.hours - 1 + 24) % 24;
        } else if (subMenuMode === 2) { 
            if (direction === "up") alarmTime.minutes = (alarmTime.minutes + 1) % 60;
            else alarmTime.minutes = (alarmTime.minutes - 1 + 60) % 60;
        } else if (subMenuMode === 3) { 
            if (direction === "up") alarmTime.seconds = (alarmTime.seconds + 1) % 60;
            else alarmTime.seconds = (alarmTime.seconds - 1 + 60) % 60;
        } else if (subMenuMode === 4) { 
            alarmEnabled = !alarmEnabled;
        } else if (subMenuMode === 5) { 
            let sndStr = String(settings.alarmSoundId).padStart(6, '0').split('');
            let currentDigitVal = parseInt(sndStr[alarmSoundEditDigitIdx]);
            if (direction === "up") {
                currentDigitVal = (currentDigitVal + 1) % 10;
            } else if (direction === "down") {
                currentDigitVal = (currentDigitVal - 1 + 10) % 10;
            }
            sndStr[alarmSoundEditDigitIdx] = currentDigitVal;
            let finalSoundId = parseInt(sndStr.join(''));
            if (finalSoundId > 999999) finalSoundId = 999999;
            if (finalSoundId < 0) finalSoundId = 0;
            settings.alarmSoundId = finalSoundId;

            playProceduralSound(settings.alarmSoundId, true);
        }
        savePreferences();
    }
    updateMarquee();
    updateMainDisplay();
}

window.addEventListener('keydown', (e) => {
    if (subMenuMode === 0 && !batterySubMenu) return; 
    
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault(); 
        if (activeKey === e.key) return;
        activeKey = e.key;

        if (appMode === 3 && subMenuMode === 2 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            if (e.key === "ArrowLeft") {
                metroEditDigitIdx = metroEditDigitIdx === 0 ? 2 : metroEditDigitIdx - 1;
            } else {
                metroEditDigitIdx = metroEditDigitIdx === 2 ? 0 : metroEditDigitIdx + 1;
            }
            updateMarquee();
            return;
        }

        if (appMode === 4 && subMenuMode === 5 && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
            if (e.key === "ArrowLeft") {
                // If moving left from 4th digit (index 3), jump back to 3rd digit (index 2) on Page 1
                if (alarmSoundEditDigitIdx === 3) {
                    alarmSoundEditDigitIdx = 2;
                } else {
                    alarmSoundEditDigitIdx = alarmSoundEditDigitIdx === 0 ? 5 : alarmSoundEditDigitIdx - 1;
                }
            } else {
                // If moving right from 3rd digit (index 2), jump over to 4th digit (index 3) on Page 2
                if (alarmSoundEditDigitIdx === 2) {
                    alarmSoundEditDigitIdx = 3;
                } else {
                    alarmSoundEditDigitIdx = alarmSoundEditDigitIdx === 5 ? 0 : alarmSoundEditDigitIdx + 1;
                }
            }
            updateMarquee();
            updateMainDisplay();
            return;
        }

        const dir = (e.key === "ArrowUp" || e.key === "ArrowRight") ? "up" : "down";
        modifySettingValue(dir);

        clearTimeout(keyHoldTimeout);
        clearInterval(keyRepeatInterval);

        keyHoldTimeout = setTimeout(() => {
            keyRepeatInterval = setInterval(() => {
                modifySettingValue(dir);
            }, 70);
        }, 400); 
    }
});

window.addEventListener('keyup', (e) => {
    if (e.key === activeKey) {
        clearTimeout(keyHoldTimeout);
        clearInterval(keyRepeatInterval);
        activeKey = null;
    }
});

// --- MOUSE SCROLL CONTROLS ---
let scrollCooldown = false;

window.addEventListener('wheel', (e) => {
    // Only allow scroll adjustments when inside a menu
    if (subMenuMode === 0 && !batterySubMenu) return;

    // Prevent rapid-fire scrolling from skipping values too fast
    if (scrollCooldown) return;
    scrollCooldown = true;
    setTimeout(() => { scrollCooldown = false; }, 10); // 150ms delay

    // deltaY < 0 means scrolling up, > 0 means scrolling down
    const dir = e.deltaY < 0 ? "up" : "down";
    modifySettingValue(dir);
});

// --- RIGHT-CLICK (CONTEXT MENU) CONTROLS ---
window.addEventListener('contextmenu', (e) => {
    // If we are in a sub-menu or battery menu, override the default browser right-click
    if (subMenuMode !== 0 || batterySubMenu) {
        e.preventDefault(); 

        // 1. Handle Metronome Digit Movement
        if (appMode === 3 && subMenuMode === 2) {
            metroEditDigitIdx = metroEditDigitIdx === 2 ? 0 : metroEditDigitIdx + 1;
            updateMarquee();
            return;
        }

        // 2. Handle Alarm Sound Digit Movement
        if (appMode === 4 && subMenuMode === 5) {
            // If at the end of page 2 (index 5), loop back to the start of page 1 (index 0)
            alarmSoundEditDigitIdx = alarmSoundEditDigitIdx === 5 ? 0 : alarmSoundEditDigitIdx + 1;
            updateMarquee();
            updateMainDisplay();
            return;
        }

        // 3. If not moving a digit, right-click will advance the setting menu globally
        if (appMode === 0) {
            subMenuMode = (subMenuMode + 1) % 11;
        } else if (appMode === 1 && !timerRunning) {
            subMenuMode = (subMenuMode + 1) % 4;
        } else if (appMode === 3) {
            subMenuMode = (subMenuMode + 1) % 3;
        } else if (appMode === 4) {
            subMenuMode = (subMenuMode + 1) % 6;
            if (subMenuMode === 5) alarmSoundEditDigitIdx = 5; // Default focus to Ones digit
        }
        
        savePreferences();
        updateMarquee();
        updateMainDisplay();
    }
});

let mouseMoveTimeout;
window.addEventListener('mousemove', () => {
    document.body.classList.remove('hide-cursor');
    clearTimeout(mouseMoveTimeout);
    if (!settings.mouse) {
        mouseMoveTimeout = setTimeout(() => {
            document.body.classList.add('hide-cursor');
        }, 500);
    }
});

// --- SLOT MACHINE EFFECT ENGINE ---
function runSlotMachineEffect(callback) {
    if (!settings.slotMachine) {
        callback();
        return;
    }
    isShuffling = true;
    const duration = 600;
    const spinIntervalTime = 50;
    const startTime = Date.now();
    const clockTubes = [
        document.getElementById('h1'), document.getElementById('h2'),
        document.getElementById('m1'), document.getElementById('m2'),
        document.getElementById('s1'), document.getElementById('s2')
    ];

    const shuffleInterval = setInterval(() => {
        clockTubes.forEach(tube => {
            tube.textContent = formatDigit(String(Math.floor(Math.random() * 10)));
        });
        if (Date.now() - startTime >= duration) {
            clearInterval(shuffleInterval);
            isShuffling = false;
            callback();
        }
    }, spinIntervalTime);
}

function triggerRandomFlicker() {
    if (!settings.flicker) {
        document.querySelectorAll('.flicker-active').forEach(t => t.classList.remove('flicker-active'));
        setTimeout(triggerRandomFlicker, 1000);
        return;
    }
    const allTubes = document.querySelectorAll('.tube, .tube-mini, .tube-battery');
    const targetTube = allTubes[Math.floor(Math.random() * allTubes.length)];
    const flickerDuration = Math.floor(Math.random() * 400) + 100;
    
    if (!targetTube.classList.contains('flicker-active') && !isShuffling) {
        targetTube.classList.add('flicker-active');
        setTimeout(() => { targetTube.classList.remove('flicker-active'); }, flickerDuration);
    }
    setTimeout(triggerRandomFlicker, Math.floor(Math.random() * 1200) + 300);
}

// Shortcut to redirect to the instruction manual (Alt + M)
window.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        // Redirects from nixie-tube/__src/ to nixie-tube/_manual/_src/manual.html
        window.location.href = '../_manual/_src/manual.html';
    }
});

loadPreferences(); 
applyHardwareSettingsToCSS();
initBatteryMonitor();
triggerRandomFlicker();
initializeMarqueeClock();

// --- TOUCH SCREEN GESTURE CONTROLS ---
let touchStartX = 0;
let touchStartY = 0;
let touchHoldTimer = null;
let isTouchSwiping = false;

window.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    isTouchSwiping = false;

    // Start long-press detection (Translates to Right-Click)
    touchHoldTimer = setTimeout(() => {
        if (!isTouchSwiping) {
            // Check if the user is long-pressing the main clock or the background
            const target = document.elementFromPoint(touchStartX, touchStartY);
            
            if (target && target.closest('#mainClockPanel')) {
                // Triggers your stopwatch reset/metronome toggle
                document.getElementById('mainClockPanel').dispatchEvent(
                    new Event('contextmenu', { bubbles: true, cancelable: true })
                );
            } else {
                // Triggers your sub-menu backing out
                window.dispatchEvent(
                    new Event('contextmenu', { bubbles: true, cancelable: true })
                );
            }
        }
    }, 550); // 550 milliseconds hold time to trigger
}, { passive: true });

window.addEventListener('touchmove', (e) => {
    const moveX = e.touches[0].clientX;
    const moveY = e.touches[0].clientY;
    
    // If the finger moves more than 15 pixels, it's a swipe (cancel the long press)
    if (Math.abs(moveX - touchStartX) > 15 || Math.abs(moveY - touchStartY) > 15) {
        isTouchSwiping = true;
        clearTimeout(touchHoldTimer);
    }
}, { passive: true });

window.addEventListener('touchend', (e) => {
    // Finger left the screen, cancel the long-press timer immediately
    clearTimeout(touchHoldTimer);

    // If it was just a normal tap, stop here (your existing click listeners will handle it)
    if (!isTouchSwiping) return; 

    // We only want swipes to work if a menu is open
    if (subMenuMode === 0 && !batterySubMenu) return;

    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;

    const deltaX = touchEndX - touchStartX;
    const deltaY = touchEndY - touchStartY;

    // Determine if the swipe was mostly Horizontal or Vertical
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) {
        
        // HORIZONTAL SWIPE (Translates to Left/Right arrow keys for editing digits)
        if (appMode === 3 && subMenuMode === 2) {
            if (deltaX < 0) {
                metroEditDigitIdx = metroEditDigitIdx === 0 ? 2 : metroEditDigitIdx - 1;
            } else {
                metroEditDigitIdx = metroEditDigitIdx === 2 ? 0 : metroEditDigitIdx + 1;
            }
            updateMarquee();
        } else if (appMode === 4 && subMenuMode === 5) {
            if (deltaX < 0) {
                if (alarmSoundEditDigitIdx === 3) alarmSoundEditDigitIdx = 2;
                else alarmSoundEditDigitIdx = alarmSoundEditDigitIdx === 0 ? 5 : alarmSoundEditDigitIdx - 1;
            } else {
                if (alarmSoundEditDigitIdx === 2) alarmSoundEditDigitIdx = 3;
                else alarmSoundEditDigitIdx = alarmSoundEditDigitIdx === 5 ? 0 : alarmSoundEditDigitIdx + 1;
            }
            updateMarquee();
            updateMainDisplay();
        }

    } else if (Math.abs(deltaY) > 40) {
        
        // VERTICAL SWIPE (Translates to Scroll Wheel / Up & Down arrows)
        const swipeDirection = deltaY < 0 ? "up" : "down";
        modifySettingValue(swipeDirection);
        
    }
});
