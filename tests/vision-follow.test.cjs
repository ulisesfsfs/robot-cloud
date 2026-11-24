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
      payload: {
        detectado,
        x,
        area: 0.02,
        modo: "color",
        color: detectado ? "verde" : null,
        colores: detectado ? ["verde"] : [],
      },
    });
  }
}

function renderSemaforo(state) {
  const template = byId.get("d_tpl").template;
  const script = [...template.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)][0][1];
  const start = script.indexOf("function pintarSem(st) {");
  const end = script.indexOf("\nfunction pintarVision", start);
  assert.ok(start >= 0 && end > start);
  const elements = new Map();
  const $ = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        classList: {
          toggle(name, enabled) {
            if (enabled) classes.add(name);
            else classes.delete(name);
          },
          contains: (name) => classes.has(name),
        },
        get textContent() {
          return this.text;
        },
        set textContent(value) {
          this.text = value;
        },
      });
    }
    return elements.get(id);
  };
  const sem = vm.runInNewContext(
    `(() => { ${script.slice(start, end)}; return pintarSem; })()`,
    {
      $,
      SEM: {
        rojo: ["r", "Rojo: frenado"],
        "rojo-parpadeo": ["r", "Rojo: obstáculo cerca"],
        amarillo: ["y", "Amarillo: atrás"],
        verde: ["g", "Verde: adelante"],
        apagado: ["", "Apagado"],
      },
    },
  );
  sem(state);
  return {
    red: $("semR").classList.contains("on"),
    yellow: $("semY").classList.contains("on"),
    green: $("semG").classList.contains("on"),
    text: $("semTxt").textContent,
  };
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

test("vision state accepts only supported indicator colors", () => {
  const h = harness();
  h.run("6f14ca56b0b07cf8", {
    payload: {
      detectado: true,
      modo: "color",
      color: "verde",
      colores: ["verde", "amarillo", "azul", "rojo"],
      x: 0.5,
      area: 0.02,
    },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(h.globalState.get("robot_vision").colores)),
    ["verde", "amarillo", "rojo"],
  );
});

test("single color field is enough to activate its dashboard LED", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 0, steer: 0, auto: false },
    tLectura: 10000,
    distancia: 100,
  });
  h.run("6f14ca56b0b07cf8", {
    payload: {
      detectado: true,
      modo: "color",
      color: "amarillo",
      x: 0.5,
      area: 0.02,
    },
  });
  h.run("s_fn", { payload: 0 });
  assert.equal(h.globalState.get("robot_vision").colores[0], "amarillo");
  assert.equal(h.globalState.get("robot_leds").amarillo, true);
});

test("detected colors drive their corresponding LEDs without sounding buzzer", () => {
  const h = harness(
    { robot: { cmd: "stop", speed: 0, steer: 0, auto: false }, tLectura: 10000, distancia: 100 },
    { robot_vision: { recibido: 10000, detectado: true, modo: "color", colores: ["verde", "amarillo"] } },
  );
  const [red, yellow, green, buzzer] = h.run("s_fn", { payload: 0 });
  assert.equal(red.payload, 0);
  assert.equal(yellow.payload, 1);
  assert.equal(green.payload, 1);
  assert.equal(buzzer.payload, 0);
  const leds = h.globalState.get("robot_leds");
  assert.equal(leds.verde, true);
  assert.equal(leds.amarillo, true);
  assert.equal(leds.seguridad, false);

  const dashboardState = h.run("d_est", { payload: null }).payload;
  assert.equal(dashboardState.leds.amarillo, true);
  assert.deepEqual(JSON.parse(JSON.stringify(dashboardState.leds.colores)), ["verde", "amarillo"]);
});

test("dashboard keeps the last detected color through brief false frames", () => {
  const h = harness({
    robot: { cmd: "stop", speed: 0, steer: 0, auto: false },
    tLectura: 10000,
    distancia: 100,
  });
  publishVision(h, true, 0.5);
  h.run("s_fn", { payload: 0 });
  assert.equal(h.globalState.get("robot_leds").verde, true);

  h.setTime(10500);
  publishVision(h, false, null);
  h.run("s_fn", { payload: 0 });
  assert.equal(h.globalState.get("robot_leds").verde, true);

  h.setTime(10760);
  publishVision(h, false, null);
  h.run("s_fn", { payload: 0 });
  assert.equal(h.globalState.get("robot_leds").verde, false);
});

test("dashboard lights show detected colors and explain safety red", () => {
  const detected = renderSemaforo({
    luz: "apagado",
    leds: {
      disponible: true,
      rojo: false,
      amarillo: true,
      verde: true,
      seguridad: false,
      colores: ["verde", "amarillo"],
    },
  });
  assert.equal(detected.red, false);
  assert.equal(detected.yellow, true);
  assert.equal(detected.green, true);
  assert.equal(detected.text, "Detectado: verde, amarillo");

  const safety = renderSemaforo({
    luz: "rojo",
    leds: {
      disponible: true,
      rojo: true,
      amarillo: false,
      verde: false,
      seguridad: true,
      motivo: "HC-SR04 sin datos",
      colores: [],
    },
  });
  assert.equal(safety.red, true);
  assert.equal(safety.yellow, false);
  assert.equal(safety.green, false);
  assert.equal(safety.text, "Rojo seguridad: HC-SR04 sin datos");
});

test("obstacle safety red overrides detected object colors and sounds alarm", () => {
  const h = harness(
    { robot: { cmd: "adelante", speed: 45, steer: 0, auto: false }, tLectura: 10000, distancia: 10 },
    { robot_vision: { recibido: 10000, detectado: true, modo: "color", colores: ["verde", "amarillo"] } },
  );
  const [red, yellow, green, buzzer] = h.run("s_fn", { payload: 0 });
  assert.equal(red.payload, 1);
  assert.equal(yellow.payload, 0);
  assert.equal(green.payload, 0);
  assert.equal(buzzer.payload, 50);
});

test("red object detection turns off the buzzer after a safety alert clears", () => {
  const h = harness(
    { robot: { cmd: "adelante", speed: 45, steer: 0, auto: false }, tLectura: 10000, distancia: 10 },
    { robot_vision: { recibido: 10000, detectado: true, modo: "color", colores: ["rojo"] } },
  );
  const alertOutputs = h.run("s_fn", { payload: 0 });
  assert.equal(alertOutputs[0].payload, 1);
  assert.equal(alertOutputs[3].payload, 50);

  h.flowState.set("distancia", 100);
  h.flowState.set("robot", { cmd: "stop", speed: 0, steer: 0, auto: false });
  const colorOutputs = h.run("s_fn", { payload: 0 });
  assert.equal(colorOutputs[0].payload, 1);
  assert.equal(colorOutputs[3].payload, 0);
});

test("stale ultrasonic reading takes priority over color indicators", () => {
  const h = harness(
    { robot: { cmd: "stop", speed: 0, steer: 0, auto: false }, tLectura: 8000, distancia: 100 },
    { robot_vision: { recibido: 10000, detectado: true, modo: "color", colores: ["verde"] } },
  );
  const [red, yellow, green] = h.run("s_fn", { payload: 0 });
  assert.equal(red.payload, 1);
  assert.equal(yellow.payload, 0);
  assert.equal(green.payload, 0);
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
