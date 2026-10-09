const STORAGE_KEY = "bgm-paused";
const VOLUME = 0.38;

let initialized = false;
let playing = false;
let fade = 0;
let raf = 0;
let lastTs = 0;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Uint8Array | null = null;

export function initAmbientEffects() {
	if (initialized) return;
	initialized = true;

	const root = document.getElementById("ambient-root");
	const audio = document.getElementById(
		"bgm-audio",
	) as HTMLAudioElement | null;
	const toggle = document.getElementById(
		"bgm-toggle",
	) as HTMLButtonElement | null;
	const canvas = document.getElementById(
		"bgm-wave-canvas",
	) as HTMLCanvasElement | null;
	const layer = document.getElementById("click-burst-layer");
	if (!root || !audio || !toggle || !canvas || !layer) return;

	let iconSrcs: string[] = [];
	try {
		iconSrcs = JSON.parse(root.dataset.iconSrcs ?? "[]");
	} catch {
		iconSrcs = [];
	}

	audio.volume = VOLUME;
	iconSrcs.forEach((src) => {
		const img = new Image();
		img.src = src;
	});

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	let detachAutoplay = () => {};

	const reduced = () =>
		window.matchMedia("(prefers-reduced-motion: reduce)").matches;

	const isDark = () => document.documentElement.classList.contains("dark");

	function resizeCanvas() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		const width = window.innerWidth;
		const height = window.innerHeight;
		canvas.width = Math.floor(width * dpr);
		canvas.height = Math.floor(height * dpr);
		canvas.style.width = `${width}px`;
		canvas.style.height = `${height}px`;
	}

	function ensureGraph() {
		if (audioCtx || !audio) return;
		audioCtx = new AudioContext();
		analyser = audioCtx.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.84;
		const source = audioCtx.createMediaElementSource(audio);
		source.connect(analyser);
		analyser.connect(audioCtx.destination);
		freqData = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
	}

	function sampleEnergy(): number {
		if (!analyser || !freqData) return 0.32;
		analyser.getByteFrequencyData(
			freqData as unknown as Uint8Array<ArrayBuffer>,
		);
		let sum = 0;
		const n = Math.min(20, freqData.length);
		for (let i = 0; i < n; i++) sum += freqData[i];
		return sum / (n * 255);
	}

	function setPlaying(next: boolean) {
		playing = next;
		toggle.classList.toggle("is-playing", next);
		toggle.setAttribute("aria-pressed", next ? "true" : "false");
		toggle.setAttribute("aria-label", next ? "暂停背景音乐" : "播放背景音乐");
		startLoop();
	}

	async function play() {
		try {
			ensureGraph();
			if (audioCtx && audioCtx.state === "suspended") {
				await audioCtx.resume();
			}
			await audio.play();
			localStorage.setItem(STORAGE_KEY, "0");
			setPlaying(true);
		} catch {
			setPlaying(false);
		}
	}

	function pause() {
		audio.pause();
		localStorage.setItem(STORAGE_KEY, "1");
		setPlaying(false);
		detachAutoplay();
	}

	function draw(ts: number) {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
		if (fade < 0.01) return;

		const rect = toggle.getBoundingClientRect();
		const cx = rect.left + rect.width / 2;
		const cy = rect.top + rect.height / 2;
		const energy = sampleEnergy();
		const pink = isDark() ? "249, 168, 212" : "236, 72, 153";
		const glowR = 118 + energy * 36;

		const glow = ctx.createRadialGradient(cx, cy, 12, cx, cy, glowR);
		glow.addColorStop(0, `rgba(${pink}, ${0.1 * fade + energy * 0.06 * fade})`);
		glow.addColorStop(1, `rgba(${pink}, 0)`);
		ctx.fillStyle = glow;
		ctx.beginPath();
		ctx.arc(cx, cy, glowR, 0, Math.PI * 2);
		ctx.fill();

		for (let i = 0; i < 4; i++) {
			const baseR = 38 + i * 20 + energy * 16;
			const amp = 3.8 + energy * 7 + i * 0.55;
			const alpha = (0.24 - i * 0.04) * (0.42 + energy * 0.58) * fade;
			ctx.beginPath();
			ctx.strokeStyle = `rgba(${pink}, ${alpha})`;
			ctx.lineWidth = i === 0 ? 1.55 : 1.15;
			const ticks = 96;
			for (let k = 0; k <= ticks; k++) {
				const a = (k / ticks) * Math.PI * 2;
				const wobble =
					Math.sin(a * (6 + i) + ts * 0.0034 + i * 1.1) * amp +
					Math.sin(a * 3.2 - ts * 0.0022 + i * 0.6) * amp * 0.38;
				const r = baseR + wobble;
				const x = cx + Math.cos(a) * r;
				const y = cy + Math.sin(a) * r;
				if (k === 0) ctx.moveTo(x, y);
				else ctx.lineTo(x, y);
			}
			ctx.closePath();
			ctx.stroke();
		}
	}

	function startLoop() {
		if (raf) return;
		lastTs = performance.now();
		const tick = (ts: number) => {
			const dt = Math.min(40, ts - lastTs);
			lastTs = ts;
			const target = playing && !document.hidden ? 1 : 0;
			fade += (target - fade) * (1 - Math.exp(-dt / 160));
			if (fade < 0.002 && target === 0) {
				fade = 0;
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.clearRect(0, 0, canvas.width, canvas.height);
				raf = 0;
				return;
			}
			if (!reduced()) draw(ts);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
	}

	function burst(x: number, y: number) {
		if (reduced() || iconSrcs.length === 0) return;
		while (layer.childElementCount > 64) {
			layer.firstElementChild?.remove();
		}

		const ring = document.createElement("span");
		ring.className = "click-burst-ring";
		ring.style.left = `${x}px`;
		ring.style.top = `${y}px`;
		layer.appendChild(ring);
		ring
			.animate(
				[
					{ transform: "translate(-50%, -50%) scale(0.4)", opacity: 0.75 },
					{ transform: "translate(-50%, -50%) scale(2.35)", opacity: 0 },
				],
				{
					duration: 920,
					easing: "cubic-bezier(0.16, 0.78, 0.28, 1)",
					fill: "forwards",
				},
			)
			.finished.then(() => ring.remove())
			.catch(() => ring.remove());

		const stickerCount = 3 + Math.floor(Math.random() * 3);
		const picked = pickIcons(iconSrcs, stickerCount);
		for (let i = 0; i < picked.length; i++) {
			const src = picked[i];
			if (!src) continue;
			const el = document.createElement("img");
			el.src = src;
			el.alt = "";
			el.draggable = false;
			el.className = "click-burst-sticker";
			const size = 25 + Math.round(Math.random() * 15);
			el.style.left = `${x}px`;
			el.style.top = `${y}px`;
			el.style.width = `${size}px`;
			el.style.height = `${size}px`;
			layer.appendChild(el);

			const angle =
				(Math.PI * 2 * i) / picked.length + (Math.random() - 0.5) * 0.85;
			const dist = 56 + Math.random() * 46;
			const spin = (Math.random() - 0.5) * 150;
			const drift = (Math.random() - 0.5) * 18;
			const dx = Math.cos(angle) * dist + drift;
			const dy = Math.sin(angle) * dist - 16;
			const dur = 1480 + Math.random() * 420;
			const delay = Math.random() * 70;
			el.animate(
				[
					{
						transform: "translate(-50%, -50%) scale(0.16) rotate(0deg)",
						opacity: 1,
					},
					{
						transform: `translate(calc(-50% + ${dx * 0.38}px), calc(-50% + ${dy * 0.38}px)) scale(1.28) rotate(${spin * 0.35}deg)`,
						opacity: 1,
						offset: 0.16,
					},
					{
						transform: `translate(calc(-50% + ${dx * 0.82}px), calc(-50% + ${dy * 0.78}px)) scale(1.04) rotate(${spin * 0.75}deg)`,
						opacity: 1,
						offset: 0.42,
					},
					{
						transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 8}px)) scale(0.96) rotate(${spin}deg)`,
						opacity: 1,
						offset: 0.72,
					},
					{
						transform: `translate(calc(-50% + ${dx * 1.08}px), calc(-50% + ${dy - 22}px)) scale(0.82) rotate(${spin * 1.12}deg)`,
						opacity: 0,
					},
				],
				{
					duration: dur,
					delay,
					easing: "cubic-bezier(0.16, 0.72, 0.22, 1)",
					fill: "forwards",
				},
			)
				.finished.then(() => el.remove())
				.catch(() => el.remove());
		}

		const sparkleCount = 7 + Math.floor(Math.random() * 4);
		const kinds = ["is-dot", "is-diamond", "is-plus"] as const;
		for (let i = 0; i < sparkleCount; i++) {
			const sparkle = document.createElement("span");
			sparkle.className = `click-burst-sparkle ${kinds[i % kinds.length]}`;
			sparkle.style.left = `${x}px`;
			sparkle.style.top = `${y}px`;
			layer.appendChild(sparkle);
			const angle = Math.random() * Math.PI * 2;
			const dist = 42 + Math.random() * 56;
			const dx = Math.cos(angle) * dist;
			const dy = Math.sin(angle) * dist - 12;
			const dur = 1180 + Math.random() * 360;
			sparkle
				.animate(
					[
						{ transform: "translate(-50%, -50%) scale(0.35)", opacity: 1 },
						{
							transform: `translate(calc(-50% + ${dx * 0.7}px), calc(-50% + ${dy * 0.7}px)) scale(1.05)`,
							opacity: 1,
							offset: 0.45,
						},
						{
							transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy - 10}px)) scale(0.35)`,
							opacity: 0,
						},
					],
					{
						duration: dur,
						delay: Math.random() * 80,
						easing: "cubic-bezier(0.12, 0.78, 0.26, 1)",
						fill: "forwards",
					},
				)
				.finished.then(() => sparkle.remove())
				.catch(() => sparkle.remove());
		}
	}

	toggle.addEventListener("click", (event) => {
		event.stopPropagation();
		if (audio.paused) {
			play();
		} else {
			pause();
		}
		if (!reduced()) burst(event.clientX, event.clientY);
	});

	document.addEventListener("click", (event) => {
		if (event.button !== 0) return;
		const target = event.target;
		if (
			target instanceof Element &&
			target.closest("input, textarea, select, [contenteditable='true']")
		) {
			return;
		}
		burst(event.clientX, event.clientY);
	});

	audio.addEventListener("play", () => setPlaying(true));
	audio.addEventListener("pause", () => {
		if (audio.ended) return;
		setPlaying(false);
	});

	const unlockEvents = [
		"pointerdown",
		"pointermove",
		"mousemove",
		"touchstart",
		"keydown",
		"wheel",
	] as const;

	const tryAutoplay = (event?: Event) => {
		if (localStorage.getItem(STORAGE_KEY) === "1") {
			detachAutoplay();
			return;
		}
		if (!audio.paused) {
			detachAutoplay();
			return;
		}
		const target = event?.target;
		if (target instanceof Node && toggle.contains(target)) return;
		play();
	};

	const onStarted = () => {
		if (!audio.paused) detachAutoplay();
	};

	detachAutoplay = () => {
		for (const ev of unlockEvents) {
			window.removeEventListener(ev, tryAutoplay);
		}
		audio.removeEventListener("canplay", tryAutoplay);
		audio.removeEventListener("play", onStarted);
	};

	for (const ev of unlockEvents) {
		window.addEventListener(ev, tryAutoplay, { passive: true });
	}
	audio.addEventListener("canplay", tryAutoplay);
	audio.addEventListener("play", onStarted);

	resizeCanvas();
	window.addEventListener("resize", resizeCanvas);
	document.addEventListener("visibilitychange", () => {
		if (!document.hidden && playing) startLoop();
		if (!document.hidden) tryAutoplay();
	});

	if (localStorage.getItem(STORAGE_KEY) !== "1") {
		play();
		window.setTimeout(tryAutoplay, 250);
		window.setTimeout(tryAutoplay, 1200);
	}
}

function pickIcons(pool: string[], count: number): string[] {
	if (pool.length === 0) return [];
	const copy = pool.slice();
	for (let i = copy.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const tmp = copy[i];
		copy[i] = copy[j];
		copy[j] = tmp;
	}
	if (count <= copy.length) return copy.slice(0, count);
	const extra: string[] = [];
	for (let i = copy.length; i < count; i++) {
		extra.push(pool[Math.floor(Math.random() * pool.length)]);
	}
	return copy.concat(extra);
}
