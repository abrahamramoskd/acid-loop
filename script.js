// ============================================================
// BJORKLUND
// ============================================================
function bjorklund(beats, steps) {
	if (beats >= steps) return new Array(steps).fill(1);
	if (beats === 0) return new Array(steps).fill(0);
	let groups = [];
	for (let i = 0; i < beats; i++) groups.push([1]);
	let remainders = [];
	for (let i = 0; i < steps - beats; i++) remainders.push([0]);
	while (remainders.length > 1) {
		let newGroups = [];
		const minLen = Math.min(groups.length, remainders.length);
		for (let i = 0; i < minLen; i++)
			newGroups.push(groups[i].concat(remainders[i]));
		const leftG = groups.slice(minLen);
		const leftR = remainders.slice(minLen);
		groups = newGroups;
		remainders = leftG.length > 0 ? leftG : leftR;
		if (remainders.length <= 1 && leftG.length === 0 && leftR.length <= 1) break;
	}
	let result = [];
	for (const g of groups) result.push(...g);
	for (const r of remainders) result.push(...r);
	return result;
}

// ============================================================
// TRACKS
// ============================================================
const TRACK_DEFS = [
	{ name: "KIK", n: 1, m: 4, off: 0, color: "#F0FF00" },
	{ name: "SNR", n: 1, m: 8, off: 4, color: "#F0FF00" },
	{ name: "HHC", n: 11, m: 15, off: 0, color: "#F0FF00" },
	{ name: "HHO", n: 1, m: 4, off: 2, color: "#F0FF00" },
	{ name: "TB", n: 11, m: 19, off: 3, color: "#00FFFF" }
];
const MIXER_LABELS = ["KIK", "SNR", "HHC", "HHO", "TB"];

function rotatePattern(pat, offset) {
	var m = pat.length;
	var o = ((offset % m) + m) % m;
	if (o === 0) return pat.slice();
	return pat.slice(m - o).concat(pat.slice(0, m - o));
}

const tracks = TRACK_DEFS.map((d) => {
	var base = bjorklund(d.n, d.m);
	return {
		name: d.name,
		n: d.n,
		m: d.m,
		offset: d.off,
		color: d.color,
		basePattern: base,
		pattern: rotatePattern(base, d.off),
		muted: false,
		currentStep: 0
	};
});

// ============================================================
// AUDIO
// ============================================================
let audioCtx = null;
let masterGain = null;
let compressor = null;
let trackGains = [];
let isPlaying = false;
let bpm = 130;
let timerID = null;
let nextNoteTime = 0;
let currentStep = 0;
let loopStartTime = 0;
const scheduleAheadTime = 0.1;
const lookaheadMs = 25;
let p303rand = 0.1,
	p303reso = 0.3,
	p303dist = 0.25,
	p303env = 0.1,
	p303cut = 0.3;

// LFO per knob — modulates effective values
var lfo303 = {
	rand: { wave: "off", dur: 16 },
	reso: { wave: "off", dur: 16 },
	cut: { wave: "off", dur: 16 },
	env: { wave: "off", dur: 16 },
	dist: { wave: "off", dur: 16 }
};
var eff303 = { rand: 0.1, reso: 0.7, cut: 0.3, env: 0.1, dist: 0.25 };
var override303 = {
	rand: false,
	reso: false,
	cut: false,
	env: false,
	dist: false
};

var LFO_KEYS = ["rand", "reso", "cut", "env", "dist"];

function lfoMultiplier(wave, phase) {
	switch (wave) {
		case "sin":
			return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
		case "tri":
			return phase < 0.5 ? phase * 2 : 2 - phase * 2;
		case "saw":
			return phase;
		case "squ":
			return phase < 0.5 ? 1 : 0;
		case "rnd":
			return Math.random();
		default:
			return 1;
	}
}

function updateEffective303(step) {
	var bases = [p303rand, p303reso, p303cut, p303env, p303dist];
	for (var i = 0; i < LFO_KEYS.length; i++) {
		var key = LFO_KEYS[i];
		if (override303[key] || lfo303[key].wave === "off") {
			eff303[key] = bases[i];
		} else {
			var lfo = lfo303[key];
			var phase = (step % lfo.dur) / lfo.dur;
			eff303[key] = bases[i] * lfoMultiplier(lfo.wave, phase);
		}
	}
}
let noteOffsets303 = [];

function generate303Offsets() {
	const m = tracks[4].m;
	const randRange = Math.round(p303rand * 24);
	noteOffsets303 = [];
	for (let i = 0; i < m; i++) {
		noteOffsets303[i] =
			randRange > 0
				? Math.floor(Math.random() * (randRange + 1)) - Math.floor(randRange / 2)
				: 0;
	}
}

function initAudio() {
	if (audioCtx) return;
	audioCtx = new (window.AudioContext || window.webkitAudioContext)();
	compressor = audioCtx.createDynamicsCompressor();
	compressor.threshold.value = -12;
	compressor.ratio.value = 4;
	compressor.connect(audioCtx.destination);
	masterGain = audioCtx.createGain();
	masterGain.gain.value = 0.8;
	masterGain.connect(compressor);
	trackGains = [];
	for (let i = 0; i < 5; i++) {
		const g = audioCtx.createGain();
		g.gain.value = 0.8;
		g.connect(masterGain);
		trackGains.push(g);
	}
	// Sync fader values to newly created nodes
	document
		.querySelectorAll('#mixer input[type="range"].vslider')
		.forEach((el) => {
			setFaderValue(el.dataset.fader, +el.value);
		});
}

let noiseBuffer = null;
function getNoiseBuffer() {
	if (noiseBuffer) return noiseBuffer;
	const len = audioCtx.sampleRate * 0.5;
	noiseBuffer = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
	const data = noiseBuffer.getChannelData(0);
	for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
	return noiseBuffer;
}

function makeDistCurve(amount) {
	const k = amount * 100;
	const samples = 256;
	const curve = new Float32Array(samples);
	for (let i = 0; i < samples; i++) {
		const x = (i * 2) / samples - 1;
		curve[i] = Math.tanh(k * x) / Math.tanh(k || 1);
	}
	return curve;
}

// ============================================================
// SYNTH VOICES → trackGains[i]
// ============================================================
function playKick(time) {
	const osc = audioCtx.createOscillator();
	const gain = audioCtx.createGain();
	osc.type = "sine";
	osc.frequency.setValueAtTime(150, time);
	osc.frequency.exponentialRampToValueAtTime(50, time + 0.05);
	osc.frequency.exponentialRampToValueAtTime(30, time + 0.2);
	gain.gain.setValueAtTime(1, time);
	gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);
	osc.connect(gain);
	gain.connect(trackGains[0]);
	osc.start(time);
	osc.stop(time + 0.4);
}

function playSnare(time) {
	const nSrc = audioCtx.createBufferSource();
	nSrc.buffer = getNoiseBuffer();
	const nFilter = audioCtx.createBiquadFilter();
	nFilter.type = "bandpass";
	nFilter.frequency.value = 1800;
	nFilter.Q.value = 1.2;
	const nGain = audioCtx.createGain();
	nGain.gain.setValueAtTime(0.7, time);
	nGain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
	nSrc.connect(nFilter);
	nFilter.connect(nGain);
	nGain.connect(trackGains[1]);
	nSrc.start(time);
	nSrc.stop(time + 0.2);
	const osc = audioCtx.createOscillator();
	osc.type = "triangle";
	osc.frequency.setValueAtTime(180, time);
	osc.frequency.exponentialRampToValueAtTime(80, time + 0.04);
	const oGain = audioCtx.createGain();
	oGain.gain.setValueAtTime(0.5, time);
	oGain.gain.exponentialRampToValueAtTime(0.001, time + 0.1);
	osc.connect(oGain);
	oGain.connect(trackGains[1]);
	osc.start(time);
	osc.stop(time + 0.15);
}

function playHHClosed(time) {
	const src = audioCtx.createBufferSource();
	src.buffer = getNoiseBuffer();
	const hp = audioCtx.createBiquadFilter();
	hp.type = "highpass";
	hp.frequency.value = 8000;
	const gain = audioCtx.createGain();
	gain.gain.setValueAtTime(0.3, time);
	gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
	src.connect(hp);
	hp.connect(gain);
	gain.connect(trackGains[2]);
	src.start(time);
	src.stop(time + 0.08);
}

function playHHOpen(time) {
	const src = audioCtx.createBufferSource();
	src.buffer = getNoiseBuffer();
	const hp = audioCtx.createBiquadFilter();
	hp.type = "highpass";
	hp.frequency.value = 8000;
	const gain = audioCtx.createGain();
	gain.gain.setValueAtTime(0.3, time);
	gain.gain.exponentialRampToValueAtTime(0.001, time + 0.3);
	src.connect(hp);
	hp.connect(gain);
	gain.connect(trackGains[3]);
	src.start(time);
	src.stop(time + 0.35);
}

function play303(time, step) {
	const baseNote = 36;
	// Scale stored offset by effective/base rand ratio
	var randScale = p303rand > 0.01 ? eff303.rand / p303rand : 0;
	var offset = Math.round((noteOffsets303[step] || 0) * randScale);
	const freq = 440 * Math.pow(2, (baseNote + offset - 69) / 12);
	const osc = audioCtx.createOscillator();
	osc.type = "sawtooth";
	osc.frequency.setValueAtTime(freq, time);

	// Filter — cutoff sets base freq (60–5000Hz exp), env mod adds sweep on top
	const baseCutoff = 60 * Math.pow(5000 / 60, eff303.cut);
	const peakCutoff = baseCutoff + eff303.env * 2750;
	const decayTime = 0.15;

	const filter = audioCtx.createBiquadFilter();
	filter.type = "lowpass";
	filter.frequency.setValueAtTime(peakCutoff, time);
	filter.frequency.exponentialRampToValueAtTime(baseCutoff, time + decayTime);
	filter.Q.value = 1 + eff303.reso * 25;

	const dist = audioCtx.createWaveShaper();
	dist.curve = makeDistCurve(0.1 + eff303.dist * 0.9);
	dist.oversample = "4x";

	const gain = audioCtx.createGain();
	gain.gain.setValueAtTime(0.35, time);
	gain.gain.exponentialRampToValueAtTime(0.001, time + 0.25);

	osc.connect(filter);
	filter.connect(dist);
	dist.connect(gain);
	gain.connect(trackGains[4]);
	osc.start(time);
	osc.stop(time + 0.3);
}

const PLAY_FNS = [playKick, playSnare, playHHClosed, playHHOpen, play303];

// ============================================================
// SCHEDULER
// ============================================================
let kickHitTime = 0;

function scheduleNote(time) {
	for (let i = 0; i < tracks.length; i++) {
		const t = tracks[i];
		const step = currentStep % t.m;
		t.currentStep = step;
		if (t.pattern[step] === 1 && !t.muted) PLAY_FNS[i](time, step);
	}
	if (tracks[0].pattern[currentStep % tracks[0].m] === 1 && !tracks[0].muted) {
		kickHitTime = performance.now();
	}
}

function scheduler() {
	while (nextNoteTime < audioCtx.currentTime + scheduleAheadTime) {
		scheduleNote(nextNoteTime);
		nextNoteTime += 60.0 / bpm / 4;
		currentStep++;
	}
}

function startPlayback() {
	initAudio();
	if (audioCtx.state === "suspended") audioCtx.resume();
	isPlaying = true;
	currentStep = 0;
	nextNoteTime = audioCtx.currentTime + 0.05;
	loopStartTime = audioCtx.currentTime;
	timerID = setInterval(scheduler, lookaheadMs);
	document.getElementById("playBtn").textContent = "■ STOP";
	document.getElementById("playBtn").classList.add("active");
}

function stopPlayback() {
	isPlaying = false;
	clearInterval(timerID);
	document.getElementById("playBtn").textContent = "▶ PLAY";
	document.getElementById("playBtn").classList.remove("active");
}

// ============================================================
// SVG — RINGS + SMILEY (fixed geometry)
// ============================================================
const SVG_NS = "http://www.w3.org/2000/svg";
const CX = 180,
	CY = 180;
const RING_RADII = [145, 127, 109, 91, 73];
let stepElements = [];
let playheadLines = [];

// Smiley geometry constants
const EYE_Y = CY - 5; // eyes vertical center
const BROW_BASE_Y = CY - 24; // brows well above eyes (safe margin)
const MOUTH_Y = CY + 10; // mouth endpoints

function buildSVG() {
	const svg = document.getElementById("ringsSvg");
	svg.innerHTML = "";
	stepElements = [];

	for (let t = 0; t < tracks.length; t++) {
		const r = RING_RADII[t];
		const track = tracks[t];
		const trackEls = [];

		const ring = document.createElementNS(SVG_NS, "circle");
		ring.setAttribute("cx", CX);
		ring.setAttribute("cy", CY);
		ring.setAttribute("r", r);
		ring.setAttribute("fill", "none");
		ring.setAttribute("stroke", "#333");
		ring.setAttribute("stroke-width", "1");
		svg.appendChild(ring);

		for (let s = 0; s < track.m; s++) {
			const angle = (s / track.m) * Math.PI * 2 - Math.PI / 2;
			const x = CX + r * Math.cos(angle);
			const y = CY + r * Math.sin(angle);
			const dot = document.createElementNS(SVG_NS, "circle");
			dot.setAttribute("cx", x);
			dot.setAttribute("cy", y);
			dot.setAttribute("r", track.pattern[s] ? 4 : 1.5);
			dot.setAttribute("fill", track.pattern[s] ? track.color : "#333");
			svg.appendChild(dot);
			trackEls.push({ dot });
		}
		stepElements.push(trackEls);

		const ph = document.createElementNS(SVG_NS, "circle");
		ph.setAttribute("r", 6);
		ph.setAttribute("fill", "none");
		ph.setAttribute("stroke", "#00FFFF");
		ph.setAttribute("stroke-width", "2");
		ph.setAttribute("cx", CX);
		ph.setAttribute("cy", CY - r);
		svg.appendChild(ph);
		playheadLines.push(ph);
	}

	// ===== SMILEY =====
	const g = document.createElementNS(SVG_NS, "g");
	g.id = "smiley";

	const face = document.createElementNS(SVG_NS, "circle");
	face.setAttribute("cx", CX);
	face.setAttribute("cy", CY);
	face.setAttribute("r", 30);
	face.setAttribute("fill", "#F0FF00");
	g.appendChild(face);

	// Eyes
	for (const [id, ex] of [
		["eyeL", CX - 10],
		["eyeR", CX + 10]
	]) {
		const eye = document.createElementNS(SVG_NS, "circle");
		eye.id = id;
		eye.setAttribute("cx", ex);
		eye.setAttribute("cy", EYE_Y);
		eye.setAttribute("r", 4);
		eye.setAttribute("fill", "#000");
		g.appendChild(eye);
	}

	// Brows — start above eyes, hidden
	for (const [id, x1, x2] of [
		["browL", CX - 16, CX - 4],
		["browR", CX + 4, CX + 16]
	]) {
		const brow = document.createElementNS(SVG_NS, "line");
		brow.id = id;
		brow.setAttribute("x1", x1);
		brow.setAttribute("y1", BROW_BASE_Y);
		brow.setAttribute("x2", x2);
		brow.setAttribute("y2", BROW_BASE_Y);
		brow.setAttribute("stroke", "#FF00FF");
		brow.setAttribute("stroke-width", "2.5");
		brow.setAttribute("stroke-linecap", "round");
		brow.setAttribute("opacity", "0");
		g.appendChild(brow);
	}

	// Mouth group — opens with env mod, teeth appear inside
	const mouthG = document.createElementNS(SVG_NS, "g");
	mouthG.id = "mouthGroup";

	// Mouth fill (black interior, hidden when closed)
	const mouthFill = document.createElementNS(SVG_NS, "path");
	mouthFill.id = "mouthFill";
	mouthFill.setAttribute("fill", "#000");
	mouthFill.setAttribute("stroke", "none");
	mouthG.appendChild(mouthFill);

	// Teeth — upper row (pointy triangles, white)
	const teeth = document.createElementNS(SVG_NS, "path");
	teeth.id = "teeth";
	teeth.setAttribute("fill", "#fff");
	teeth.setAttribute("stroke", "none");
	teeth.setAttribute("opacity", "0");
	mouthG.appendChild(teeth);

	// Mouth outline stroke on top
	const mouth = document.createElementNS(SVG_NS, "path");
	mouth.id = "mouth";
	mouth.setAttribute(
		"d",
		"M " +
			(CX - 14) +
			" " +
			MOUTH_Y +
			" Q " +
			CX +
			" " +
			(CY + 22) +
			" " +
			(CX + 14) +
			" " +
			MOUTH_Y
	);
	mouth.setAttribute("fill", "none");
	mouth.setAttribute("stroke", "#000");
	mouth.setAttribute("stroke-width", "2.5");
	mouth.setAttribute("stroke-linecap", "round");
	mouthG.appendChild(mouth);

	g.appendChild(mouthG);

	svg.appendChild(g);
}

function rebuildRingSVG() {
	playheadLines = [];
	buildSVG();
}

// ============================================================
// ANIMATION
// ============================================================
function animate() {
	requestAnimationFrame(animate);
	if (!isPlaying || !audioCtx) return;

	const secondsPerStep = 60.0 / bpm / 4;

	for (let t = 0; t < tracks.length; t++) {
		const track = tracks[t];
		const r = RING_RADII[t];
		const elapsed = audioCtx.currentTime - loopStartTime;
		const totalSteps = elapsed / secondsPerStep;
		const fractional = (totalSteps % track.m) / track.m;
		const angle = fractional * Math.PI * 2 - Math.PI / 2;
		if (playheadLines[t]) {
			playheadLines[t].setAttribute("cx", CX + r * Math.cos(angle));
			playheadLines[t].setAttribute("cy", CY + r * Math.sin(angle));
		}
		const activeStep = Math.floor(totalSteps) % track.m;
		const els = stepElements[t];
		if (els) {
			for (let s = 0; s < els.length; s++) {
				const isOn = track.pattern[s] === 1;
				const isCur = s === activeStep;
				els[s].dot.setAttribute(
					"fill",
					isCur ? "#00FFFF" : isOn ? track.color : "#333"
				);
				els[s].dot.setAttribute("r", isCur && isOn ? 5 : isOn ? 4 : 1.5);
			}
		}
	}

	// ===== UPDATE LFO → eff303 =====
	const elapsed0 = audioCtx.currentTime - loopStartTime;
	const visualStep = Math.floor(elapsed0 / secondsPerStep);
	updateEffective303(visualStep);

	// Update number displays with effective values
	var numEls = {
		rand: document.getElementById("k303randN"),
		reso: document.getElementById("k303resoN"),
		cut: document.getElementById("k303cutN"),
		env: document.getElementById("k303envN"),
		dist: document.getElementById("k303distN")
	};
	for (var ki = 0; ki < LFO_KEYS.length; ki++) {
		var k = LFO_KEYS[ki];
		if (!override303[k] && lfo303[k].wave !== "off" && numEls[k]) {
			numEls[k].value = Math.round(eff303[k] * 100);
		}
	}

	// ===== SMILEY =====
	const smiley = document.getElementById("smiley");
	if (!smiley) return;

	// Kick bounce
	const kickDelta = performance.now() - kickHitTime;
	const kickScale =
		kickDelta < 80 ? 1.08 : 1 + 0.08 * Math.max(0, 1 - (kickDelta - 80) / 120);
	smiley.setAttribute(
		"transform",
		"translate(" +
			CX +
			"," +
			CY +
			") scale(" +
			kickScale +
			") translate(" +
			-CX +
			"," +
			-CY +
			")"
	);

	const rNorm = eff303.rand;
	const qNorm = eff303.reso;
	const dNorm = eff303.dist;
	const anger = (rNorm + qNorm + dNorm) / 3;

	// Eyes — pupil drift from Random knob (capped to prevent brow overlap)
	const eyeL = document.getElementById("eyeL");
	const eyeR = document.getElementById("eyeR");
	if (eyeL && eyeR) {
		const drift = rNorm * 2;
		const now = performance.now();
		const dx = drift * (Math.sin(now * 0.007) + 0.3 * Math.sin(now * 0.023));
		const dy = drift * (Math.cos(now * 0.011) + 0.3 * Math.cos(now * 0.019));
		// Clamp vertical so eyes stay below brow zone
		const clampedDyL = Math.max(-2, dy);
		const clampedDyR = Math.max(-2, dy * 0.8);
		eyeL.setAttribute("cx", CX - 10 + dx);
		eyeL.setAttribute("cy", EYE_Y + clampedDyL);
		eyeR.setAttribute("cx", CX + 10 + dx * 0.7);
		eyeR.setAttribute("cy", EYE_Y + clampedDyR);
	}

	// Brows — from Resonance
	// At max: drop 3px (BROW_BASE_Y + 3 = CY-21), tilt 4px
	// Inner ends at CY-21+4 = CY-17. Eyes top at CY-9. Safe 8px gap.
	const browL = document.getElementById("browL");
	const browR = document.getElementById("browR");
	if (browL && browR) {
		const opacity = qNorm > 0.05 ? Math.min(1, qNorm * 2) : 0;
		browL.setAttribute("opacity", opacity);
		browR.setAttribute("opacity", opacity);
		// Activate CSS glitch animation when brows visible
		const glitchState = qNorm > 0.1 ? "running" : "paused";
		browL.style.animationPlayState = glitchState;
		browR.style.animationPlayState = glitchState;
		const drop = qNorm * 3;
		const tilt = qNorm * 4;
		// Left: outer end higher, inner end lower (angry V shape)
		browL.setAttribute("y1", BROW_BASE_Y + drop - tilt * 0.3);
		browL.setAttribute("y2", BROW_BASE_Y + drop + tilt);
		// Right: mirror
		browR.setAttribute("y1", BROW_BASE_Y + drop + tilt);
		browR.setAttribute("y2", BROW_BASE_Y + drop - tilt * 0.3);
	}

	// Mouth — Distortion: smile → flat → slight frown
	// Env Mod: opens the mouth and reveals pointy teeth
	const eNorm = eff303.env;
	const mouth = document.getElementById("mouth");
	const mouthFill = document.getElementById("mouthFill");
	const teethEl = document.getElementById("teeth");
	if (mouth && mouthFill && teethEl) {
		const halfW = 14;
		const ctrlY = CY + 22 - dNorm * 16; // distortion: smile → frown
		const opening = eNorm * 10; // how far the lower jaw drops (0..10px)

		// Upper lip (same as before)
		var upperD =
			"M " +
			(CX - halfW) +
			" " +
			MOUTH_Y +
			" Q " +
			CX +
			" " +
			ctrlY +
			" " +
			(CX + halfW) +
			" " +
			MOUTH_Y;

		// Lower lip — mirrors upper but drops down with env mod
		var lowerCtrlY = MOUTH_Y + opening * 1.2;
		var lowerD =
			" Q " + CX + " " + lowerCtrlY + " " + (CX - halfW) + " " + MOUTH_Y;

		// Outline = upper lip only when closed, full shape when open
		if (opening > 0.5) {
			// Filled open mouth
			mouthFill.setAttribute(
				"d",
				upperD + " L " + (CX + halfW) + " " + MOUTH_Y + lowerD + " Z"
			);
			mouth.setAttribute(
				"d",
				upperD + " L " + (CX + halfW) + " " + MOUTH_Y + lowerD + " Z"
			);
			mouth.setAttribute("fill", "none");

			// Teeth — zigzag triangles hanging from upper lip
			var teethD = "";
			var numTeeth = 5;
			var teethW = (halfW * 2) / numTeeth;
			var teethH = Math.min(opening * 0.8, 6); // tooth height scales with opening, max 6px
			// Compute y at each tooth x position along the upper quadratic bezier
			for (var ti = 0; ti < numTeeth; ti++) {
				var tLeft = CX - halfW + ti * teethW + 1;
				var tMid = tLeft + teethW / 2;
				var tRight = tLeft + teethW - 1;
				// approximate y on upper bezier at tMid
				var tParam = (tMid - (CX - halfW)) / (halfW * 2);
				var bezY =
					(1 - tParam) * (1 - tParam) * MOUTH_Y +
					2 * (1 - tParam) * tParam * ctrlY +
					tParam * tParam * MOUTH_Y;
				var baseY = bezY + 1;
				teethD +=
					"M " +
					tLeft +
					" " +
					baseY +
					" L " +
					tMid +
					" " +
					(baseY + teethH) +
					" L " +
					tRight +
					" " +
					baseY +
					" Z ";
			}
			teethEl.setAttribute("d", teethD);
			teethEl.setAttribute("opacity", Math.min(1, eNorm * 2));
		} else {
			// Closed mouth — just a line/curve
			mouthFill.setAttribute("d", "");
			mouth.setAttribute("d", upperD);
			mouth.setAttribute("fill", "none");
			teethEl.setAttribute("opacity", "0");
		}
	}

	// RGB glitch at high anger
	if (anger > 0.55) {
		const intensity = (anger - 0.55) / 0.45;
		const px = Math.round(intensity * 5);
		smiley.style.filter =
			"drop-shadow(" +
			px +
			"px 0 rgba(255,0,255," +
			intensity * 0.8 +
			")) " +
			"drop-shadow(" +
			-px +
			"px 0 rgba(0,255,255," +
			intensity * 0.8 +
			"))";
	} else {
		smiley.style.filter = "";
	}
}

// ============================================================
// BUILD CONTROLS
// ============================================================
function buildControls() {
	var container = document.getElementById("controls");
	var tpl = document.getElementById("track-row-tpl");
	tracks.forEach(function (track, idx) {
		var clone = tpl.content.cloneNode(true);
		var row = clone.querySelector(".track-row");
		row.querySelector(".label").textContent = track.name;
		row.querySelectorAll("[data-param]").forEach(function (el) {
			el.dataset.track = idx;
			var p = el.dataset.param;
			if (p === "n") {
				el.max = track.m;
				el.value = track.n;
			}
			if (p === "m") {
				el.value = track.m;
			}
			if (p === "off") {
				el.max = track.m - 1;
				el.value = track.offset;
			}
		});
		container.appendChild(clone);
	});
}

function syncParam(trackIdx, param, value) {
	const t = tracks[trackIdx];
	if (param === "m") {
		t.m = Math.max(4, Math.min(32, value));
		if (t.n > t.m) t.n = t.m;
		if (t.offset >= t.m) t.offset = 0;
	} else if (param === "off") {
		t.offset = Math.max(0, Math.min(t.m - 1, value));
	} else {
		t.n = Math.max(1, Math.min(t.m, value));
	}
	t.basePattern = bjorklund(t.n, t.m);
	t.pattern = rotatePattern(t.basePattern, t.offset);
	if (trackIdx === 4) generate303Offsets();
	const row = document.querySelectorAll(".track-row:not(.header)")[trackIdx];
	if (row) {
		row.querySelector('[data-param="n"][type="range"]').max = t.m;
		row.querySelector('[data-param="n"][type="number"]').max = t.m;
		row.querySelector('[data-param="n"][type="range"]').value = t.n;
		row.querySelector('[data-param="n"][type="number"]').value = t.n;
		row.querySelector('[data-param="m"][type="range"]').value = t.m;
		row.querySelector('[data-param="m"][type="number"]').value = t.m;
		row.querySelector('[data-param="off"][type="range"]').max = t.m - 1;
		row.querySelector('[data-param="off"][type="number"]').max = t.m - 1;
		row.querySelector('[data-param="off"][type="range"]').value = t.offset;
		row.querySelector('[data-param="off"][type="number"]').value = t.offset;
	}
	rebuildRingSVG();
}

// ============================================================
// MIXER
// ============================================================
function buildMixer() {
	var mixer = document.getElementById("mixer");
	var tpl = document.getElementById("fader-tpl");
	var masterTpl = document.getElementById("fader-master-tpl");
	for (var i = 0; i < 5; i++) {
		var clone = tpl.content.cloneNode(true);
		var fg = clone.querySelector(".fader-group");
		fg.querySelector("label").textContent = MIXER_LABELS[i];
		fg.querySelector(".vslider").dataset.fader = i;
		fg.querySelector('input[type="number"]').dataset.fader = i;
		fg.querySelector(".mute-btn").dataset.track = i;
		mixer.appendChild(clone);
	}
	var divider = document.createElement("div");
	divider.className = "mixer-divider";
	mixer.appendChild(divider);
	mixer.appendChild(masterTpl.content.cloneNode(true));
}

function setFaderValue(id, val) {
	val = Math.max(0, Math.min(100, val));
	const gain = val / 100;
	if (id === "master") {
		if (masterGain) masterGain.gain.value = gain;
	} else {
		const idx = parseInt(id);
		if (trackGains[idx]) trackGains[idx].gain.value = gain;
	}
}

// ============================================================
// EVENTS
// ============================================================
document.addEventListener("DOMContentLoaded", function () {
	buildSVG();
	buildControls();
	buildMixer();
	generate303Offsets();
	requestAnimationFrame(animate);

	document.getElementById("playBtn").addEventListener("click", function () {
		if (isPlaying) stopPlayback();
		else startPlayback();
	});

	var bpmR = document.getElementById("bpmRange");
	var bpmN = document.getElementById("bpmNum");
	bpmR.addEventListener("input", function () {
		bpm = +bpmR.value;
		bpmN.value = bpm;
	});
	bpmN.addEventListener("change", function () {
		bpm = Math.max(60, Math.min(180, +bpmN.value));
		bpmR.value = bpm;
		bpmN.value = bpm;
	});

	document.getElementById("controls").addEventListener("input", function (e) {
		if (!e.target.dataset.track) return;
		syncParam(+e.target.dataset.track, e.target.dataset.param, +e.target.value);
	});
	document.getElementById("controls").addEventListener("change", function (e) {
		if (!e.target.dataset.track || e.target.type !== "number") return;
		syncParam(+e.target.dataset.track, e.target.dataset.param, +e.target.value);
	});

	document.getElementById("mixer").addEventListener("click", function (e) {
		if (!e.target.classList.contains("mute-btn")) return;
		var idx = +e.target.dataset.track;
		tracks[idx].muted = !tracks[idx].muted;
		e.target.classList.toggle("muted", tracks[idx].muted);
	});

	function sync303(rangeEl, numEl, effKey, setter) {
		rangeEl.addEventListener("input", function () {
			var v = +rangeEl.value / 100;
			numEl.value = rangeEl.value;
			setter(v);
			eff303[effKey] = v;
		});
		numEl.addEventListener("change", function () {
			var v = Math.max(0, Math.min(100, +numEl.value));
			rangeEl.value = v;
			numEl.value = v;
			setter(v / 100);
			eff303[effKey] = v / 100;
		});
	}
	sync303(
		document.getElementById("k303rand"),
		document.getElementById("k303randN"),
		"rand",
		function (v) {
			p303rand = v;
			generate303Offsets();
		}
	);
	sync303(
		document.getElementById("k303reso"),
		document.getElementById("k303resoN"),
		"reso",
		function (v) {
			p303reso = v;
		}
	);
	sync303(
		document.getElementById("k303cut"),
		document.getElementById("k303cutN"),
		"cut",
		function (v) {
			p303cut = v;
		}
	);
	sync303(
		document.getElementById("k303env"),
		document.getElementById("k303envN"),
		"env",
		function (v) {
			p303env = v;
		}
	);
	sync303(
		document.getElementById("k303dist"),
		document.getElementById("k303distN"),
		"dist",
		function (v) {
			p303dist = v;
		}
	);

	// LFO selects — wave & duration
	document.getElementById("knobs303").addEventListener("change", function (e) {
		var grp = e.target.closest("[data-lfo]");
		if (!grp) return;
		var key = grp.dataset.lfo;
		if (e.target.classList.contains("lfo-wave")) {
			lfo303[key].wave = e.target.value;
		} else if (e.target.classList.contains("lfo-dur")) {
			lfo303[key].dur = parseInt(e.target.value);
		}
	});

	// Pointer override — bypass LFO while holding a 303 slider
	var lfoIdMap = {
		k303rand: "rand",
		k303reso: "reso",
		k303cut: "cut",
		k303env: "env",
		k303dist: "dist"
	};
	var activeOverride = null;
	document
		.getElementById("knobs303")
		.addEventListener("pointerdown", function (e) {
			if (e.target.type !== "range") return;
			var key = lfoIdMap[e.target.id];
			if (key) {
				override303[key] = true;
				activeOverride = key;
			}
		});
	document.addEventListener("pointerup", function () {
		if (activeOverride) {
			override303[activeOverride] = false;
			activeOverride = null;
		}
	});

	// Mixer events
	document.getElementById("mixer").addEventListener("input", function (e) {
		if (e.target.type !== "range") return;
		var id = e.target.dataset.fader;
		var val = +e.target.value;
		var numInput = e.target
			.closest(".fader-group")
			.querySelector('input[type="number"]');
		if (numInput) numInput.value = val;
		setFaderValue(id, val);
	});
	document.getElementById("mixer").addEventListener("change", function (e) {
		if (e.target.type !== "number") return;
		var id = e.target.dataset.fader;
		var val = Math.max(0, Math.min(100, +e.target.value));
		e.target.value = val;
		var rangeInput = e.target
			.closest(".fader-group")
			.querySelector('input[type="range"]');
		if (rangeInput) rangeInput.value = val;
		setFaderValue(id, val);
	});
});
