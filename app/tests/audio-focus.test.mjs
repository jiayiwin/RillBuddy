// Uses Node's real Web Locks and BroadcastChannel across isolated window contexts.
// Run with Node >=24: node --test tests/audio-focus.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { locks } from "node:worker_threads";
import { webcrypto } from "node:crypto";
import { test } from "node:test";
import ts from "typescript";

const code = ts.transpileModule(readFileSync(new URL("../src/audio-focus.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const ambienceCode = ts.transpileModule(readFileSync(new URL("../src/ambience.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const storage = new Map();
const delay = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function page() {
  const channels = [];
  let push;
  const win = new EventTarget();
  Object.assign(win, { setTimeout, clearTimeout });
  const context = vm.createContext({
    exports: {}, window: win, navigator: { locks }, crypto: webcrypto,
    Event, setTimeout, clearTimeout,
    localStorage: { setItem: (k, v) => storage.set(k, v), getItem: (k) => storage.get(k) ?? null, removeItem: (k) => storage.delete(k) },
    BroadcastChannel: class extends BroadcastChannel {
      constructor(name) { super(name); channels.push(this); }
    },
    require: () => ({
      inTauri: false, connect: async () => ({}),
      getJson: async () => ({ sounds: true, focus: false }),
      subscribe: (_c, cb) => { push = cb; },
    }),
  });
  vm.runInContext(code, context);
  const focusExports = context.exports;
  return {
    Focus: focusExports.AudioFocus,
    interrupt: (owner) => channels[0].postMessage({ type: "interrupt", owner }),
    ambience(decode = async () => ({})) {
      const counts = { starts: 0, stops: 0 };
      context.AudioContext = class {
        state = "suspended";
        currentTime = 0;
        destination = {};
        async resume() { this.state = "running"; }
        async suspend() { this.state = "suspended"; }
        decodeAudioData = decode;
        createBufferSource() {
          return { connect: (n) => n, disconnect() {}, start() { counts.starts++; }, stop() { counts.stops++; } };
        }
        createGain() {
          return { connect() {}, disconnect() {}, gain: { value: 0, linearRampToValueAtTime() {}, cancelAndHoldAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} } };
        }
      };
      context.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
      context.require = () => focusExports;
      context.exports = {};
      vm.runInContext(ambienceCode, context);
      return { player: new context.exports.Ambience(), counts };
    },
    mute: () => push("world.state", { sounds: false, focus: false }),
    close: () => { win.dispatchEvent(new Event("pagehide")); channels.forEach((c) => c.close()); },
  };
}

test("background ambience and alerts yield to radio in another window", async () => {
  const a = page(), b = page();
  try {
    let radioStops = 0;
    const radio = new a.Focus("radio", () => { radioStops++; });
    const ambience = new b.Focus("rain", () => {});
    assert.equal(await radio.acquire(), true);
    assert.equal(await ambience.acquire("background"), false);
    assert.equal(await ambience.acquire("effect"), false);
    assert.equal(radioStops, 0);
    assert.equal(radio.held, true);
    await radio.stop();
    assert.equal(await ambience.acquire("background"), true);
  } finally { a.close(); b.close(); }
});

test("a new player waits for asynchronous silence before obtaining the lock", async () => {
  const a = page(), b = page();
  try {
    let silent;
    const radio = new a.Focus("radio", () => new Promise((r) => { silent ??= r; }));
    const music = new b.Focus("music", () => {});
    assert.equal(await radio.acquire(), true);
    let acquired = false;
    const pending = music.acquire().then((ok) => (acquired = ok));
    await delay(100);
    assert.equal(acquired, false);
    assert.ok(silent);
    silent();
    await pending;
    assert.equal(acquired, true);
    assert.equal(radio.held, false);
    assert.equal(music.held, true);
  } finally { a.close(); b.close(); }
});

test("cancelling a pending request prevents late playback", async () => {
  const a = page(), b = page();
  try {
    let silent;
    const old = new a.Focus("old", () => new Promise((r) => { silent ??= r; }));
    const next = new b.Focus("next", () => {});
    await old.acquire();
    const pending = next.acquire();
    await delay(90);
    await next.stop();
    silent();
    assert.equal(await pending, false);
    assert.equal(next.held, false);
  } finally { a.close(); b.close(); }
});

test("same-page sources are exclusive and muting cancels playback", async () => {
  const p = page();
  try {
    const rain = new p.Focus("rain", () => {});
    const song = new p.Focus("song", () => {});
    await rain.acquire("background");
    assert.equal(await song.acquire(), true);
    assert.equal(rain.held, false);
    assert.equal(song.held, true);
    p.mute();
    await delay();
    assert.equal(song.held, false);
    assert.equal(await rain.acquire("background"), false);
    assert.equal(await song.acquire(), false);
  } finally { p.close(); }
});

test("rapid competing requests leave at most one owner", async () => {
  const a = page(), b = page();
  try {
    const radio = new a.Focus("radio", () => {});
    const music = new b.Focus("music", () => {});
    await Promise.all([radio.acquire(), music.acquire()]);
    await delay(120);
    assert.ok(Number(radio.held) + Number(music.held) <= 1);
    await radio.stop();
    await music.stop();
    assert.equal(await radio.acquire(), true);
  } finally { a.close(); b.close(); }
});

test("stopping ambience during decoding cannot start sound later", async () => {
  const p = page();
  try {
    let decoded;
    const { player, counts } = p.ambience(() => new Promise((r) => { decoded = r; }));
    const pending = player.start("rain", 0.25, undefined, true);
    await delay();
    assert.ok(decoded);
    player.stop();
    await delay();
    decoded({});
    await pending;
    assert.equal(counts.starts, 0);
    assert.equal(player.playing, false);
  } finally { p.close(); }
});

test("world refreshes do not restart ambience, and radio stops its actual source", async () => {
  const a = page(), b = page();
  try {
    const { player, counts } = a.ambience();
    await player.start("wind");
    await player.start("wind", 0.4);
    assert.equal(counts.starts, 1);
    const radio = new b.Focus("radio", () => {});
    await radio.acquire();
    assert.equal(counts.stops, 1);
    assert.equal(player.playing, false);
    await player.start("wind");
    assert.equal(counts.starts, 1);
    await radio.stop();
    await player.start("wind");
    assert.equal(counts.starts, 2);
  } finally { a.close(); b.close(); }
});

test("an old stop message cannot stop a newer play of the same source", async () => {
  const a = page(), b = page();
  try {
    const radio = new a.Focus("radio", () => {});
    await radio.acquire();
    const old = radio.lease;
    await radio.stop();
    await radio.acquire();
    assert.notEqual(radio.lease, old);
    b.interrupt(old);
    await delay();
    assert.equal(radio.held, true);
  } finally { a.close(); b.close(); }
});

test("stop while changing an ambience cancels the pending change", async () => {
  const p = page();
  try {
    const { player, counts } = p.ambience();
    await player.start("wind");
    const pending = player.start("rain", 0.25, undefined, true);
    await delay(10);
    player.stop();
    await pending;
    assert.equal(counts.starts, 1);
    assert.equal(player.playing, false);
  } finally { p.close(); }
});
