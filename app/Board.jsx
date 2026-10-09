"use client";
// A 65% mechanical keyboard that mirrors your real one: every key you press goes down on screen
// (and stays down while you hold it), with a synthesized switch sound, and what you type fills the
// text block above it. Keys can also be clicked.
// Keys are matched by KeyboardEvent.code, i.e. by physical position, so layout and Shift don't matter.
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, Lightformer, RoundedBox } from "@react-three/drei";
import gsap from "gsap";
import BROWN_CLIPS from "./gateron-brown.json";

const { damp } = THREE.MathUtils;
const U = 0.36, GAP = 0.035, CAP_H = 0.17, TRAVEL = 0.08, COLS = 16;

// rows of [legend, event.code, width in units]; every row is 16 units
const ROWS = [
  [["Esc", "Escape"], ["1", "Digit1"], ["2", "Digit2"], ["3", "Digit3"], ["4", "Digit4"], ["5", "Digit5"], ["6", "Digit6"], ["7", "Digit7"], ["8", "Digit8"], ["9", "Digit9"], ["0", "Digit0"], ["-", "Minus"], ["=", "Equal"], ["⌫", "Backspace", 2], ["`", "Backquote"]],
  [["Tab", "Tab", 1.5], ["Q", "KeyQ"], ["W", "KeyW"], ["E", "KeyE"], ["R", "KeyR"], ["T", "KeyT"], ["Y", "KeyY"], ["U", "KeyU"], ["I", "KeyI"], ["O", "KeyO"], ["P", "KeyP"], ["[", "BracketLeft"], ["]", "BracketRight"], ["\\", "Backslash", 1.5], ["Del", "Delete"]],
  [["Caps", "CapsLock", 1.75], ["A", "KeyA"], ["S", "KeyS"], ["D", "KeyD"], ["F", "KeyF"], ["G", "KeyG"], ["H", "KeyH"], ["J", "KeyJ"], ["K", "KeyK"], ["L", "KeyL"], [";", "Semicolon"], ["'", "Quote"], ["Enter", "Enter", 2.25], ["PgUp", "PageUp"]],
  [["Shift", "ShiftLeft", 2.25], ["Z", "KeyZ"], ["X", "KeyX"], ["C", "KeyC"], ["V", "KeyV"], ["B", "KeyB"], ["N", "KeyN"], ["M", "KeyM"], [",", "Comma"], [".", "Period"], ["/", "Slash"], ["Shift", "ShiftRight", 1.75], ["↑", "ArrowUp"], ["PgDn", "PageDown"]],
  [["Ctrl", "ControlLeft", 1.25], ["⌥", "AltLeft", 1.25], ["⌘", "MetaLeft", 1.25], ["", "Space", 6.25], ["⌘", "MetaRight"], ["⌥", "AltRight"], ["Fn", "Fn"], ["←", "ArrowLeft"], ["↓", "ArrowDown"], ["→", "ArrowRight"]],
];
const KEYS = ROWS.flatMap((row, r) => {
  let x = -COLS / 2;
  return row.map(([label, code, w = 1]) => { const k = { label, code, w, x: (x + w / 2) * U, z: (r - 2) * U }; x += w; return k; });
});
const BY_CODE = Object.fromEntries(KEYS.map((k) => [k.code, k]));
const ALIAS = { ControlRight: "ControlLeft", IntlBackslash: "Backquote", NumpadEnter: "Enter" };
const ACCENT = new Set(["Escape", "Enter", "Space"]);
const BIG = new Set(["Space", "Enter", "Backspace", "ShiftLeft", "ShiftRight", "CapsLock", "Tab"]);

// ---------------------------------------------------------------- switch sounds, synthesized (no audio files)
// Each profile builds a press and a release out of two primitives: a filtered noise burst (clicks,
// clacks, rattle) and a falling tone (the body of the switch and case).
const sound = { ctx: null, out: null, noise: null, mode: "brown" };
const SOUNDS = ["brown", "clicky", "off"], SOUND_NAME = { brown: "Gateron Brown", clicky: "Clicky", off: "Off" };
// Gateron Brown uses real recordings: 30 keystrokes cut from a royalty-free typing recording into one
// sprite (public/sounds/gateron-brown.mp3), each with a press and a release clip; 6 deeper ones for big keys.
const brown = { file: null, buffer: null, last: -1, held: {} };
if (typeof window !== "undefined") brown.file = fetch("/sounds/gateron-brown.mp3").then((r) => r.arrayBuffer()).catch(() => null);
async function brownBuffer(ctx) {
  if (brown.buffer || brown.decoding) return brown.buffer;
  brown.decoding = true;
  const data = await brown.file;
  if (data) brown.buffer = await ctx.decodeAudioData(data).catch(() => null);
  return brown.buffer;
}
function clip(ctx, [start, dur], rate, gain) {
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = brown.buffer; src.playbackRate.value = rate; g.gain.value = gain;
  src.connect(g).connect(sound.out); src.start(ctx.currentTime, start, dur);
}
// press: a random recorded stroke (never the same one twice in a row); release: that stroke's own release
function brownSample(ctx, code, down, big) {
  if (down) {
    const pool = BROWN_CLIPS.map((c, i) => i).filter((i) => BROWN_CLIPS[i].big === big && i !== brown.last);
    const i = pool[Math.floor(Math.random() * pool.length)], rate = 0.96 + Math.random() * 0.08;
    brown.last = i; brown.held[code] = { i, rate };
    clip(ctx, BROWN_CLIPS[i].down, rate, 1);
  } else {
    const h = brown.held[code]; if (!h) return;
    delete brown.held[code];
    clip(ctx, BROWN_CLIPS[h.i].up, h.rate, 0.75);
  }
}

function audio() {
  if (!sound.ctx) {
    const ctx = new AudioContext(), out = ctx.createGain(), soft = ctx.createBiquadFilter();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    soft.type = "lowpass"; soft.frequency.value = 7000;   // takes the digital edge off everything
    out.gain.value = 0.6; out.connect(soft).connect(ctx.destination);
    Object.assign(sound, { ctx, out, noise: buf });
  }
  if (sound.ctx.state === "suspended") sound.ctx.resume();
  return sound.ctx;
}
function burst(ctx, t, { freq, q = 1, gain, decay }) {
  const n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  n.buffer = sound.noise; f.type = "bandpass"; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  n.connect(f).connect(g).connect(sound.out); n.start(t); n.stop(t + decay + 0.02);
}
function tone(ctx, t, { from, to, gain, decay, wave = "sine" }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = wave; o.frequency.setValueAtTime(from, t); o.frequency.exponentialRampToValueAtTime(to, t + decay);
  g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0008, t + decay);
  o.connect(g).connect(sound.out); o.start(t); o.stop(t + decay + 0.02);
}

const PROFILES = {
  // synthesized Gateron Brown (only until the recording has loaded): tactile, no click. A faint bump before bottom-out, a muted rounded clack with a low
  // housing thock, then on release the stem snapping back and Gateron's light spring ping.
  brown: {
    down(ctx, t, big, j) {
      burst(ctx, t, { freq: 1900 * j, q: 2, gain: 0.08, decay: 0.008 });                         // tactile bump
      const b = t + 0.014;                                                                        // bottom-out
      burst(ctx, b, { freq: (big ? 750 : 1150) * j, q: 0.8, gain: 0.5, decay: big ? 0.05 : 0.032 }); // muted clack
      burst(ctx, b, { freq: big ? 320 : 460, q: 1.4, gain: 0.22, decay: big ? 0.09 : 0.06 });      // housing thock
      tone(ctx, b, { from: (big ? 125 : 175) * j, to: big ? 70 : 95, gain: 0.3, decay: big ? 0.08 : 0.05 });
      if (big) burst(ctx, b + 0.007, { freq: 680 * j, q: 3, gain: 0.12, decay: 0.03 });            // stabilizer rattle
    },
    up(ctx, t, big, j) {
      burst(ctx, t, { freq: (big ? 1500 : 2300) * j, q: 1.2, gain: 0.16, decay: 0.02 });           // stem returns
      tone(ctx, t + 0.004, { from: 3900 * j, to: 3600 * j, gain: 0.014, decay: 0.05 });             // spring ping
    },
  },
  // the earlier, brighter sound: a sharp click and a punchy thock
  clicky: {
    down(ctx, t, big, j) {
      burst(ctx, t, { freq: 2600 * (big ? 0.55 : 1) * j, q: 1.1, gain: 0.6, decay: big ? 0.07 : 0.04 });
      tone(ctx, t, { from: (big ? 120 : 190) * j, to: big ? 60 : 100, gain: 0.45, decay: big ? 0.11 : 0.06, wave: "triangle" });
    },
    up(ctx, t, big, j) {
      burst(ctx, t, { freq: 4200 * (big ? 0.55 : 1) * j, q: 1.1, gain: 0.22, decay: big ? 0.07 : 0.04 });
      tone(ctx, t, { from: (big ? 190 : 300) * j, to: big ? 60 : 100, gain: 0.1, decay: 0.06, wave: "triangle" });
    },
  },
};

function thock(code, down) {
  const profile = PROFILES[sound.mode];
  if (!profile) return;
  const ctx = audio(), j = 0.92 + Math.random() * 0.16;   // a little variation so repeats don't sound robotic
  if (sound.mode === "brown") {
    if (brown.buffer) return brownSample(ctx, code, down, BIG.has(code));
    brownBuffer(ctx);   // first press: start decoding, use the synthesized Brown until it's ready
  }
  profile[down ? "down" : "up"](ctx, ctx.currentTime, BIG.has(code), j);
}

// keycap legend, drawn on a canvas in the site font
function legend(k, light) {
  const c = document.createElement("canvas"), px = 128;
  c.width = px * k.w; c.height = px;
  const g = c.getContext("2d");
  g.fillStyle = light ? "#1a1a1a" : "#c4c4c4";
  g.textBaseline = "top";
  g.font = `600 ${k.label.length > 2 ? 26 : 50}px ${getComputedStyle(document.body).fontFamily}`;
  g.fillText(k.label, 18, 14);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function Key({ k, st, api }) {
  const cap = useRef(), glow = useRef(), mat = useRef(), light = ACCENT.has(k.code);
  const tex = useMemo(() => legend(k, light), [k, light]);
  const w = k.w * U - GAP, d = U - GAP;
  useFrame((_, dt) => {
    const s = st.keys[k.code];
    cap.current.position.y = damp(cap.current.position.y, -s.press * TRAVEL + s.wave * 0.035, 22, dt);
    const heat = Math.min(1, s.press * 0.9 + Math.max(0, s.wave) * 0.6 + s.flash);
    glow.current.material.opacity = damp(glow.current.material.opacity, 0.04 + heat, 14, dt);
    mat.current.emissiveIntensity = damp(mat.current.emissiveIntensity, s.press * (light ? 0.25 : 0.1), 14, dt);
    s.flash = damp(s.flash, 0, 2.5, dt);   // a pressed key's light fades out slowly after release
  });
  return (
    <group position={[k.x, 0, k.z]}>
      <mesh ref={glow} position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w + 0.12, d + 0.12]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.04} toneMapped={false} />
      </mesh>
      <group ref={cap}>
        <RoundedBox
          args={[w, CAP_H, d]} radius={0.035} smoothness={3} position={[0, CAP_H / 2 + 0.03, 0]}
          onPointerDown={(e) => { e.stopPropagation(); api.down(k.code); }}
          onPointerUp={() => api.up(k.code)}
          onPointerOut={() => api.up(k.code)}
          onPointerOver={() => (document.body.style.cursor = "pointer")}
          onPointerLeave={() => (document.body.style.cursor = "")}
        >
          <meshStandardMaterial ref={mat} color={light ? "#d6d6d6" : "#1c1c1c"} emissive="#ffffff" emissiveIntensity={0} metalness={0.1} roughness={light ? 0.45 : 0.6} />
        </RoundedBox>
        <mesh position={[0, CAP_H + 0.031, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[w - 0.04, d - 0.04]} />
          <meshBasicMaterial map={tex} transparent toneMapped={false} />
        </mesh>
      </group>
    </group>
  );
}

function Keyboard({ st }) {
  const root = useRef();
  const reduce = useMemo(() => matchMedia("(prefers-reduced-motion: reduce)").matches, []);
  useFrame((state, dt) => {
    const { pointer, viewport } = state, r = root.current, t = state.clock.elapsedTime;
    const fit = Math.min(1, (viewport.width * 0.9) / (COLS * U + 0.3), (viewport.height * 0.6) / (5 * U * 2.1));
    r.scale.setScalar(damp(r.scale.x, fit, 4, dt));
    r.position.y = damp(r.position.y, -viewport.height * 0.17 + (reduce ? 0 : Math.sin(t * 0.8) * 0.05), 4, dt);
    r.rotation.x = damp(r.rotation.x, 0.82 - pointer.y * 0.12, 4, dt);
    r.rotation.y = damp(r.rotation.y, pointer.x * 0.18, 4, dt);
  });
  return (
    <group ref={root} scale={0.001}>
      <RoundedBox args={[COLS * U + 0.22, 0.24, 5 * U + 0.22]} radius={0.06} smoothness={4} position={[0, -0.1, 0]}>
        <meshStandardMaterial color="#2a2a2a" metalness={0.85} roughness={0.35} />
      </RoundedBox>
      <mesh position={[0, 0.021, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[COLS * U + 0.02, 5 * U + 0.02]} />
        <meshStandardMaterial color="#0d0d0d" metalness={0.3} roughness={0.8} />
      </mesh>
      {KEYS.map((k) => <Key key={k.code} k={k} st={st} api={st.api} />)}
    </group>
  );
}

// clicking a toolbar button must not focus it, or the next Enter you type would press it again
const keepFocus = (e) => e.preventDefault();

export default function Board() {
  const [ready, setReady] = useState(false), [soundMode, setSoundMode] = useState("brown"), [typed, setTyped] = useState("");
  const st = useRef(null), textBox = useRef();
  useEffect(() => { const el = textBox.current; if (el) el.scrollTop = el.scrollHeight; }, [typed]);   // keep the newest line in view
  if (!st.current) {
    const keys = Object.fromEntries(KEYS.map((k) => [k.code, { press: 0, wave: 0, flash: 0, held: false }]));
    const reduce = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const api = {
      down(code) {
        const k = BY_CODE[ALIAS[code] || code], s = k && keys[k.code];
        if (!s || s.held) return;
        s.held = true; s.flash = 1;
        gsap.to(s, { press: 1, duration: 0.05, ease: "power2.in", overwrite: true });
        thock(k.code, true);
        if (!reduce) KEYS.forEach((q) => {   // ripple outward from the key
          if (q === k) return;
          const dist = Math.hypot(q.x - k.x, q.z - k.z), w = keys[q.code];
          if (dist > 2.2) return;
          gsap.timeline({ delay: dist * 0.1 }).to(w, { wave: 0.8 - dist / 2.8, duration: 0.08 }).to(w, { wave: 0, duration: 0.5, ease: "elastic.out(1, 0.35)" });
        });
      },
      up(code) {
        const k = BY_CODE[ALIAS[code] || code], s = k && keys[k.code];
        if (!s || !s.held) return;
        s.held = false;
        gsap.to(s, { press: 0, duration: 0.45, ease: "elastic.out(1, 0.45)", overwrite: true });
        thock(k.code, false);
      },
      releaseAll() { KEYS.forEach((k) => api.up(k.code)); },
    };
    st.current = { keys, api };
  }

  useEffect(() => { document.fonts.ready.then(() => setReady(true)); }, []);   // legends need the web font
  useEffect(() => { sound.mode = soundMode; }, [soundMode]);
  useEffect(() => {
    const { api } = st.current;
    const down = (e) => {
      // let browser shortcuts (⌘R, ⌘T…) through; stop keys that would scroll, tab away or go back
      if (!e.metaKey && !e.ctrlKey && ["Space", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown", "Backspace", "Quote", "Slash"].includes(e.code)) e.preventDefault();
      api.down(e.code);
      if (e.metaKey || e.ctrlKey) return;
      if (e.key.length === 1) setTyped((s) => s + e.key);
      else if (e.key === "Backspace") setTyped((s) => s.slice(0, -1));
      else if (e.key === "Enter") setTyped((s) => s + "\n");
      else if (e.key === "Tab") setTyped((s) => s + "  ");
    };
    const up = (e) => {
      api.up(e.code);
      if (e.key === "Meta") api.releaseAll();   // macOS swallows key-ups while ⌘ is held
    };
    addEventListener("keydown", down); addEventListener("keyup", up); addEventListener("blur", api.releaseAll);
    return () => { removeEventListener("keydown", down); removeEventListener("keyup", up); removeEventListener("blur", api.releaseAll); };
  }, []);

  return (
    <div className="kb-page">
      <div className="kb-tools">
        <button type="button" onMouseDown={keepFocus} onClick={() => setTyped("")}>Clear</button>
        <button type="button" title="Switch sound" onMouseDown={keepFocus} onClick={() => setSoundMode((m) => SOUNDS[(SOUNDS.indexOf(m) + 1) % SOUNDS.length])}>Sound: {SOUND_NAME[soundMode]}</button>
      </div>
      <div ref={textBox} className="kb-text" aria-live="polite" aria-label="What you typed">
        {typed || <span className="kb-placeholder">Start typing…</span>}<span className="kb-caret" />
      </div>
      <Canvas camera={{ position: [0, 0, 7], fov: 40 }} dpr={[1, 2]} gl={{ antialias: true }} style={{ pointerEvents: "auto" }} onPointerUp={() => st.current.api.releaseAll()}>
        <color attach="background" args={["#0a0a0a"]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[2, 6, 4]} intensity={1.3} />
        {ready && <Keyboard st={st.current} />}
        <Environment resolution={256}>
          <Lightformer form="rect" intensity={2.5} position={[0, 5, -2]} scale={[10, 2, 1]} />
          <Lightformer form="rect" intensity={1.2} position={[-5, 1, 2]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} />
          <Lightformer form="ring" intensity={1.5} position={[0, 0, 6]} scale={3} />
        </Environment>
      </Canvas>
    </div>
  );
}
