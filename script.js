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
const state = {
    user: null,
    userData: null,
    gps: { lat: 0, lng: 0, alt: 0, speed: 0, acc: 0, heading: 0 },
    gpsWatchId: null,
    tracks: [],
    activeTrack: null,
    detailMap: null,
    detailProximityInterval: null,
    creator: { map: null, points: [], markers: [], polyline: null, active: false },
    run: { active: false, track: null, startTime: 0, nextIdx: 0, timer: null, map: null },
    voice: { active: false, recognition: null, speaking: false }
};

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
        state.gpsWatchId = navigator.geolocation.watchPosition(pos => {
            state.gps = {
                lat: pos.coords.latitude,
                lng: pos.coords.longitude,
                alt: pos.coords.altitude || 0,
                speed: pos.coords.speed || 0,
                acc: pos.coords.accuracy
            };
            if (state.run.active) updateRunLoop();
        }, (err) => {
            console.error("GPS Error", err);
        }, { enableHighAccuracy: true, maximumAge: 0 });
    }
}
// --- VOICE CONTROL SYSTEM ---
function initVoiceControl() {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        console.log("Speech recognition not supported");
        return;
    }

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
        txt.innerText = "Dí 'Parar', 'Estado' o 'Velocidad'";
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

    if (cmd.includes('parar') || cmd.includes('terminar') || cmd.includes('abortar') || cmd.includes('stop')) {
        speak("Deteniendo la carrera");
        if (state.run.active) abortRun();
    }
    else if (cmd.includes('velocidad') || cmd.includes('rápido')) {
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
        <div class="flex flex-col items-center justify-center py-8 text-slate-400">
            <div class="loader-ring border-slate-200 border-t-blue-500 w-8 h-8 mb-2"></div>
            <span class="text-xs font-bold">Buscando pistas...</span>
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

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // Victory vibe

    // Save Result
    try {
        await addDoc(collection(db, "results"), {
            trackId: state.run.track.id,
            userId: state.user.uid,
            username: state.userData.username,
            trackName: state.run.track.name,
            time: finalTime,
            date: serverTimestamp()
        });

        // Update Stats
        const distKm = state.run.track.dist;
        await updateDoc(doc(db, "users", state.user.uid), {
            totalDist: increment(distKm),
            xp: increment(100)
        });
    } catch (e) {
        console.error("Error saving result", e);
        alert("Error guardando el resultado. Comprueba tu conexión.");
    }
}

window.abortRun = () => {
    if (confirm("¿Segura que quieres abandonar el descenso?")) {
        clearInterval(state.run.timer);
        state.run.active = false;
        document.getElementById('modal-run').classList.add('hidden');
        document.getElementById('modal-detail').classList.remove('hidden');
    }
};

window.closeResults = () => {
    document.getElementById('modal-results').classList.add('hidden');
    state.activeTrack = null;
    loadProfile();
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
window.nav = (page) => {
    if (page === 'home') {
        document.getElementById('page-home').classList.remove('hidden');
        document.getElementById('page-rank').classList.add('hidden');
    } else {
        document.getElementById('page-home').classList.add('hidden');
        document.getElementById('page-rank').classList.remove('hidden');
        loadLeaderboard('xp');
    }

    document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.remove('text-blue-600', 'active', 'scale-110');
        el.classList.add('text-slate-300');
        // Reset icon style
    });
    const cur = event.currentTarget;
    cur.classList.add('text-blue-600', 'active', 'scale-110');
    cur.classList.remove('text-slate-300');
};

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

// --- VOICE CHAT (WebRTC) ---
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' }
    ],
    iceCandidatePoolSize: 10
};

state.voiceChat = {
    localStream: null,
    connections: {},
    active: false,
    unsubSignaling: null
};

window.toggleGlobalVoice = async () => {
    // If active, just show overlay
    if (state.voiceChat.active) {
        document.getElementById('voice-overlay').classList.remove('hidden');
        return;
    }

    // Join
    try {
        // Enhanced Audio Constraints
        const constraints = {
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
                channelCount: 1, // Mono is usually better for voice chat stability
                sampleRate: 48000,
                sampleSize: 16
            },
            video: false
        };

        state.voiceChat.localStream = await navigator.mediaDevices.getUserMedia(constraints);
        state.voiceChat.active = true;

        // UI Update
        const btn = document.getElementById('btn-global-voice');
        btn.classList.remove('bg-white', 'text-slate-400');
        btn.classList.add('bg-red-500', 'text-white', 'pulse-btn');
        btn.innerHTML = '<i class="fa-solid fa-microphone"></i>';

        // Show Overlay
        document.getElementById('voice-overlay').classList.remove('hidden');
        initDraggable('voice-overlay', 'voice-header');
        initHoldToLeave();

        // Init Listener
        startSignalListener();

        // Join Signaling
        joinVoiceRoom("global");

    } catch (e) {
        console.error(e);
        alert("No se pudo acceder al micrófono. Verifica los permisos.");
    }
};

window.minimizeVoice = () => {
    // Just toggle the list and controls visibility via CSS class
    document.getElementById('voice-overlay').classList.toggle('voice-minimized');
};

async function leaveVoiceChat() {
    state.voiceChat.active = false;
    if (state.voiceChat.localStream) {
        state.voiceChat.localStream.getTracks().forEach(t => t.stop());
        state.voiceChat.localStream = null;
    }
    Object.values(state.voiceChat.connections).forEach(pc => pc.close());
    state.voiceChat.connections = {};
    if (state.voiceChat.unsubSignaling) state.voiceChat.unsubSignaling();

    // Remove audio elements
    document.querySelectorAll('audio[id^="audio-"]').forEach(el => el.remove());

    // UI Reset
    const btn = document.getElementById('btn-global-voice');
    btn.classList.remove('bg-red-500', 'text-white', 'pulse-btn');
    btn.classList.add('bg-white', 'text-slate-400');
    btn.innerHTML = '<i class="fa-solid fa-microphone-slash"></i>';

    document.getElementById('voice-overlay').classList.add('hidden');

    // Remove from DB presence
    try {
        if (state.user) {
            await deleteDoc(doc(db, "voice_rooms", "global", "peers", state.user.uid));
        }
    } catch (e) { }
}

async function joinVoiceRoom(roomId) {
    const roomRef = doc(db, "voice_rooms", roomId);
    const peersRef = collection(roomRef, "peers");

    // 1. Add myself with extra data
    await setDoc(doc(peersRef, state.user.uid), {
        joinedAt: serverTimestamp(),
        id: state.user.uid,
        username: state.userData.username || "User",
        // level: state.userData.level || 1 // Optional
    });

    // 2. Listen for other peers
    state.voiceChat.unsubSignaling = onSnapshot(peersRef, (snap) => {
        // Render Users List
        renderVoiceUsers(snap.docs);

        snap.docChanges().forEach(async (change) => {
            if (change.type === "added") {
                const peerId = change.doc.id;
                if (peerId !== state.user.uid) {
                    if (state.user.uid < peerId) {
                        console.log("Initiating call to", peerId);
                        createPeerConnection(peerId, true);
                    }
                }
            }
            if (change.type === "removed") {
                const peerId = change.doc.id;
                if (state.voiceChat.connections[peerId]) {
                    state.voiceChat.connections[peerId].close();
                    delete state.voiceChat.connections[peerId];
                    const aud = document.getElementById(`audio-${peerId}`);
                    if (aud) aud.remove();
                }
            }
        });
    });
}

function renderVoiceUsers(docs) {
    const container = document.getElementById('voice-list-container');
    container.innerHTML = '';

    // Always add myself first? Or alphabetical. Let's do alphabetical.
    const users = docs.map(d => d.data());

    // Ensure I am in the list if not pushed yet (local latency)
    if (!users.find(u => u.id === state.user.uid)) {
        users.push({ id: state.user.uid, username: state.userData.username + " (Tú)" });
    }

    users.forEach(u => {
        const row = document.createElement('div');
        row.className = "voice-user-row key-" + u.id;

        // Initials
        const initials = u.username.substring(0, 2).toUpperCase();

        row.innerHTML = `
            <div class="user-avatar-voice ${u.id === state.user.uid ? 'border-2 border-white' : ''}">
                ${initials}
            </div>
            <span class="text-slate-200 text-xs font-bold truncate">${u.username}</span>
            ${u.id === state.user.uid ? '' : '<div class="ml-auto w-2 h-2 bg-green-400 rounded-full"></div>'}
        `;
        container.appendChild(row);
    });
}

// --- DRAGGABLE & HOLD LOGIC ---
function initDraggable(elId, handleId) {
    const el = document.getElementById(elId);
    const handle = document.getElementById(handleId);
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    const start = (e) => {
        // e.preventDefault(); // Don't prevent default, might block clicks?
        // Only prevent if target is handle
        if (e.target.closest('button')) return; // Allow button clicks inside header

        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;

        startX = clientX;
        startY = clientY;

        const rect = el.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        isDragging = true;
        el.style.cursor = 'grabbing';
    };

    const move = (e) => {
        if (!isDragging) return;
        e.preventDefault();

        const clientX = e.clientX || e.touches[0].clientX;
        const clientY = e.clientY || e.touches[0].clientY;

        const dx = clientX - startX;
        const dy = clientY - startY;

        el.style.left = `${initialLeft + dx}px`;
        el.style.top = `${initialTop + dy}px`;
        el.style.right = 'auto'; // Disable right positioning once moved
    };

    const end = () => {
        isDragging = false;
        el.style.cursor = 'grab';
    };

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
    let timer = null;
    let startTime = 0;

    // Duration: 2000ms
    const DURATION = 2000;

    const startHold = (e) => {
        e.preventDefault(); // prevent click?
        startTime = Date.now();
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

    btn.onmousedown = startHold;
    btn.ontouchstart = startHold;

    btn.onmouseup = endHold;
    btn.onmouseleave = endHold;
    btn.ontouchend = endHold;
}

// ... existing helpers ...

function startSignalListener() {
    const q = query(collection(db, "voice_rooms", "global", "signals"), where("to", "==", state.user.uid));

    onSnapshot(q, (snap) => {
        snap.docChanges().forEach(async (change) => {
            if (change.type === 'added') {
                const data = change.doc.data();
                const fromId = data.from;

                // Establish connection wrapper if not exists (responder side)
                if (!state.voiceChat.connections[fromId]) {
                    await createPeerConnection(fromId, false);
                }

                const pc = state.voiceChat.connections[fromId];

                if (data.type === 'offer') {
                    console.log("Received Offer from", fromId);
                    await pc.setRemoteDescription(new RTCSessionDescription({ type: data.offer.type, sdp: data.offer.sd }));
                    const answer = await pc.createAnswer();
                    await pc.setLocalDescription(answer);

                    await addDoc(collection(db, "voice_rooms", "global", "signals"), {
                        from: state.user.uid,
                        to: fromId,
                        type: 'answer',
                        answer: { type: answer.type, sd: answer.sdp }
                    });
                }
                else if (data.type === 'answer') {
                    console.log("Received Answer from", fromId);
                    if (!pc.currentRemoteDescription) {
                        await pc.setRemoteDescription(new RTCSessionDescription({ type: data.answer.type, sdp: data.answer.sd }));
                    }
                }
                else if (data.type === 'candidate') {
                    try {
                        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
                    } catch (e) { console.log("Candidate error", e); }
                }

                // Delete consumed signal to clean up
                deleteDoc(change.doc.ref);
            }
        });
    });
}

async function createPeerConnection(peerId, initiator) {
    if (state.voiceChat.connections[peerId]) return state.voiceChat.connections[peerId];

    const pc = new RTCPeerConnection(rtcConfig);
    state.voiceChat.connections[peerId] = pc;

    // Add local tracks
    if (state.voiceChat.localStream) {
        state.voiceChat.localStream.getTracks().forEach(track => pc.addTrack(track, state.voiceChat.localStream));
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
        console.log("Received remote track from", peerId);
        if (!document.getElementById(`audio-${peerId}`)) {
            const remoteAudio = document.createElement('audio');
            remoteAudio.srcObject = event.streams[0];
            remoteAudio.autoplay = true;
            remoteAudio.id = `audio-${peerId}`;
            document.body.appendChild(remoteAudio);
        }
    };

    // ICE Candidates
    pc.onicecandidate = async (event) => {
        if (event.candidate) {
            await addDoc(collection(db, "voice_rooms", "global", "signals"), {
                from: state.user.uid,
                to: peerId,
                type: 'candidate',
                candidate: event.candidate.toJSON()
            });
        }
    };

    if (initiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        await addDoc(collection(db, "voice_rooms", "global", "signals"), {
            from: state.user.uid,
            to: peerId,
            type: 'offer',
            offer: { type: offer.type, sd: offer.sdp }
        });
    }

    return pc;
}
