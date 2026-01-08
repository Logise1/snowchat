import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, getDocs, updateDoc, increment, query, where, orderBy, limit, serverTimestamp, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

// --- CONFIGURATION ---
const firebaseConfig = {
    apiKey: "AIzaSyBoeLbeo4gA9O-S0-Ew97rZKJM-5r2Z0gg",
    authDomain: "geoplace-5cbe7.firebaseapp.com",
    projectId: "geoplace-5cbe7",
    storageBucket: "geoplace-5cbe7.firebasestorage.app",
    messagingSenderId: "44977585672",
    appId: "1:44977585672:web:96f12bb47d72e0c0ccdbbd"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- STATE MANAGEMENT ---
// --- STATE MANAGEMENT ---
// --- STATE MANAGEMENT --- (partial view for context)
// Ensure state.creator has recording flag
const state = {
    user: null, // ...
    userData: null,
    gps: { lat: 0, lng: 0, alt: 0, speed: 0, acc: 0, heading: 0 },
    gpsWatchId: null,
    tracks: [],
    activeTrack: null,
    detailMap: null,
    detailProximityInterval: null,
    creator: { map: null, points: [], markers: [], polyline: null, active: false, recording: false },
    run: { active: false, track: null, startTime: 0, nextIdx: 0, timer: null, map: null },
    voice: { active: false, recognition: null, speaking: false },
    voiceChat: { localStream: null, connections: {}, active: false, unsubSignaling: null }
};

// ...


// ...

// --- CREATOR RECORDING LOGIC ---
// --- CREATOR RECORDING LOGIC ---
window.addCurrentGPSPoint = () => {
    const btn = document.getElementById('btn-record-track');

    if (!state.gps.lat) return alert("Esperando señal GPS...");

    // Visual Feedback
    btn.classList.remove('border-slate-300', 'text-slate-400');
    btn.classList.add('border-blue-500', 'text-blue-600', 'bg-blue-50');
    setTimeout(() => {
        btn.classList.add('border-slate-300', 'text-slate-400');
        btn.classList.remove('border-blue-500', 'text-blue-600', 'bg-blue-50');
    }, 300);

    // Add Point
    addCreatorPoint(state.gps);

    // Center map
    state.creator.map.setView([state.gps.lat, state.gps.lng]);
};

// ... existing addCreatorPoint ...

// --- AUTHENTICATION ---
window.handleAuth = async (type) => {
    const uInput = document.getElementById('auth-user');
    const pInput = document.getElementById('auth-pass');
    const err = document.getElementById('auth-error');

    const u = uInput.value.trim();
    const p = pInput.value;

    // Reset error
    err.innerText = "";
    err.classList.add('opacity-0');

    if (!u || !p) {
        showError("Por favor, completa todos los campos.");
        return;
    }

    const email = `${u.replace(/\s/g, '').toLowerCase()}@snow.app`;

    const btn = type === 'login' ? document.getElementById('btn-login') : document.getElementById('btn-register');
    const originalText = btn ? btn.innerText : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
    }

    try {
        if (type === 'login') {
            await signInWithEmailAndPassword(auth, email, p);
        } else {
            const cred = await createUserWithEmailAndPassword(auth, email, p);
            await setDoc(doc(db, "users", cred.user.uid), {
                username: u,
                xp: 0,
                totalDist: 0,
                totalDrop: 0,
                level: 1,
                joinedAt: serverTimestamp()
            });
        }
    } catch (e) {
        console.error(e);
        let msg = "Error de acceso.";
        if (e.code === 'auth/wrong-password') msg = "Contraseña incorrecta.";
        if (e.code === 'auth/user-not-found') msg = "Usuario no encontrado.";
        if (e.code === 'auth/email-already-in-use') msg = "El usuario ya existe.";
        if (e.code === 'auth/weak-password') msg = "La contraseña es muy débil.";
        showError(msg);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = originalText;
        }
    }
};

function showError(msg) {
    const err = document.getElementById('auth-error');
    err.innerText = msg;
    err.classList.remove('opacity-0');
}

window.logout = () => signOut(auth);

onAuthStateChanged(auth, async (u) => {
    const loader = document.getElementById('loader');

    if (u) {
        state.user = u;
        await loadProfile();

        // Transition
        document.getElementById('view-auth').classList.add('hidden');
        document.getElementById('app-layout').classList.remove('hidden');

        // Hide loader after loading profile
        loader.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => loader.classList.add('hidden'), 500);

        startGPS();
        refreshTracks();
        initVoiceControl();

        // Fullscreen attempt
        try {
            if (document.documentElement.requestFullscreen) {
                document.documentElement.requestFullscreen();
            }
        } catch (e) { console.log("Fullscreen blocked needs interaction"); }
    } else {
        // Show Login
        document.getElementById('view-auth').classList.remove('hidden');
        document.getElementById('app-layout').classList.add('hidden');
        loader.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => loader.classList.add('hidden'), 500);
    }
});

async function loadProfile() {
    if (!state.user) return;
    const s = await getDoc(doc(db, "users", state.user.uid));
    if (s.exists()) {
        state.userData = s.data();
        document.getElementById('home-username').innerText = state.userData.username;
        document.getElementById('home-lvl').innerText = state.userData.level || 1;
    }
}

// --- GPS SYSTEM ---
function startGPS() {
    if (navigator.geolocation) {
        let lastPos = null;
        let lastTime = 0;
        const alpha = 0.2; // Smoothing factor

        state.gpsWatchId = navigator.geolocation.watchPosition(pos => {
            const now = Date.now();
            let speed = pos.coords.speed; // m/s

            if (lastPos) {
                const d = getDist(lastPos, { lat: pos.coords.latitude, lng: pos.coords.longitude }); // meters
                const t = (now - lastTime) / 1000; // seconds

                if (t > 0) {
                    const manualSpeed = d / t;
                    if (speed === null || speed < 0.5) {
                        speed = manualSpeed;
                    } else {
                        speed = (speed * 0.4) + (manualSpeed * 0.6);
                    }
                }
            }

            const currentSpeed = state.gps.speed || 0;
            let newSpeed = speed || 0;
            newSpeed = (currentSpeed * (1 - alpha)) + (newSpeed * alpha);

            state.gps = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                alt: pos.coords.altitude || 0,
                speed: newSpeed, // smoothed
                acc: pos.coords.accuracy,
                heading: pos.coords.heading || 0
            };

            lastPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            lastTime = now;

            if (state.run.active) updateRunLoop();
        }, (err) => {
            console.error("GPS Error", err);
        }, {
            enableHighAccuracy: true,
            maximumAge: 0,
            timeout: 10000
        });
    }
}

// --- SYSTEM & WAKE LOCK ---
let wakeLock = null;
async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}
document.addEventListener('visibilitychange', async () => {
    if (wakeLock !== null && document.visibilityState === 'visible') {
        await requestWakeLock();
    }
});

// Prevent Exit
window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = '';
    return "Seguro que quieres salir?";
});

history.pushState(null, document.title, location.href);
window.addEventListener('popstate', (event) => {
    history.pushState(null, document.title, location.href);
});

// --- VOICE CONTROL SYSTEM ---
function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.log("Speech recognition not supported");
        return;
    }

    requestWakeLock();

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.voice.recognition = new SpeechRecognition();
    state.voice.recognition.continuous = true;
    state.voice.recognition.interimResults = false;
    state.voice.recognition.lang = 'es-ES';

    state.voice.recognition.onstart = () => {
        state.voice.active = true;
        updateVoiceUI(true);
    };

    state.voice.recognition.onend = () => {
        state.voice.active = false;
        updateVoiceUI(false);
        // Auto restart if in run mode
        if (state.run.active) state.voice.recognition.start();
    };

    state.voice.recognition.onresult = (event) => {
        const last = event.results.length - 1;
        const command = event.results[last][0].transcript.trim().toLowerCase();
        console.log("Voice Command:", command);
        processVoiceCommand(command);
    };
}

window.toggleVoice = () => {
    if (!state.voice.recognition) return alert("Tu navegador no soporta control por voz");

    if (state.voice.active) {
        state.voice.recognition.stop();
    } else {
        try { state.voice.recognition.start(); } catch (e) { }
    }
};

function updateVoiceUI(active) {
    const waves = document.getElementById('voice-waves');
    const txt = document.getElementById('voice-text');
    const btn = document.getElementById('btn-voice-toggle');

    if (!waves || !txt || !btn) return;

    if (active) {
        waves.classList.remove('hidden');
        txt.innerText = "SISTEMA DE VOZ ACTIVO";
        txt.classList.add('text-green-400');
        btn.classList.add('bg-white', 'text-blue-900');
        btn.classList.remove('bg-white/5', 'text-slate-400');
    } else {
        waves.classList.add('hidden');
        txt.innerText = "Dí 'Estado', 'Velocidad' o 'Personas'";
        txt.classList.remove('text-green-400');
        btn.classList.remove('bg-white', 'text-blue-900');
        btn.classList.add('bg-white/5', 'text-slate-400');
    }
}

function processVoiceCommand(cmd) {
    // Feedback text update
    const txt = document.getElementById('voice-text');
    if (txt) {
        txt.innerText = `Comando: "${cmd}"`;
        txt.classList.add('text-yellow-400');
        setTimeout(() => {
            if (state.voice.active) {
                txt.innerText = "SISTEMA DE VOZ ACTIVO";
                txt.classList.remove('text-yellow-400');
                txt.classList.add('text-green-400');
            }
        }, 3000);
    }

    // Removed 'Parar' command as requested

    if (cmd.includes('velocidad') || cmd.includes('rápido')) {
        const spd = Math.round(state.gps.speed * 3.6);
        speak(`Vas a ${spd} kilómetros por hora`);
    }
    else if (cmd.includes('estado') || cmd.includes('status') || cmd.includes('cómo voy')) {
        speakStatus();
    }
    else if (cmd.includes('hora') || cmd.includes('tiempo')) {
        const time = document.getElementById('hud-time').innerText;
        speak(`El tiempo es ${time}`);
    }
    else if (cmd.includes('personas') || cmd.includes('gente') || cmd.includes('quién hay') || cmd.includes('online')) {
        speakPeople();
    }
}

function speakPeople() {
    if (!state.voiceChat.active) return speak("El chat de voz está desconectado.");

    const rows = document.querySelectorAll('.voice-user-row span');
    if (rows.length === 0) return speak("No hay nadie más conectado.");

    let names = [];
    rows.forEach(r => names.push(r.innerText.replace(" (Tú)", "")));
    const uniqueNames = [...new Set(names)];

    if (uniqueNames.length === 1 && uniqueNames[0] === state.userData.username) {
        speak("Solo estás tú en el canal.");
    } else {
        speak(`En el chat están: ${uniqueNames.join(', ')}`);
    }
}

function speak(text) {
    if (!window.speechSynthesis) return;
    state.voice.speaking = true;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = 1.1;
    u.onend = () => state.voice.speaking = false;
    window.speechSynthesis.speak(u);
}

function speakStatus() {
    if (!state.run.active) return speak("No estás en carrera");
    const spd = Math.round(state.gps.speed * 3.6);
    const dist = document.getElementById('hud-dist').innerText;
    speak(`Velocidad ${spd} kilómetros por hora. Distancia al objetivo ${dist} metros.`);
}

// --- TRACKS FEED ---
window.refreshTracks = async () => {
    const feed = document.getElementById('track-feed');
    feed.innerHTML = `
        <div class="flex flex-col gap-3">
            <div class="h-20 rounded-2xl shimmer"></div>
            <div class="h-20 rounded-2xl shimmer"></div>
            <div class="h-20 rounded-2xl shimmer"></div>
        </div>`;

    try {
        const q = query(collection(db, "tracks"), orderBy("createdAt", "desc"), limit(20));
        const snap = await getDocs(q);
        state.tracks = [];

        feed.innerHTML = '';
        if (snap.empty) {
            feed.innerHTML = `
                <div class="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-6 text-center">
                    <p class="text-slate-500 font-medium mb-2">No hay pistas cerca</p>
                    <button onclick="openCreator()" class="text-blue-600 font-bold text-sm">¡Sé el primero en crear una!</button>
                </div>`;
            return;
        }

        snap.forEach(d => {
            const t = d.data();
            t.id = d.id;
            state.tracks.push(t);

            const card = document.createElement('div');
            card.className = "bg-white p-4 rounded-2xl flex items-center justify-between border border-slate-100 shadow-sm hover:shadow-md active:scale-98 transition-all cursor-pointer group";
            card.onclick = () => openTrackDetail(t);
            card.innerHTML = `
                <div class="flex items-center gap-4">
                    <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xl shadow-inner">
                        ${t.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <h4 class="font-bold text-slate-900 leading-tight group-hover:text-blue-600 transition-colors">${t.name}</h4>
                        <div class="flex items-center gap-2 text-[10px] text-slate-400 uppercase font-bold tracking-wide mt-1">
                            <span class="bg-slate-100 px-1.5 py-0.5 rounded text-slate-500">${t.dist.toFixed(2)} km</span>
                            <span>•</span>
                            <span>${t.creator}</span>
                        </div>
                    </div>
                </div>
                <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition-all">
                    <i class="fa-solid fa-chevron-right text-xs"></i>
                </div>
            `;
            feed.appendChild(card);
        });
    } catch (e) {
        console.error(e);
        feed.innerHTML = '<div class="text-red-500 text-center text-sm font-bold">Error al cargar pistas</div>';
    }
};

// --- TRACK DETAIL ---
window.openTrackDetail = async (track) => {
    state.activeTrack = track;
    const modal = document.getElementById('modal-detail');
    modal.classList.remove('hidden');

    // Reset/Populate Info
    document.getElementById('detail-title').innerText = track.name;
    document.getElementById('detail-author').innerText = `CREADO POR ${track.creator.toUpperCase()}`;
    document.getElementById('detail-dist').innerText = track.dist.toFixed(2) + "km";
    document.getElementById('detail-drop').innerText = (track.drop || 0) + "m";
    document.getElementById('detail-cps').innerText = track.points.length;

    // Initialize Map
    setTimeout(() => {
        if (state.detailMap) {
            state.detailMap.remove();
        }

        const startPt = track.points[0];
        // Create map container
        const mapEl = document.getElementById('detail-map');

        state.detailMap = L.map('detail-map', {
            zoomControl: false,
            dragging: false,
            touchZoom: false,
            doubleClickZoom: false,
            scrollWheelZoom: false,
            attributionControl: false
        }).setView([startPt.lat, startPt.lng], 14);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            maxZoom: 19
        }).addTo(state.detailMap);

        const path = track.points.map(p => [p.lat, p.lng]);

        // Track Polyline
        L.polyline(path, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.8,
            lineCap: 'round'
        }).addTo(state.detailMap);

        // Start Marker
        L.circleMarker([startPt.lat, startPt.lng], {
            radius: 6,
            color: '#fff',
            weight: 3,
            fillColor: '#2563eb',
            fillOpacity: 1
        }).addTo(state.detailMap);

        // End Marker
        const endPt = track.points[track.points.length - 1];
        L.circleMarker([endPt.lat, endPt.lng], {
            radius: 6,
            color: '#fff',
            weight: 3,
            fillColor: '#7c3aed',
            fillOpacity: 1
        }).addTo(state.detailMap);

        // Fit bounds
        state.detailMap.fitBounds(L.polyline(path).getBounds(), {
            padding: [40, 40],
            animate: false
        });
    }, 100);

    // Load Leaderboard
    loadTrackLeaderboard(track.id);

    // Start Proximity Check
    checkStartProximity();
    state.detailProximityInterval = setInterval(checkStartProximity, 1000);
};

window.closeDetail = () => {
    document.getElementById('modal-detail').classList.add('hidden');
    state.activeTrack = null;
    if (state.detailProximityInterval) clearInterval(state.detailProximityInterval);
};

// --- LEADERBOARDS ---
async function loadTrackLeaderboard(trackId) {
    const list = document.getElementById('detail-leaderboard');
    list.innerHTML = `
        <div class="flex justify-center py-4">
            <div class="loader-ring w-6 h-6 border-slate-200 border-t-blue-500"></div>
        </div>`;

    let totalSecs = 0;
    let count = 0;

    const q = query(collection(db, "results"), where("trackId", "==", trackId), limit(50)); // Increased limit slightly

    try {
        const snap = await getDocs(q);
        list.innerHTML = '';

        if (snap.empty) {
            list.innerHTML = '<div class="text-center text-slate-400 text-xs py-4 font-medium italic">Sé el primero en definir el récord.</div>';
            document.getElementById('detail-avg').innerText = "--:--";
            return;
        }

        let results = [];
        snap.forEach(d => {
            const r = d.data();
            results.push(r);
            const parts = r.time.split(':');
            totalSecs += parseInt(parts[0]) * 60 + parseInt(parts[1]);
            count++;
        });

        // Calculate Avg
        const avgSec = Math.floor(totalSecs / count);
        const avgM = Math.floor(avgSec / 60);
        const avgS = avgSec % 60;
        document.getElementById('detail-avg').innerText = `${avgM}:${avgS.toString().padStart(2, '0')}`;

        // Sort by time
        results.sort((a, b) => {
            // Basic time parsing "MM:SS"
            const tA = parseTime(a.time);
            const tB = parseTime(b.time);
            return tA - tB;
        });

        results.slice(0, 10).forEach((r, i) => {
            const isTop = i < 3;
            const medalColor = i === 0 ? 'text-yellow-500' : (i === 1 ? 'text-slate-400' : 'text-amber-700');
            const medalIcon = isTop ? `<i class="fa-solid fa-medal ${medalColor}"></i>` : `<span class="text-slate-300 font-bold w-4 text-center">${i + 1}</span>`;

            const row = document.createElement('div');
            row.className = "flex justify-between items-center p-3 bg-slate-50 rounded-xl mb-2 last:mb-0 border border-slate-100";
            row.innerHTML = `
                <div class="flex items-center gap-3">
                    <div class="w-6 flex justify-center">${medalIcon}</div>
                    <div class="font-bold text-slate-800 text-sm">${r.username || 'Anónimo'}</div>
                </div>
                <div class="font-mono font-bold text-blue-600 text-sm bg-blue-50 px-2 py-0.5 rounded">${r.time}</div>
            `;
            list.appendChild(row);
        });

    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="text-center text-red-400 text-xs py-4">Error cargando tiempos.</div>';
    }
}

function parseTime(timeStr) {
    const p = timeStr.split(':');
    return parseInt(p[0]) * 60 + parseInt(p[1]);
}


function checkStartProximity() {
    if (!state.activeTrack || !state.gps.lat) return;

    const startPt = state.activeTrack.points[0];
    const dist = getDist(state.gps, startPt);
    const btn = document.getElementById('btn-start-run');
    const msg = document.getElementById('dist-msg');

    // Threshold: 20 meters
    if (dist <= 30) { // Increased tolerance slightly
        if (btn.disabled) { // Only update if changed state to avoid jitter
            btn.disabled = false;
            btn.className = "w-full py-4 rounded-2xl bg-gradient-to-r from-blue-600 to-purple-600 text-white font-black text-lg shadow-lg shadow-blue-200 pulse-btn transition-all transform hover:scale-105 active:scale-95";
            btn.onclick = startRunLogic;
            btn.innerHTML = `<i class="fa-solid fa-play mr-2"></i> INICIAR DESCENSO`;
            msg.innerHTML = `<span class="text-green-500 font-bold flex items-center justify-center gap-1"><i class="fa-solid fa-location-dot"></i> Estás en la salida</span>`;
            // Vibrate device to notify user
            if (navigator.vibrate) navigator.vibrate(200);
        }
    } else {
        if (!btn.disabled) {
            btn.disabled = true;
            btn.className = "w-full py-4 rounded-2xl bg-slate-200 text-slate-400 font-bold text-lg flex items-center justify-center gap-2 cursor-not-allowed transition-all";
            btn.onclick = null;
            btn.innerHTML = `<i class="fa-solid fa-lock"></i> BLOQUEADO`;
        }
        msg.innerText = `Acércate a la salida (${Math.round(dist)}m)`;
    }
}

// --- RUN LOGIC ---
function startRunLogic() {
    clearInterval(state.detailProximityInterval);
    document.getElementById('modal-detail').classList.add('hidden');

    const track = state.activeTrack;
    state.run = {
        active: true,
        track: track,
        startTime: Date.now(),
        nextIdx: 1,
        timer: setInterval(updateTimer, 1000)
    };

    const hud = document.getElementById('modal-run');
    hud.classList.remove('hidden');
    document.getElementById('hud-next-point').innerText = "CP 1";

    // Init Hold Button
    initHoldToAbort();

    // Setup HUD Map
    setTimeout(() => {
        if (state.run.map) state.run.map.remove();
        const startPt = track.points[0];
        // Dark map for HUD
        state.run.map = L.map('run-map-bg', {
            zoomControl: false,
            dragging: false,
            touchZoom: false,
            attributionControl: false
        }).setView([startPt.lat, startPt.lng], 16);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(state.run.map);

        const path = track.points.map(p => [p.lat, p.lng]);
        L.polyline(path, { color: '#3b82f6', weight: 6, opacity: 0.6 }).addTo(state.run.map);

        // Add markers for all CPs
        track.points.forEach((p, i) => {
            const color = i === 0 ? '#22c55e' : (i === track.points.length - 1 ? '#ef4444' : '#eab308');
            L.circleMarker([p.lat, p.lng], { radius: 4, color: color, stroke: false, fillOpacity: 0.8 }).addTo(state.run.map);
        });

    }, 100);
}

function updateRunLoop() {
    if (!state.run.active) return;
    const curr = state.gps;
    const target = state.run.track.points[state.run.nextIdx];

    // HUD Update
    const speedKmh = Math.round(curr.speed * 3.6);
    document.getElementById('hud-speed').innerText = speedKmh;

    // Colorize speed
    const spdEl = document.getElementById('hud-speed').parentElement;
    if (speedKmh > 50) spdEl.style.color = '#ef4444'; // Red if fast
    else if (speedKmh > 30) spdEl.style.color = '#eab308';
    else spdEl.style.color = 'white';

    if (state.run.map) state.run.map.setView([curr.lat, curr.lng]);

    // Dist check
    const dist = getDist(curr, target);
    document.getElementById('hud-dist').innerText = Math.round(dist);

    // Hit Checkpoint (20m radius)
    if (dist < 30) {  // Increased tolerance
        // Audio feedback
        playBeep();

        if (target.type === 'end') {
            finishRun();
        } else {
            state.run.nextIdx++;
            const nextPt = state.run.track.points[state.run.nextIdx];
            const nextType = nextPt ? nextPt.type : 'end';

            const nextText = nextType === 'end' ? "META" : `CP ${state.run.nextIdx}`;

            // Animate HUD
            const pointEl = document.getElementById('hud-next-point');
            pointEl.classList.add('scale-125', 'text-green-400');
            setTimeout(() => pointEl.classList.remove('scale-125', 'text-green-400'), 300);

            pointEl.innerText = nextText;
        }
    }
}

function playBeep() {
    // Simple oscilator beep
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 880;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.1);
        osc.stop(ctx.currentTime + 0.1);
    } catch (e) { }
}

function updateTimer() {
    const s = Math.floor((Date.now() - state.run.startTime) / 1000);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    document.getElementById('hud-time').innerText = `${m}:${sec.toString().padStart(2, '0')}`;

    // Animate Gauge
    if (state.run.active) {
        const speed = Math.round(state.gps.speed * 3.6);
        // Map 0-120kmh to -45deg to 225deg (270deg range) or similar
        // CSS rotation starts at -45deg (hidden left). 
        // Let's say range is -135deg (empty) to 135deg (full). Total 270.
        // If CSS initial is -45deg, we need to adjust logic.
        // Let's assume style.css handles the gauge mask.
        // We simply rotate the fill. 
        // 0 km/h = -135deg
        // 100 km/h = 135deg
        const maxSpeed = 100;
        const boundedSpeed = Math.min(speed, maxSpeed);
        const percent = boundedSpeed / maxSpeed;
        const angle = -135 + (percent * 270);

        const gauge = document.getElementById('gauge-fill');
        if (gauge) gauge.style.transform = `rotate(${angle}deg)`;
    }
}

async function finishRun() {
    clearInterval(state.run.timer);
    state.run.active = false;
    document.getElementById('modal-run').classList.add('hidden');

    const resultsModal = document.getElementById('modal-results');
    resultsModal.classList.remove('hidden');

    const finalTime = document.getElementById('hud-time').innerText;
    document.getElementById('res-time').innerText = finalTime;

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // CALCULATE REAL REWARDS
    const distKm = state.run.track.dist;
    const baseXP = Math.floor(distKm * 100); // 100 XP per KM
    const speedBonus = state.gps.speed > 10 ? 50 : 0; // Bonus for going fast
    const totalXP = baseXP + speedBonus + 50; // Base participation reward

    // Save Result
    try {
        await addDoc(collection(db, "results"), {
            trackId: state.run.track.id,
            userId: state.user.uid,
            username: state.userData.username,
            trackName: state.run.track.name,
            time: finalTime,
            xpEarned: totalXP,
            date: serverTimestamp()
        });

        // Update Stats with Real XP and Level Calc
        const newTotalXP = (state.userData.xp || 0) + totalXP;
        const newLevel = Math.floor(Math.sqrt(newTotalXP / 100)) + 1; // Simple RPG curve: Level = sqrt(XP/100)

        // Calculate run duration in seconds
        const runDurationSec = Math.floor((Date.now() - state.run.startTime) / 1000);

        await updateDoc(doc(db, "users", state.user.uid), {
            totalDist: increment(distKm),
            totalTime: increment(runDurationSec),
            xp: increment(totalXP),
            level: newLevel
        });

        // Update local state immediately
        state.userData.xp = newTotalXP;
        state.userData.level = newLevel;
        state.userData.totalTime = (state.userData.totalTime || 0) + runDurationSec;
        document.getElementById('home-lvl').innerText = newLevel;

    } catch (e) {
        console.error("Error saving result", e);
        alert("Error guardando el resultado. Comprueba tu conexión.");
    }
}

window.abortRun = () => {
    // Called by hold button (direct) or voice (needs confirm?)
    // If called directly, we assume intention.
    clearInterval(state.run.timer);
    state.run.active = false;
    document.getElementById('modal-run').classList.add('hidden');
    document.getElementById('modal-detail').classList.remove('hidden');

    // Stop voice recognition loop if only meant for run
    // But keep it alive if global.
};

function initHoldToAbort() {
    const btn = document.getElementById('btn-run-abort-hold');
    const bar = btn.querySelector('.active-abort-progress');
    let timer = null;
    let startTime = 0;
    const DURATION = 1500; // 1.5s hold to stop run

    const start = (e) => {
        if (e.cancelable) e.preventDefault();
        startTime = Date.now();
        bar.style.transition = `width ${DURATION}ms linear`;
        bar.style.width = '100%';

        timer = setTimeout(() => {
            window.abortRun();
        }, DURATION);
    };

    const end = () => {
        clearTimeout(timer);
        bar.style.transition = 'width 0.2s ease-out';
        bar.style.width = '0%';
    };

    btn.addEventListener('mousedown', start);
    btn.addEventListener('touchstart', start);
    btn.addEventListener('mouseup', end);
    btn.addEventListener('mouseleave', end);
    btn.addEventListener('touchend', end);
}

window.closeResults = () => {
    document.getElementById('modal-results').classList.add('hidden');
    state.activeTrack = null;
    loadProfile();
};

window.nav = (page) => {
    // Hide all
    ['home', 'rank', 'profile', 'weather'].forEach(p => {
        const el = document.getElementById(`page-${p}`);
        if (el) el.classList.add('hidden');
    });

    const targetPage = document.getElementById(`page-${page}`);
    if (targetPage) targetPage.classList.remove('hidden');

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('text-blue-600', 'text-purple-600', 'active', 'scale-110', 'text-slate-500', 'text-slate-900');
        el.classList.add('text-slate-300');
    });

    const evt = window.event;
    const cur = (evt && evt.currentTarget) ? evt.currentTarget : document.querySelector(`.nav-item[onclick="nav('${page}')"]`);

    if (cur) {
        cur.classList.remove('text-slate-300');
        if (page === 'rank') {
            cur.classList.add('text-slate-500', 'text-slate-900', 'active', 'scale-110');
        } else {
            cur.classList.add('text-blue-600', 'active', 'scale-110');
        }
    }

    if (page === 'rank') loadLeaderboard('xp');
    if (page === 'profile') loadProfilePage();
    if (page === 'weather') loadWeatherPage();
};

window.loadProfilePage = () => {
    if (!state.userData) return;

    document.getElementById('profile-name').innerText = state.userData.username || "Usuario";

    // Level / Rank Logic: "Rango entre 80"
    // Assuming level is 1-80. Or we map XP to 1-80. 
    // Existing logic: Level = sqrt(XP/100) + 1. 
    // Let's just Clamp it to 80 for display as requested "entre 80".
    const rawLvl = state.userData.level || 1;
    const dispLvl = Math.min(rawLvl, 80);
    document.getElementById('profile-rank-val').innerText = dispLvl;

    // Stats
    const dist = (state.userData.totalDist || 0).toFixed(1) + " km";
    document.getElementById('profile-km').innerText = dist;

    // Time
    const seconds = state.userData.totalTime || 0;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    document.getElementById('profile-time').innerText = `${h}h ${m}m`;

    // Avatar
    const imgParam = encodeURIComponent(state.userData.username || 'User');
    document.getElementById('profile-img').src = `https://ui-avatars.com/api/?name=${imgParam}&background=0D8ABC&color=fff&size=128&bold=true`;
};

// --- CREATOR MODE ---
window.openCreator = () => {
    state.creator.active = true;
    state.creator.points = [];
    document.getElementById('modal-creator').classList.remove('hidden');
    document.getElementById('creator-step-1').classList.remove('hidden');
    document.getElementById('creator-step-2').classList.add('hidden');
    document.getElementById('track-name-input').value = ""; // Reset

    setTimeout(() => {
        if (state.creator.map) state.creator.map.remove();

        const lat = state.gps.lat || 40.416; // Madrid fallback
        const lng = state.gps.lng || -3.703;

        state.creator.map = L.map('creator-map', {
            zoomControl: false,
            attributionControl: false
        }).setView([lat, lng], 16);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            maxZoom: 20
        }).addTo(state.creator.map);
    }, 100);
};

window.startDrawing = () => {
    const name = document.getElementById('track-name-input').value.trim();
    if (!name) {
        alert("Ponle un nombre a tu pista");
        return;
    }
    document.getElementById('creator-step-1').classList.add('hidden');
    document.getElementById('creator-step-2').classList.remove('hidden');
    state.creator.map.on('click', (e) => addCreatorPoint(e.latlng));
};

function addCreatorPoint(latlng) {
    const pts = state.creator.points;
    const type = pts.length === 0 ? 'start' : 'checkpoint';

    const ptData = { lat: latlng.lat, lng: latlng.lng, type: type, idx: pts.length };
    pts.push(ptData);

    // Marker
    const color = pts.length === 1 ? '#2563eb' : '#7c3aed';
    const m = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 6,
        fillColor: color,
        color: 'white',
        weight: 3,
        fillOpacity: 1
    }).addTo(state.creator.map);

    state.creator.markers.push(m);

    // Polyline update
    if (state.creator.polyline) state.creator.polyline.remove();
    if (pts.length > 1) {
        const latlngs = pts.map(p => [p.lat, p.lng]);
        state.creator.polyline = L.polyline(latlngs, {
            color: '#0f172a',
            weight: 4,
            dashArray: '5, 10'
        }).addTo(state.creator.map);
    }

    // Update UI
    document.getElementById('point-counter').innerText = pts.length;
    document.getElementById('total-dist').innerText = calcTotalDist(pts).toFixed(2) + " km";

    // Add number label near marker
    if (pts.length > 1) {
        L.tooltip({
            permanent: true,
            direction: 'center',
            className: 'bg-transparent border-0 shadow-none font-bold text-xs text-white'
        }).setContent((pts.length).toString()).setLatLng(latlng).addTo(state.creator.map);
    }
}

window.saveTrack = async () => {
    if (state.creator.points.length < 2) return alert("Una pista necesita al menos salida y meta (2 puntos)");

    // Mark last point as end
    state.creator.points[state.creator.points.length - 1].type = 'end';

    const dist = calcTotalDist(state.creator.points);

    const btn = event.currentTarget;
    const oldContent = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Guardando...';

    try {
        await addDoc(collection(db, "tracks"), {
            name: document.getElementById('track-name-input').value,
            creator: state.userData.username,
            creatorId: state.user.uid,
            points: state.creator.points,
            dist: dist,
            drop: 0, // Placeholder for altitude calc
            createdAt: serverTimestamp()
        });

        closeCreator();
        refreshTracks();

        // Success Toast could go here
    } catch (e) {
        console.error(e);
        alert("Error guardando la pista");
        btn.disabled = false;
        btn.innerHTML = oldContent;
    }
};

window.closeCreator = () => {
    document.getElementById('modal-creator').classList.add('hidden');
    state.creator.active = false;
};

window.undoPoint = () => {
    if (state.creator.points.length > 0) {
        state.creator.points.pop();
        const m = state.creator.markers.pop();
        state.creator.map.removeLayer(m);

        if (state.creator.polyline) state.creator.polyline.remove();
        if (state.creator.points.length > 1) {
            const latlngs = state.creator.points.map(p => [p.lat, p.lng]);
            state.creator.polyline = L.polyline(latlngs, { color: '#0f172a', weight: 4, dashArray: '5, 10' }).addTo(state.creator.map);
        }

        document.getElementById('point-counter').innerText = state.creator.points.length;
        document.getElementById('total-dist').innerText = calcTotalDist(state.creator.points).toFixed(2) + " km";
    }
}

// --- NAVIGATION & LEADERBOARDS ---


window.loadLeaderboard = async (sort) => {
    const list = document.getElementById('leaderboard-list');
    list.innerHTML = '<div class="text-center text-slate-400 text-xs py-4"><i class="fa-solid fa-spinner fa-spin"></i> Cargando...</div>';

    // Update button styles
    const btnXp = document.getElementById('btn-rank-xp');
    const btnKm = document.getElementById('btn-rank-km');

    const activeClass = "flex-1 py-2 rounded-xl text-sm font-bold bg-slate-900 text-white shadow-lg transition-all transform scale-105";
    const inactiveClass = "flex-1 py-2 rounded-xl text-sm font-bold text-slate-400 hover:text-slate-900 transition-all";

    if (sort === 'xp') {
        btnXp.className = activeClass;
        btnKm.className = inactiveClass;
    } else {
        btnKm.className = activeClass;
        btnXp.className = inactiveClass;
    }

    const q = query(collection(db, "users"), limit(50));
    const snap = await getDocs(q);

    let users = [];
    snap.forEach(d => users.push(d.data()));

    // Client sort
    if (sort === 'xp') users.sort((a, b) => (b.xp || 0) - (a.xp || 0));
    else users.sort((a, b) => (b.totalDist || 0) - (a.totalDist || 0));

    list.innerHTML = '';
    users.forEach((u, i) => {
        const isTop = i < 3;
        const rankColor = isTop ? 'bg-yellow-50 border-yellow-100' : 'bg-white border-slate-50';
        const rankText = isTop ? 'text-yellow-600' : 'text-slate-300';

        const el = document.createElement('div');
        el.className = `flex items-center justify-between p-4 rounded-2xl border shadow-sm mb-2 ${rankColor}`;
        el.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="font-black text-lg w-8 text-center ${rankText}">${i + 1}</span>
                <span class="font-bold text-slate-900">${u.username}</span>
            </div>
            <span class="font-bold text-blue-600 bg-white/50 px-3 py-1 rounded-lg text-sm border border-slate-100/50">
                ${sort === 'xp' ? (u.xp || 0) + ' XP' : (u.totalDist || 0).toFixed(1) + ' km'}
            </span>
        `;
        list.appendChild(el);
    });
};

// --- UTILITIES ---
function getDist(p1, p2) {
    const R = 6371e3;
    const φ1 = p1.lat * Math.PI / 180, φ2 = p2.lat * Math.PI / 180;
    const Δφ = (p2.lat - p1.lat) * Math.PI / 180, Δλ = (p2.lng - p1.lng) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcTotalDist(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += getDist(pts[i - 1], pts[i]);
    return d / 1000;
}

// --- OPEN MIC (STREAMING) SYSTEM ---
// Protocol: WebSocket Repeater (as per README.md)

state.voiceChat = {
    active: false,
    micOpen: false,
    recorder: null,
    ws: null,
    audioContext: null,
    nextPlayTime: 0
};

window.toggleGlobalVoice = async () => {
    if (state.voiceChat.active) {
        leaveVoiceChat();
    } else {
        await initVoiceConnection();
    }
};

async function initVoiceConnection() {
    state.voiceChat.active = true;
    document.getElementById('voice-overlay').classList.remove('hidden');

    // UI Feedback
    const btn = document.getElementById('btn-global-voice');
    btn.classList.remove('bg-white', 'text-slate-400');
    btn.classList.add('bg-indigo-500', 'text-white', 'pulse-btn');
    btn.innerHTML = '<i class="fa-solid fa-headset"></i>';

    initDraggable('voice-overlay', 'voice-header');
    initHoldToLeave();

    // Init AudioContext
    if (!state.voiceChat.audioContext) {
        state.voiceChat.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (state.voiceChat.audioContext.state === 'suspended') {
        await state.voiceChat.audioContext.resume();
    }

    // Connect WebSocket
    connectWebSocket();

    // Auto-Start Mic
    setMicState(true);

    processVoiceSystemMessage("Radio conectada");
}

function connectWebSocket() {
    const wsUrl = "wss://audioservice.arielcapdevila.com";
    console.log("Connecting to WS:", wsUrl);

    state.voiceChat.ws = new WebSocket(wsUrl);
    state.voiceChat.ws.binaryType = 'arraybuffer';

    state.voiceChat.ws.onopen = () => {
        console.log("WS Connected");
        renderVoiceStatus("CONECTADO", "text-green-400");
    };

    state.voiceChat.ws.onclose = () => {
        console.log("WS Disconnected");
        if (state.voiceChat.active) {
            renderVoiceStatus("RECONECTANDO...", "text-yellow-400");
            setTimeout(connectWebSocket, 3000);
        }
    };

    state.voiceChat.ws.onerror = (e) => {
        console.error("WS Error", e);
    };

    state.voiceChat.ws.onmessage = async (event) => {
        if (event.data instanceof ArrayBuffer) {
            playAudioChunk(event.data);
        }
    };
}

function leaveVoiceChat() {
    state.voiceChat.active = false;
    setMicState(false);

    if (state.voiceChat.ws) {
        state.voiceChat.ws.onclose = null; // Prevent reconnect
        state.voiceChat.ws.close();
        state.voiceChat.ws = null;
    }

    if (state.voiceChat.audioContext) {
        state.voiceChat.audioContext.close();
        state.voiceChat.audioContext = null;
    }
    state.voiceChat.nextPlayTime = 0;

    // UI Reset
    const btn = document.getElementById('btn-global-voice');
    if (btn) {
        btn.classList.remove('bg-indigo-500', 'text-white', 'pulse-btn');
        btn.classList.add('bg-white', 'text-slate-400');
        btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';
    }
    document.getElementById('voice-overlay').classList.add('hidden');

    // Clear user list (this protocol doesn't support user list yet)
    const list = document.getElementById('voice-list-container');
    if (list) list.innerHTML = '<div class="text-xs text-slate-500 text-center py-2">Radio Activa</div>';

    processVoiceSystemMessage("Radio desconectada");
}

async function playAudioChunk(arrayBuffer) {
    if (!state.voiceChat.audioContext) return;
    const ctx = state.voiceChat.audioContext;

    try {
        // Decode
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

        // Schedule
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);

        // Simple jitter buffer logic
        const now = ctx.currentTime;
        // If next time is in past, reset to now (plus a tiny buffer)
        if (state.voiceChat.nextPlayTime < now) {
            state.voiceChat.nextPlayTime = now + 0.1;
        }

        source.start(state.voiceChat.nextPlayTime);
        state.voiceChat.nextPlayTime += audioBuffer.duration;

        // Visual Feedback
        const status = document.getElementById('mic-status');
        if (status && !state.voiceChat.micOpen) {
            status.innerText = "RECIBIENDO...";
            status.classList.add('text-blue-400', 'animate-pulse');
            setTimeout(() => {
                if (!state.voiceChat.micOpen && status) {
                    status.innerText = "CANAL ABIERTO";
                    status.classList.remove('text-blue-400', 'animate-pulse');
                }
            }, audioBuffer.duration * 1000);
        }

    } catch (e) {
        console.warn("Audio decode error (normal for partial chunks or connection noise)", e);
    }
}

function renderVoiceStatus(msg, colorClass) {
    const list = document.getElementById('voice-list-container');
    if (list) {
        list.innerHTML = `<div class="text-xs font-bold ${colorClass} text-center py-2 border border-slate-700 bg-slate-800 rounded mb-2">${msg}</div>`;
    }
}

// --- OPEN MIC LOGIC ---
window.toggleMic = async () => {
    if (!state.voiceChat.active) return;
    const newState = !state.voiceChat.micOpen;
    await setMicState(newState);
};

async function setMicState(isOpen) {
    state.voiceChat.micOpen = isOpen;
    const btnInner = document.getElementById('mic-btn-inner');
    const icon = document.getElementById('mic-icon');
    const status = document.getElementById('mic-status');
    const wave = document.getElementById('mic-wave');

    if (isOpen) {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

            // Start Recorder with small slices for low latency
            // Using Opus (default)
            state.voiceChat.recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });

            state.voiceChat.recorder.ondataavailable = async (e) => {
                if (e.data.size > 0 && state.voiceChat.ws && state.voiceChat.ws.readyState === WebSocket.OPEN) {
                    // Send raw blob bytes
                    const buffer = await e.data.arrayBuffer();
                    state.voiceChat.ws.send(buffer);
                }
            };

            // Start with 250ms chunks (balance between latency and overhead)
            state.voiceChat.recorder.start(250);

            // UI ON
            if (btnInner) {
                btnInner.classList.remove('bg-slate-700', 'border-slate-600');
                btnInner.classList.add('bg-green-600', 'border-green-500', 'shadow-[0_0_30px_rgba(34,197,94,0.4)]');
            }
            if (icon) icon.className = "fa-solid fa-microphone text-3xl text-white relative z-10";
            if (status) {
                status.innerText = "TRANSMITIENDO";
                status.classList.add('text-green-400', 'animate-pulse');
            }
            if (wave) {
                wave.classList.remove('opacity-0');
                wave.classList.add('opacity-50', 'animate-pulse');
            }
            playTone(800, 0.1, 'sine');

        } catch (e) {
            console.error(e);
            alert("Error al abrir micrófono");
            setMicState(false);
        }
    } else {
        if (state.voiceChat.recorder && state.voiceChat.recorder.state !== 'inactive') {
            state.voiceChat.recorder.stop();
            state.voiceChat.recorder.stream.getTracks().forEach(t => t.stop());
            state.voiceChat.recorder = null;
        }

        // UI OFF
        if (btnInner) {
            btnInner.classList.add('bg-slate-700', 'border-slate-600');
            btnInner.classList.remove('bg-green-600', 'border-green-500', 'shadow-[0_0_30px_rgba(34,197,94,0.4)]');
        }
        if (icon) icon.className = "fa-solid fa-microphone-slash text-3xl text-slate-400 relative z-10";
        if (status) {
            status.innerText = "MICROFONEADO";
            status.classList.remove('text-green-400', 'animate-pulse');
        }
        if (wave) {
            wave.classList.add('opacity-0');
            wave.classList.remove('opacity-50', 'animate-pulse');
        }
        playTone(600, 0.1, 'sine');
    }
}

// (Duplicate logic removed)

function playTone(freq = 880, dur = 0.1, type = 'sine', delay = 0) {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const t = ctx.currentTime + delay;
        osc.start(t);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.00001, t + dur);
        osc.stop(t + dur);
    } catch (e) { }
}

function processVoiceSystemMessage(text) {
    if (!window.speechSynthesis) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES';
    u.rate = 1.2;
    window.speechSynthesis.speak(u);
}

// --- DRAGGABLE & HOLD LOGIC ---
function initDraggable(elId, handleId) {
    const el = document.getElementById(elId);
    const handle = document.getElementById(handleId);
    if (!el || !handle) return;

    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    const start = (e) => {
        if (e.target.closest('button')) return;
        const cX = e.clientX || e.touches[0].clientX;
        const cY = e.clientY || e.touches[0].clientY;
        startX = cX; startY = cY;

        const rect = el.getBoundingClientRect();
        initialLeft = rect.left; initialTop = rect.top;

        isDragging = true;
        el.style.cursor = 'grabbing';
    };

    const move = (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const cX = e.clientX || e.touches[0].clientX;
        const cY = e.clientY || e.touches[0].clientY;

        const dx = cX - startX;
        const dy = cY - startY;
        el.style.left = `${initialLeft + dx}px`;
        el.style.top = `${initialTop + dy}px`;
        el.style.right = 'auto'; // Disable right positioning
    };

    const end = () => { isDragging = false; el.style.cursor = 'grab'; };

    handle.addEventListener('mousedown', start);
    handle.addEventListener('touchstart', start);
    window.addEventListener('mousemove', move);
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('mouseup', end);
    window.addEventListener('touchend', end);
}

function initHoldToLeave() {
    const btn = document.getElementById('btn-leave-hold');
    const bar = document.getElementById('leave-progress');
    if (!btn || !bar) return;

    let timer = null;
    const DURATION = 1500;

    const startHold = (e) => {
        if (e.cancelable) e.preventDefault();
        bar.style.transition = `width ${DURATION}ms linear`;
        bar.style.width = '100%';

        timer = setTimeout(() => {
            leaveVoiceChat();
        }, DURATION);
    };

    const endHold = () => {
        clearTimeout(timer);
        bar.style.transition = 'width 0.2s ease-out';
        bar.style.width = '0%';
    };

    btn.addEventListener('mousedown', startHold);
    btn.addEventListener('touchstart', startHold);
    btn.addEventListener('mouseup', endHold);
    btn.addEventListener('mouseleave', endHold);
    btn.addEventListener('touchend', endHold);
}

// --- WEATHER LOGIC ---
window.loadWeatherPage = async () => {
    // Show loading state if needed, or just keep previous data
    const tempEl = document.getElementById('weather-temp');
    if (tempEl.innerText === '--°') {
        document.getElementById('weather-desc').innerText = "Conectando con Sierra Nevada...";
    }

    try {
        const res = await fetch('https://api.codetabs.com/v1/proxy/?quest=https://umb.sierranevada.es/umbraco/api/parte/previsiones?culture=es');
        const data = await res.json();

        if (!data || !data.Partes || !data.Partes.length) throw new Error("Datos inválidos");

        const parte = data.Partes.find(p => p.Name === 'Previsión') || data.Partes[0];
        const snowData = parte.Parte.partenieve;

        const meteo = snowData.meteorologia.paginas.pagina;
        const current = meteo[0]; // Today
        const forecast = meteo[1]; // Future

        // 1. Current Weather (Pradollano)
        document.getElementById('weather-temp').innerText = current.temperaturapradollano + "°";
        document.getElementById('weather-desc').innerText = current.textoprevision0dia || "Sin previsión detallada.";

        document.getElementById('weather-wind').innerText = (current.vientopradollano || "0").trim() + " km/h";
        document.getElementById('weather-vis').innerText = (current.visibilidadpradollano || "N/A").trim();
        document.getElementById('weather-snow').innerText = (snowData.nieve.calidadnieve || "N/A").trim();

        // Icon based on sky
        const sky = (current.estadocielopradollano || "").toLowerCase();
        let icon = "fa-cloud";
        if (sky.includes("despejado") || sky.includes("sol")) icon = "fa-sun";
        if (sky.includes("parcial") || sky.includes("nuboso")) icon = "fa-cloud-sun";
        if (sky.includes("lluvia")) icon = "fa-cloud-rain";
        if (sky.includes("nieve")) icon = "fa-snowflake";
        document.getElementById('weather-icon').className = `fa-solid ${icon} text-4xl text-blue-100`;

        // 2. Resort Status
        const pistes = snowData.pistas;
        document.getElementById('resort-tracks').innerText = pistes["@totalpistasabiertas"] || pistes["@abiertas"] || "0";
        document.getElementById('resort-km').innerText = (pistes["@kilometrosesquiables"] || "0").replace(' Km', '');

        // 3. Forecast
        const list = document.getElementById('forecast-list');
        list.innerHTML = '';

        // Day +1
        addForecastCard(list, "Mañana", forecast.estadocieloprevision1dia, forecast.textoprevision1dia);
        // Day +2
        addForecastCard(list, "Pasado Mañana", forecast.estadocieloprevision2dia, forecast.textoprevision2dia);
        // Day +3
        addForecastCard(list, "+3 Días", forecast.estadocieloprevision3dia, forecast.textoprevision3dia);

        // 4. Slopes Status
        renderSlopes(snowData.pistas);

    } catch (e) {
        console.error("Weather Error", e);
        document.getElementById('weather-desc').innerText = "Error cargando la previsión. Inténtalo de nuevo.";
    }
};

function renderSlopes(pistasData) {
    const list = document.getElementById('slopes-list');
    list.innerHTML = '';

    let totalOpen = 0;
    let totalTotal = 0;

    let pages = pistasData.paginas.pagina;
    if (!Array.isArray(pages)) pages = [pages];

    pages.forEach(page => {
        let zonas = page.zona;
        if (!Array.isArray(zonas)) zonas = [zonas];

        zonas.forEach(zona => {
            const zonaName = zona["@nombre"];
            let tracksHtml = '';
            let zoneOpen = 0;
            let zoneTotal = 0;

            Object.keys(zona).forEach(key => {
                if (key.startsWith('@') || key.startsWith('#')) return;

                const track = zona[key];
                if (!track["@nombre"]) return; // Skip invalid

                zoneTotal++;

                // State Normalization
                const stateRaw = (track["@estado"] || "").toString().toLowerCase();
                const isOpen = stateRaw === 'true' || stateRaw === 'abierto' || stateRaw === 'parcial';
                if (isOpen) zoneOpen++;

                // Difficulty Color
                const diff = (track["@dificultad"] || "").trim().toUpperCase();
                let colorClass = 'bg-slate-400';
                if (diff.includes('V')) colorClass = 'bg-green-500';
                else if (diff.includes('A')) colorClass = 'bg-blue-500';
                else if (diff.includes('R')) colorClass = 'bg-red-500';
                else if (diff.includes('N')) colorClass = 'bg-black';
                else if (diff.includes('S')) colorClass = 'bg-orange-500'; // Sulayr/Freestyle

                // Status Icon
                const icon = isOpen ? '<i class="fa-solid fa-lock-open text-green-500"></i>' : '<i class="fa-solid fa-lock text-red-300"></i>';
                const opacity = isOpen ? 'opacity-100' : 'opacity-60 grayscale';

                // Subtracks check (if object has nested objects with @nombre)
                // For now simplifying to just main track as requested "individual info" usually means the named entities.

                // Store in global map for easy retrieval
                // We use a safe key replacing spaces to avoid quote issues in onclick, or just look up by raw name
                if (!state.slopesMap) state.slopesMap = {};
                state.slopesMap[track["@nombre"]] = { ...track, zona: zonaName };

                // Encoding name for safe function call
                const safeName = track["@nombre"].replace(/'/g, "\\'");

                tracksHtml += `
                    <div onclick="openSlopeDetail('${safeName}')" class="cursor-pointer flex items-center justify-between p-3 bg-white border border-slate-50 rounded-xl mb-2 slope-item ${opacity} active:scale-95 transition-transform" data-name="${track["@nombre"].toLowerCase()}">
                        <div class="flex items-center gap-3">
                            <div class="w-3 h-3 rounded-full ${colorClass} shadow-sm shrink-0"></div>
                            <span class="font-bold text-slate-700 text-sm truncate max-w-[180px]">${track["@nombre"]}</span>
                        </div>
                        <div class="text-sm">
                            ${icon}
                        </div>
                    </div>
                `;
            });

            totalOpen += zoneOpen;
            totalTotal += zoneTotal;

            if (tracksHtml) {
                const zoneHtml = `
                    <div class="slope-zone">
                        <div class="flex items-center justify-between mb-2 px-1 top-0 bg-white/95 backdrop-blur z-10 py-2 sticky">
                            <h4 class="font-bold text-slate-900 uppercase tracking-wider text-xs">${zonaName}</h4>
                            <span class="text-[10px] font-bold text-slate-400">${zoneOpen}/${zoneTotal}</span>
                        </div>
                        <div class="pl-2 border-l-2 border-slate-100">
                            ${tracksHtml}
                        </div>
                    </div>
                `;
                list.insertAdjacentHTML('beforeend', zoneHtml);
            }
        });
    });

    document.getElementById('slopes-total-status').innerText = `${totalOpen} / ${totalTotal} Abiertas`;
}

window.openSlopeDetail = (name) => {
    const track = state.slopesMap[name];
    if (!track) return;

    const modal = document.getElementById('modal-slope-detail');
    const card = document.getElementById('slope-modal-card');

    modal.classList.remove('hidden');
    // Simple animation delay
    setTimeout(() => {
        modal.classList.remove('opacity-0');
        card.classList.remove('scale-95');
        card.classList.add('scale-100');
    }, 10);

    // Populate Data
    document.getElementById('slope-detail-name').innerText = track["@nombre"];
    document.getElementById('slope-detail-zone').innerText = track.zona;

    // Status
    const stateRaw = (track["@estado"] || "").toString().toLowerCase();
    const isOpen = stateRaw === 'true' || stateRaw === 'abierto' || stateRaw === 'parcial';

    const statusEl = document.getElementById('slope-detail-status');
    if (isOpen) {
        statusEl.className = "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-green-100 text-green-600 font-bold text-xs uppercase tracking-wider mb-8";
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span> Abierta`;
    } else {
        statusEl.className = "inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-red-100 text-red-500 font-bold text-xs uppercase tracking-wider mb-8";
        statusEl.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> Cerrada`;
    }

    // Difficulty
    const diff = (track["@dificultad"] || "").trim().toUpperCase();
    let colorClass = 'bg-slate-400';
    let diffText = 'Desconocida';
    let diffColor = 'text-slate-400';

    if (diff.includes('V')) { colorClass = 'bg-green-500'; diffText = 'Verde'; diffColor = 'text-green-500'; }
    else if (diff.includes('A')) { colorClass = 'bg-blue-500'; diffText = 'Azul'; diffColor = 'text-blue-500'; }
    else if (diff.includes('R')) { colorClass = 'bg-red-500'; diffText = 'Roja'; diffColor = 'text-red-500'; }
    else if (diff.includes('N')) { colorClass = 'bg-black'; diffText = 'Negra'; diffColor = 'text-slate-900'; }
    else if (diff.includes('S')) { colorClass = 'bg-orange-500'; diffText = 'Freestyle'; diffColor = 'text-orange-500'; }

    const iconBox = document.getElementById('slope-detail-icon');
    const iconColor = document.getElementById('slope-detail-color');
    document.getElementById('slope-detail-diff').innerHTML = `<span class="${diffColor}">${diffText}</span>`;

    // Icon styling
    iconBox.className = `w-24 h-24 rounded-[2rem] bg-white shadow-xl mx-auto flex items-center justify-center text-4xl mb-6 relative ${diffColor}`;
    iconColor.className = `absolute inset-0 rounded-[2rem] opacity-10 ${colorClass}`;

};

window.closeSlopeDetail = () => {
    const modal = document.getElementById('modal-slope-detail');
    const card = document.getElementById('slope-modal-card');

    modal.classList.add('opacity-0');
    card.classList.remove('scale-100');
    card.classList.add('scale-95');

    setTimeout(() => {
        modal.classList.add('hidden');
    }, 300);
};

window.filterSlopes = () => {
    const term = document.getElementById('slope-search').value.toLowerCase();
    const items = document.querySelectorAll('.slope-item');

    items.forEach(item => {
        const name = item.getAttribute('data-name');
        if (name.includes(term)) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
    });

    // Hide empty zones
    document.querySelectorAll('.slope-zone').forEach(zone => {
        const visibleChildren = zone.querySelectorAll('.slope-item[style="display: flex;"], .slope-item:not([style*="display: none"])');
        zone.style.display = visibleChildren.length > 0 ? 'block' : 'none';
    });
};

function addForecastCard(container, title, sky, text) {
    if (!sky && !text) return;

    let icon = "fa-cloud";
    const s = (sky || "").toLowerCase();
    if (s.includes("despejado")) icon = "fa-sun";
    else if (s.includes("parcial")) icon = "fa-cloud-sun";
    else if (s.includes("nieve")) icon = "fa-snowflake";
    else if (s.includes("lluvia")) icon = "fa-cloud-rain";

    const div = document.createElement('div');
    div.className = "bg-white p-4 rounded-2xl border border-slate-100 shadow-sm";
    div.innerHTML = `
        <div class="flex items-center justify-between mb-2">
            <h4 class="font-bold text-slate-900">${title}</h4>
            <i class="fa-solid ${icon} text-blue-500"></i>
        </div>
        <div class="text-xs text-slate-500 leading-relaxed">
            ${text || "Sin datos."}
        </div>
    `;
    container.appendChild(div);
}
