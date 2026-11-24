const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const flowPath = path.join(__dirname, "..", "flows", "flow_vision.json");
const nodes = JSON.parse(fs.readFileSync(flowPath, "utf8"));
const byId = new Map(nodes.map((node) => [node.id, node]));

function harness(initialFlow = {}, initialGlobal = {}, initialTime = 10000) {
  const flowState = new Map(Object.entries(initialFlow));
  const globalState = new Map(Object.entries(initialGlobal));
  const contextState = new Map();
  let now = initialTime;

  const flow = {
    get: (key) => flowState.get(key),
    set: (key, value) => flowState.set(key, value),
  };
  const global = {
    get: (key) => globalState.get(key),
    set: (key, value) => globalState.set(key, value),
  };
  const context = {
    get: (key) => contextState.get(key),
    set: (key, value) => contextState.set(key, value),
  };
  const node = { status() {}, warn() {}, send() {} };
  const FakeDate = class extends Date {
    static now() {
      return now;
    }
  };

  function run(id, msg) {
    const source = byId.get(id);
    assert.ok(source, `Missing flow node: ${id}`);
    const code = source.func || "";
    const runFunction = vm.runInNewContext(`(function (msg) {\n${code}\n})`, {
      Date: FakeDate,
      Math,
      Number,
      clearTimeout() {},
      context,
      flow,
      global,
      isNaN,
      node,
      setTimeout() {
        return 1;
      },
    });
    return runFunction(msg);
  }

  return {
    flowState,
    globalState,
    run,
    setTime(value) {
      now = value;
    },
  };
}

function publishVision(testHarness, detectado, x, count = 3) {
  for (let index = 0; index < count; index += 1) {
    testHarness.run("6f14ca56b0b07cf8", {
      payload: { detectado, x, area: 0.02, modo: "color" },
    });
  }
}

test("flow has unique node IDs and valid wire targets", () => {
  assert.equal(byId.size, nodes.length);
  for (const node of nodes) {
    for (const output of node.wires || []) {
      for (const target of output) {
        assert.ok(byId.has(target), `${node.id} -> ${target}`);
        assert.equal(byId.get(target).z, node.z, `${node.id} crosses tabs directly to ${target}`);
      }
    }
  }
  assert.ok(byId.get("vision-follow-out").links.includes("vision-follow-in"));
  assert.ok(byId.get("vision-follow-in").links.includes("vision-follow-out"));
  assert.deepEqual(byId.get("vision-follow-in").wires, [["vision-follow"]]);
});

test("dashboard template JavaScript parses", () => {
  const template = byId.get("d_tpl").template;
  const scripts = [...template.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0][1]));
});

test("follow remains inactive unless explicitly enabled", () => {
  const h = harness({ robot: { cmd: "stop", speed: 60, steer: 0, auto: false } });
  publishVision(h, true, 0.8);
  assert.equal(h.run("vision-follow", { payload: Date.now() }), null);
});

test("one retained-looking message is not enough to start following", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 60, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  publishVision(h, true, 0.8, 1);
  const result = h.run("vision-follow", { payload: 0 });
  assert.equal(result.payload.cmd, "stop");
  assert.equal(result.payload.auto, false);
  h.run("d_ctl", result);
  assert.equal(h.flowState.get("robot").auto, false);
});

test("dashboard advertises follow only after fresh consecutive detections", () => {
  const h = harness({ robot: { cmd: "stop", speed: 60, steer: 0, auto: false } });
  publishVision(h, true, 0.5, 1);
  let state = h.run("d_est", { payload: null }).payload;
  assert.equal(state.vision.seguimiento_disponible, false);
  h.setTime(10100);
  publishVision(h, true, 0.5, 2);
  state = h.run("d_est", { payload: null }).payload;
  assert.equal(state.vision.seguimiento_disponible, true);
});

test("centered target drives both motors straight at the capped speed", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 60, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  publishVision(h, true, 0.5);
  const result = h.run("vision-follow", { payload: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.payload)), {
    cmd: "adelante",
    speed: 45,
    steer: 0,
    origen: "vision",
  });
  const motorOutputs = h.run("d_ctl", result);
  assert.equal(motorOutputs[0].payload, 45);
  assert.equal(motorOutputs[3].payload, 45);
  assert.equal(h.flowState.get("robot").auto, true);
});

test("target position steers left and right with a center dead band", () => {
  const h = harness({ robot: { cmd: "stop", speed: 60, steer: 0, auto: true } });
  publishVision(h, true, 0.1);
  assert.ok(h.run("vision-follow", { payload: 0 }).payload.steer < 0);
  h.setTime(10100);
  publishVision(h, true, 0.9);
  assert.ok(h.run("vision-follow", { payload: 0 }).payload.steer > 0);
  h.setTime(10200);
  publishVision(h, true, 0.55);
  assert.equal(h.run("vision-follow", { payload: 0 }).payload.steer, 0);
});

test("missing target beyond the grace period stops but keeps follow armed", () => {
  const h = harness({
    robot: { cmd: "adelante", speed: 45, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  publishVision(h, true, 0.7);
  h.setTime(10200);
  publishVision(h, false, null);
  h.setTime(10600);
  const result = h.run("vision-follow", { payload: 0 });
  assert.equal(result.payload.cmd, "stop");
  assert.equal(result.payload.auto, true);
  h.run("d_ctl", result);
  assert.equal(h.flowState.get("robot").cmd, "stop");
  assert.equal(h.flowState.get("robot").auto, true);

  h.setTime(10700);
  publishVision(h, true, 0.7);
  const resumed = h.run("vision-follow", { payload: 0 });
  assert.equal(resumed.payload.cmd, "adelante");
  assert.equal(resumed.payload.auto, undefined);
  h.run("d_ctl", resumed);
  assert.equal(h.flowState.get("robot").cmd, "adelante");
  assert.equal(h.flowState.get("robot").auto, true);
});

test("stale vision stream stops and disarms follow", () => {
  const h = harness({
    robot: { cmd: "adelante", speed: 45, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  publishVision(h, true, 0.7);
  h.setTime(10800);
  const result = h.run("vision-follow", { payload: 0 });
  assert.equal(result.payload.cmd, "stop");
  assert.equal(result.payload.auto, false);
  h.run("d_ctl", result);
  assert.equal(h.flowState.get("robot").auto, false);
});

test("stale or blocked ultrasonic sensor stops and disarms the robot", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 60, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  h.setTime(12000);
  const result = h.run("d_ctl", {
    payload: { cmd: "adelante", speed: 45, steer: 40, origen: "vision" },
  });
  assert.equal(h.flowState.get("robot").cmd, "stop");
  assert.equal(h.flowState.get("robot").auto, false);
  assert.equal(result.slice(0, 6).every((output) => output.payload === 0), true);
});

test("near obstacle stops and disarms automatic follow", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 60, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 10,
    frenoCm: 25,
  });
  const result = h.run("d_ctl", {
    payload: { cmd: "adelante", speed: 45, steer: 40, origen: "vision" },
  });
  assert.equal(h.flowState.get("robot").bloqueado, true);
  assert.equal(h.flowState.get("robot").auto, false);
  assert.equal(result.slice(0, 6).every((output) => output.payload === 0), true);
});

test("manual commands cancel automatic follow", () => {
  const h = harness({
    robot: { cmd: "adelante", speed: 45, steer: 0, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  h.run("d_ctl", { payload: { cmd: "stop", steer: 0 } });
  assert.equal(h.flowState.get("robot").auto, false);
});

test("disabling auto without a command still stops the motors", () => {
  const h = harness({
    robot: { cmd: "adelante", speed: 45, steer: 20, auto: true },
    tLectura: 10000,
    distancia: 100,
    frenoCm: 25,
  });
  h.run("d_ctl", { payload: { auto: false } });
  assert.equal(h.flowState.get("robot").cmd, "stop");
  assert.equal(h.flowState.get("robot").auto, false);
});
