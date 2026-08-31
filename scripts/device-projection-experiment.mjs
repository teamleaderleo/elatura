// SPDX-License-Identifier: MPL-2.0
/**
 * Content-minimised scrcpy experiment helper for issue #186.
 *
 * It never records device serials, network endpoints, process ids, installed
 * packages, window ids, screenshots, application content, or raw command output.
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";

const SCHEMA = "elatura-device-projection-sample/v1";
const LABEL = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const NUMBER = /^-?\d+(?:\.\d+)?$/u;
const WORKLOAD_HTML = `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Elatura device projection synthetic workload</title>
<style>
  :root{color-scheme:light dark;font:16px/1.5 system-ui}body{margin:0}header{position:sticky;top:0;padding:12px;background:#17324d;color:white;z-index:2}
  nav{display:flex;gap:12px;align-items:center;flex-wrap:wrap}a,button,input{font:inherit;padding:7px}.grid{padding:16px;display:grid;gap:12px}
  article{max-width:76ch;border:1px solid #7896;padding:12px;border-radius:8px}canvas{display:block;width:100%;height:auto;background:#08121f}
</style>
<header><nav><strong>Content-free projection workload</strong><a href="/reading">Reading</a><a href="/motion">Motion/audio</a><input aria-label="Text entry" placeholder="Type here"><button id="audio">Start test tone</button><span id="status">ready</span></nav></header>
<main id="main" class="grid"></main>
<script>
const main=document.querySelector('#main');
if(location.pathname==='/motion'){
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;canvas.setAttribute('aria-label','Animated synthetic canvas');main.append(canvas);
  const c=canvas.getContext('2d');let frame=0;function draw(t){const g=c.createLinearGradient(0,0,1280,720);g.addColorStop(0,'#06162d');g.addColorStop(1,'#295b7a');c.fillStyle=g;c.fillRect(0,0,1280,720);for(let i=0;i<160;i++){const x=(t*.08+i*97)%1320-20,y=360+Math.sin(t/450+i)*290;c.fillStyle='hsl('+((i*17+t/30)%360)+' 80% 60%)';c.fillRect(x,y,10,10)}c.fillStyle='white';c.font='36px system-ui';c.fillText('Synthetic motion frame '+(++frame),40,70);requestAnimationFrame(draw)}requestAnimationFrame(draw);
}else{
  const sentence='Synthetic text preserves scroll and glyph-shaping work without exposing application content. ';
  for(let i=1;i<=240;i++){const a=document.createElement('article');a.innerHTML='<h2>Section '+i+'</h2><p>'+sentence.repeat(9)+'</p>';main.append(a)}
}
document.querySelector('#audio').addEventListener('click',()=>{const A=window.AudioContext||window.webkitAudioContext;const a=new A(),o=a.createOscillator(),g=a.createGain();o.frequency.value=440;g.gain.value=.04;o.connect(g).connect(a.destination);o.start();setTimeout(()=>{o.stop();a.close()},3000);document.querySelector('#status').textContent='tone playing'});
</script></html>`;

export const PROFILES = Object.freeze({
  "mirror-present": Object.freeze([
    "--select-usb",
    "--no-control",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura phone presentation",
  ]),
  "mirror-control": Object.freeze([
    "--select-usb",
    "--keyboard=sdk",
    "--mouse=sdk",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--stay-awake",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura phone control",
  ]),
  "mirror-control-screen-off": Object.freeze([
    "--select-usb",
    "--keyboard=sdk",
    "--mouse=sdk",
    "--turn-screen-off",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--stay-awake",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura phone control screen off",
  ]),
  "virtual-landscape": Object.freeze([
    "--select-usb",
    "--new-display=1920x1080/240",
    "--display-ime-policy=fallback",
    "--keyboard=sdk",
    "--mouse=sdk",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura Android virtual display",
  ]),
  "wireless-bootstrap": Object.freeze([
    "--tcpip",
    "--keyboard=sdk",
    "--mouse=sdk",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--stay-awake",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura phone wireless",
  ]),
  wireless: Object.freeze([
    "--select-tcpip",
    "--keyboard=sdk",
    "--mouse=sdk",
    "--audio-source=playback",
    "--audio-dup",
    "--no-clipboard-autosync",
    "--stay-awake",
    "--disable-screensaver",
    "--print-fps",
    "--window-title=Elatura phone wireless",
  ]),
});

function command(name, args, options = {}) {
  try {
    return execFileSync(name, args, {
      encoding: "utf8",
      timeout: 15_000,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    }).trim();
  } catch {
    return null;
  }
}

function finite(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function field(text, name) {
  const match = text?.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "mu"));
  return match && NUMBER.test(match[1].trim()) ? finite(match[1].trim()) : null;
}

export function parseAdbState(text) {
  const records = (text ?? "").split(/\r?\n/u).slice(1).filter((line) => line.trim()).map((line) => {
    const [transport = "", state = "unknown"] = line.trim().split(/\s+/u);
    return { state, tcpip: transport.includes(":") };
  });
  const states = records.map((record) => record.state);
  return {
    count: states.length,
    authorizedCount: states.filter((state) => state === "device").length,
    usbAuthorizedCount: records.filter((record) => record.state === "device" && !record.tcpip).length,
    tcpipAuthorizedCount: records.filter((record) => record.state === "device" && record.tcpip).length,
    unauthorizedCount: states.filter((state) => state === "unauthorized").length,
    offlineCount: states.filter((state) => state === "offline").length,
  };
}

export function countAndroidUsbCandidates(value) {
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countAndroidUsbCandidates(item), 0);
  if (!value || typeof value !== "object") return 0;
  const record = value;
  const product = typeof record._name === "string" ? record._name : "";
  const vendor = typeof record.manufacturer === "string" ? record.manufacturer : "";
  const matched = /android|iqoo/iu.test(product) || /vivo/iu.test(vendor);
  const children = Object.values(record).reduce((sum, item) => sum + countAndroidUsbCandidates(item), 0);
  return (matched ? 1 : 0) + children;
}

function androidUsbCandidateCount() {
  const text = command("system_profiler", ["SPUSBDataType", "-json"]);
  if (!text) return null;
  try {
    return countAndroidUsbCandidates(JSON.parse(text));
  } catch {
    return null;
  }
}

function adbState() {
  return parseAdbState(command("adb", ["devices"]));
}

function authorizedTcpipEndpoints() {
  return (command("adb", ["devices"]) ?? "").split(/\r?\n/u).slice(1).flatMap((line) => {
    const [transport = "", state = ""] = line.trim().split(/\s+/u);
    return state === "device" && transport.includes(":") ? [transport] : [];
  });
}

function adbTargetArgs(state) {
  if (state.tcpipAuthorizedCount === 1 && command("adb", ["-e", "get-state"]) === "device") return ["-e"];
  if (state.usbAuthorizedCount === 1 && command("adb", ["-d", "get-state"]) === "device") return ["-d"];
  return state.authorizedCount === 1 ? [] : null;
}

function hostCpuAndMemory() {
  const top = command("top", ["-l", "1", "-n", "0"]);
  const cpu = top?.match(/CPU usage:\s*([\d.]+)% user,\s*([\d.]+)% sys,\s*([\d.]+)% idle/u);
  const physical = top?.match(/PhysMem:\s*([^\n]+)/u);
  return {
    cpuUserPercent: finite(cpu?.[1]),
    cpuSystemPercent: finite(cpu?.[2]),
    cpuIdlePercent: finite(cpu?.[3]),
    physicalMemorySummary: physical?.[1]?.trim() ?? null,
  };
}

function scrcpyResources() {
  const ps = command("ps", ["-axo", "comm=,%cpu=,rss="]);
  const rows = (ps ?? "").split(/\r?\n/u).map((line) => line.trim().split(/\s+/u));
  const matches = rows.filter((row) => row[0]?.split("/").at(-1) === "scrcpy");
  return {
    processCount: matches.length,
    cpuPercent: matches.reduce((sum, row) => sum + (finite(row[1]) ?? 0), 0),
    rssBytes: matches.reduce((sum, row) => sum + (finite(row[2]) ?? 0) * 1024, 0),
  };
}

function matchingProcessResources(token) {
  if (!token) return null;
  if (!LABEL.test(token)) throw new TypeError("process token must use the label syntax");
  const ps = command("ps", ["-axo", "pid=,ppid=,%cpu=,rss=,args="]);
  const rows = (ps ?? "").split(/\r?\n/u).flatMap((line) => {
    const parsed = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.*)$/u);
    return parsed ? [{
      pid: Number(parsed[1]),
      parentPid: Number(parsed[2]),
      cpu: Number(parsed[3]),
      rssKib: Number(parsed[4]),
      args: parsed[5],
    }] : [];
  });
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const ancestors = new Set();
  let ancestorPid = process.pid;
  while (ancestorPid && !ancestors.has(ancestorPid)) {
    ancestors.add(ancestorPid);
    ancestorPid = byPid.get(ancestorPid)?.parentPid ?? 0;
  }
  const ownTree = new Set([process.pid]);
  let ownTreeChanged = true;
  while (ownTreeChanged) {
    ownTreeChanged = false;
    for (const row of rows) {
      if (!ownTree.has(row.pid) && ownTree.has(row.parentPid)) {
        ownTree.add(row.pid);
        ownTreeChanged = true;
      }
    }
  }
  const excluded = new Set([...ancestors, ...ownTree]);
  const admitted = new Set(rows
    .filter((row) => !excluded.has(row.pid) && row.args.includes(token))
    .map((row) => row.pid));
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!excluded.has(row.pid) && !admitted.has(row.pid) && admitted.has(row.parentPid)) {
        admitted.add(row.pid);
        changed = true;
      }
    }
  }
  const matches = rows.filter((row) => admitted.has(row.pid));
  return {
    processCount: matches.length,
    cpuPercent: matches.reduce((sum, row) => sum + row.cpu, 0),
    rssBytes: matches.reduce((sum, row) => sum + row.rssKib * 1024, 0),
  };
}

function hostBattery() {
  const text = command("pmset", ["-g", "batt"]);
  const percent = text?.match(/(\d+)%/u);
  return {
    source: text?.includes("AC Power") ? "ac" : text?.includes("Battery Power") ? "battery" : "unknown",
    percent: finite(percent?.[1]),
    charging: text?.includes("charging") && !text?.includes("not charging"),
  };
}

function ioregNumber(text, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = text?.match(new RegExp(`\"${escaped}\"=(-?\\d+(?:\\.\\d+)?)`, "u"));
  return finite(match?.[1]);
}

function hostEnergyAndGpu() {
  const battery = command("ioreg", ["-r", "-c", "AppleSmartBattery", "-w0"]);
  const gpu = command("ioreg", ["-r", "-c", "AGXAccelerator", "-w0"]);
  return {
    energy: battery ? {
      batteryPowerMw: ioregNumber(battery, "BatteryPower"),
      systemLoadMw: ioregNumber(battery, "SystemLoad"),
      systemPowerInMw: ioregNumber(battery, "SystemPowerIn"),
      batteryTemperatureC: ioregNumber(battery, "Temperature") !== null
        ? ioregNumber(battery, "Temperature") / 100
        : null,
    } : null,
    gpu: gpu ? {
      deviceUtilizationPercent: ioregNumber(gpu, "Device Utilization %"),
      rendererUtilizationPercent: ioregNumber(gpu, "Renderer Utilization %"),
      tilerUtilizationPercent: ioregNumber(gpu, "Tiler Utilization %"),
      inUseSystemMemoryBytes: ioregNumber(gpu, "In use system memory"),
    } : null,
  };
}

function hostDisplays() {
  const text = command("system_profiler", ["SPDisplaysDataType", "-json"]);
  if (!text) return { onlineCount: null, externalCount: null, asleepCount: null };
  try {
    const parsed = JSON.parse(text);
    const cards = parsed.SPDisplaysDataType ?? [];
    const displays = cards.flatMap((card) => card.spdisplays_ndrvs ?? []);
    const online = displays.filter((display) => display.spdisplays_online !== "spdisplays_no");
    const builtIn = online.filter((display) => display.spdisplays_connection_type === "spdisplays_internal");
    return {
      onlineCount: online.length,
      externalCount: Math.max(0, online.length - builtIn.length),
      asleepCount: online.filter((display) => display.spdisplays_asleep === "spdisplays_yes").length,
    };
  } catch {
    return { onlineCount: null, externalCount: null, asleepCount: null };
  }
}

function androidBattery(target) {
  const text = command("adb", [...target, "shell", "dumpsys", "battery"]);
  if (!text) return null;
  const level = field(text, "level");
  const scale = field(text, "scale");
  return {
    percent: level !== null && scale ? Math.round((level / scale) * 1000) / 10 : null,
    statusCode: field(text, "status"),
    healthCode: field(text, "health"),
    temperatureC: field(text, "temperature") !== null ? field(text, "temperature") / 10 : null,
    voltageMv: field(text, "voltage"),
    acPowered: /AC powered:\s*true/u.test(text),
    usbPowered: /USB powered:\s*true/u.test(text),
  };
}

function androidPowerSupplyNumber(target, name) {
  const value = command("adb", [...target, "shell", "cat", `/sys/class/power_supply/battery/${name}`]);
  return value && NUMBER.test(value) ? finite(value) : null;
}

function androidPowerSupply(target) {
  return {
    currentNowUa: androidPowerSupplyNumber(target, "current_now"),
    chargeCounterUah: androidPowerSupplyNumber(target, "charge_counter"),
    powerNowUw: androidPowerSupplyNumber(target, "power_now"),
    cycleCount: androidPowerSupplyNumber(target, "cycle_count"),
  };
}

function androidMemory(target) {
  const text = command("adb", [...target, "shell", "cat", "/proc/meminfo"]);
  const kib = (name) => {
    const match = text?.match(new RegExp(`^${name}:\\s+(\\d+)\\s+kB$`, "mu"));
    return match ? Number(match[1]) * 1024 : null;
  };
  return text ? { totalBytes: kib("MemTotal"), availableBytes: kib("MemAvailable") } : null;
}

function androidCpu(target) {
  const text = command("adb", [...target, "shell", "dumpsys", "cpuinfo"]);
  const total = text?.match(/([\d.]+)% TOTAL:/u);
  return { totalPercent: finite(total?.[1]) };
}

function androidThermals(target) {
  const text = command("adb", [...target, "shell", "dumpsys", "thermalservice"]);
  if (!text) return null;
  const current = text.match(/Current temperatures from HAL:\s*([\s\S]*?)Current cooling devices from HAL:/u)?.[1] ?? "";
  const temperatures = [...current.matchAll(/Temperature\{mValue=([\d.]+), mType=(\d+), mName=[^,]+, mStatus=(\d+)\}/gu)]
    .map((match) => ({ value: Number(match[1]), type: Number(match[2]), status: Number(match[3]) }))
    .filter((entry) => Number.isFinite(entry.value));
  const maximumForType = (type) => {
    const values = temperatures.filter((entry) => entry.type === type).map((entry) => entry.value);
    return values.length ? Math.max(...values) : null;
  };
  return {
    currentSensorCount: temperatures.length,
    cpuMaximumC: maximumForType(0),
    gpuMaximumC: maximumForType(1),
    batteryC: maximumForType(2),
    skinC: maximumForType(3),
    maximumSensorStatus: temperatures.some((entry) => entry.type >= 0 && entry.type <= 3)
      ? Math.max(...temperatures.filter((entry) => entry.type >= 0 && entry.type <= 3).map((entry) => entry.status))
      : null,
    throttlingStatus: field(text, "Thermal Status"),
  };
}

function androidDisplays(target) {
  const text = command("adb", [...target, "shell", "dumpsys", "display"]);
  if (!text) return null;
  const devices = [...text.matchAll(/^\s*DisplayDeviceInfo\{.*$/gmu)].map((match) => match[0]);
  return {
    displayDeviceCount: devices.length,
    builtInCount: devices.filter((device) => /type (?:INTERNAL|BUILT_IN)/u.test(device)).length,
    virtualCount: devices.filter((device) => /type VIRTUAL/u.test(device)).length,
    builtInOnCount: devices.filter((device) => /type (?:INTERNAL|BUILT_IN)/u.test(device) && /state ON/u.test(device)).length,
    virtualOnCount: devices.filter((device) => /type VIRTUAL/u.test(device) && /state ON/u.test(device)).length,
  };
}

export function parseAndroidActivityDisplays(text) {
  const source = `${text ?? ""}\nDisplay #-1 (activities from top to bottom):\n`;
  const sections = [...source.matchAll(/^[ \t]*Display #(\d+) \(activities from top to bottom\):[ \t]*\r?\n([\s\S]*?)(?=^[ \t]*Display #-?\d+ )/gmu)]
    .map((match) => ({
      isDefault: match[1] === "0",
      taskCount: (match[2].match(/^\s*\* Task\{/gmu) ?? []).length,
      resumedCount: (match[2].match(/mResumedActivity:|\bResumed=true\b/gu) ?? []).length,
    }));
  const nonDefault = sections.filter((section) => !section.isDefault);
  return {
    activityDisplayCount: sections.length,
    nonDefaultActivityDisplayCount: nonDefault.length,
    defaultTaskCount: sections.filter((section) => section.isDefault).reduce((sum, section) => sum + section.taskCount, 0),
    nonDefaultTaskCount: nonDefault.reduce((sum, section) => sum + section.taskCount, 0),
    nonDefaultResumedCount: nonDefault.reduce((sum, section) => sum + section.resumedCount, 0),
  };
}

function androidActivityDisplays(target) {
  const text = command("adb", [...target, "shell", "dumpsys", "activity", "activities"]);
  return text ? parseAndroidActivityDisplays(text) : null;
}

export function collectSample(label, processToken = null) {
  if (!LABEL.test(label)) throw new TypeError("label must match [a-z0-9][a-z0-9-]{0,47}");
  const state = adbState();
  const target = adbTargetArgs(state);
  const android = target ? {
    battery: androidBattery(target),
    powerSupply: androidPowerSupply(target),
    cpu: androidCpu(target),
    memory: androidMemory(target),
    thermals: androidThermals(target),
    displays: androidDisplays(target),
    activityDisplays: androidActivityDisplays(target),
  } : null;
  return {
    schema: SCHEMA,
    collectedAt: new Date().toISOString(),
    label,
    host: {
      architecture: process.arch,
      ...hostCpuAndMemory(),
      battery: hostBattery(),
      ...hostEnergyAndGpu(),
      displays: hostDisplays(),
      scrcpy: scrcpyResources(),
      matchedProcesses: matchingProcessResources(processToken),
    },
    android: { connection: state, measurements: android },
  };
}

function parseOptions(args) {
  const options = new Map();
  for (const arg of args) {
    const match = arg.match(/^--([a-z-]+)=(.+)$/u);
    if (!match) throw new TypeError(`invalid option: ${arg}`);
    options.set(match[1], match[2]);
  }
  return options;
}

function writeSample(sample, output, append = false) {
  const encoded = `${JSON.stringify(sample)}\n`;
  if (!output) process.stdout.write(encoded);
  else {
    const path = resolve(output);
    mkdirSync(dirname(path), { recursive: true });
    if (append) appendFileSync(path, encoded, { encoding: "utf8", mode: 0o600 });
    else writeFileSync(path, encoded, { encoding: "utf8", mode: 0o600 });
  }
}

function profileArgs(name, app) {
  const args = PROFILES[name];
  if (!args) throw new TypeError(`unknown profile: ${name}`);
  if (app && name !== "virtual-landscape") throw new TypeError("--app is only valid for virtual-landscape");
  if (app && !/^[\p{L}\p{N} ._-]{1,80}$/u.test(app)) throw new TypeError("invalid app prefix");
  return app ? [...args, `--start-app=?${app}`] : [...args];
}

export function profileTransportReady(name, state) {
  if (!PROFILES[name]) throw new TypeError(`unknown profile: ${name}`);
  if (name === "wireless") return state.tcpipAuthorizedCount === 1;
  if (name === "wireless-bootstrap" || PROFILES[name].includes("--select-usb")) {
    return state.usbAuthorizedCount === 1;
  }
  return state.authorizedCount === 1;
}

async function runProfile(name, options) {
  const label = options.get("label") ?? name;
  if (!LABEL.test(label)) throw new TypeError("invalid label");
  const duration = finite(options.get("duration") ?? "60");
  const interval = finite(options.get("interval") ?? "5");
  if (!duration || duration < 5 || duration > 3600) throw new TypeError("duration must be 5..3600 seconds");
  if (!interval || interval < 1 || interval > duration) throw new TypeError("interval must be 1..duration seconds");
  const output = options.get("output");
  const state = adbState();
  if (!profileTransportReady(name, state)) {
    const usbCount = androidUsbCandidateCount();
    throw new Error(usbCount
      ? "the required Android transport is present but unavailable; enable USB debugging and approve this computer"
      : "exactly one authorized Android device on the profile transport is required");
  }

  const startedAt = Date.now();
  // BSD script supplies a pseudo-terminal so scrcpy flushes first-frame logs;
  // the raw stream is inspected only for readiness tokens and never retained.
  const child = spawn("/usr/bin/script", [
    "-q",
    "/dev/null",
    "scrcpy",
    ...profileArgs(name, options.get("app")),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const samples = [];
  let spawnError = null;
  let startupObservedAt = null;
  child.once("error", (error) => { spawnError = error; });
  const observeStartup = (chunk) => {
    // Never retain or emit the raw log: wireless startup may print an endpoint.
    if (startupObservedAt === null && /Renderer:|Texture:/u.test(String(chunk))) {
      startupObservedAt = Date.now();
    }
  };
  child.stdout.on("data", observeStartup);
  child.stderr.on("data", observeStartup);
  await new Promise((done) => setTimeout(done, 2_000));
  if (spawnError) throw spawnError;
  if (child.exitCode !== null) throw new Error("scrcpy exited before presentation became usable");

  while (Date.now() - startedAt < duration * 1000 && child.exitCode === null) {
    samples.push(collectSample(label));
    await new Promise((done) => setTimeout(done, interval * 1000));
  }
  const exitedEarly = child.exitCode !== null;
  if (!exitedEarly) child.kill("SIGINT");
  await new Promise((done) => {
    if (child.exitCode !== null) done();
    else child.once("exit", done);
    setTimeout(done, 3_000);
  });
  let physicalScreenRestored = null;
  if (name === "mirror-control-screen-off") {
    const target = adbTargetArgs(adbState());
    physicalScreenRestored = target !== null
      && command("adb", [...target, "shell", "input", "keyevent", "KEYCODE_WAKEUP"]) !== null;
  }
  const run = {
    profile: name,
    requestedDurationSeconds: duration,
    sampleIntervalSeconds: interval,
    startupObservedMs: startupObservedAt === null ? null : startupObservedAt - startedAt,
    outcome: exitedEarly ? "scrcpy-exited-early" : "requested-stop",
    physicalScreenRestored,
  };
  for (const [index, sample] of samples.entries()) {
    writeSample({ ...sample, run }, output, index > 0);
  }
  process.stderr.write(`completed ${name}: ${samples.length} content-free samples\n`);
}

async function measureOnly(options) {
  const label = options.get("label") ?? "measure";
  if (!LABEL.test(label)) throw new TypeError("invalid label");
  const duration = finite(options.get("duration") ?? "60");
  const interval = finite(options.get("interval") ?? "5");
  if (!duration || duration < 5 || duration > 3600) throw new TypeError("duration must be 5..3600 seconds");
  if (!interval || interval < 1 || interval > duration) throw new TypeError("interval must be 1..duration seconds");
  const output = options.get("output");
  const processToken = options.get("process-token") ?? null;
  const wakeGuard = spawn("caffeinate", ["-dimsu", "-w", String(process.pid)], {
    stdio: "ignore",
  });
  const startedAt = Date.now();
  let index = 0;
  while (Date.now() - startedAt < duration * 1000) {
    writeSample(collectSample(label, processToken), output, index > 0);
    index += 1;
    await new Promise((done) => setTimeout(done, interval * 1000));
  }
  if (wakeGuard.exitCode === null) wakeGuard.kill("SIGTERM");
  process.stderr.write(`completed ${label}: ${index} content-free samples\n`);
}

async function serveWorkload(options) {
  const port = finite(options.get("port") ?? "0");
  if (port === null || port < 0 || port > 65535) throw new TypeError("port must be 0..65535");
  const server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    const path = request.url?.split("?", 1)[0] ?? "";
    if (request.method !== "GET" || !/^127\.0\.0\.1:\d+$/u.test(host) || !["/", "/reading", "/motion"].includes(path)) {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" });
      response.end("not found\n");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    });
    response.end(WORKLOAD_HTML);
    process.stdout.write(`synthetic workload served ${path === "/" ? "root" : path.slice(1)}\n`);
  });
  await new Promise((done, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", done);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("workload server address unavailable");
  process.stdout.write(`synthetic workload listening on http://127.0.0.1:${address.port}\n`);
  await new Promise((done) => {
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
  });
  await new Promise((done) => server.close(done));
}

async function probeWirelessReconnect() {
  const endpoints = authorizedTcpipEndpoints();
  if (endpoints.length !== 1) throw new Error("exactly one authorized wireless Android transport is required");
  const endpoint = endpoints[0];
  const disconnected = command("adb", ["disconnect", endpoint]) !== null;
  if (!disconnected) throw new Error("wireless Android transport disconnect failed");
  await new Promise((done) => setTimeout(done, 500));
  const reconnectStartedAt = Date.now();
  const connectAccepted = command("adb", ["connect", endpoint]) !== null;
  let reconnected = false;
  while (connectAccepted && Date.now() - reconnectStartedAt < 15_000) {
    if (command("adb", ["-e", "get-state"]) === "device") {
      reconnected = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  process.stdout.write(`${JSON.stringify({
    schema: "elatura-device-projection-reconnect/v1",
    disconnected,
    reconnected,
    reconnectObservedMs: reconnected ? Date.now() - reconnectStartedAt : null,
  }, null, 2)}\n`);
  if (!reconnected) throw new Error("wireless Android transport did not reconnect within 15 seconds");
}

function numericLeaves(value, prefix = "", target = new Map()) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const values = target.get(prefix) ?? [];
    values.push(value);
    target.set(prefix, values);
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) {
      if (!["collectedAt", "schema", "label"].includes(key)) {
        numericLeaves(child, prefix ? `${prefix}.${key}` : key, target);
      }
    }
  }
  return target;
}

export function summarizeSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) throw new TypeError("at least one sample is required");
  const labels = [...new Set(samples.map((sample) => sample.label))];
  if (labels.length !== 1 || !LABEL.test(labels[0])) throw new TypeError("samples require one valid label");
  const leaves = samples.reduce((all, sample) => numericLeaves(sample, "", all), new Map());
  const metrics = {};
  for (const [path, values] of [...leaves].sort(([a], [b]) => a.localeCompare(b))) {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    const median = ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
    metrics[path] = {
      count: values.length,
      min: ordered[0],
      median,
      max: ordered.at(-1),
      mean: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100,
    };
  }
  return {
    schema: "elatura-device-projection-summary/v1",
    label: labels[0],
    sampleCount: samples.length,
    startedAt: samples[0].collectedAt ?? null,
    finishedAt: samples.at(-1)?.collectedAt ?? null,
    metrics,
  };
}

function summarizeFile(options) {
  const input = options.get("input");
  if (!input) throw new TypeError("--input is required");
  const samples = readFileSync(resolve(input), "utf8").split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
  const summary = summarizeSamples(samples);
  const output = options.get("output");
  if (output) writeSample(summary, output);
  else process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function launchWorkloadOnVirtualDisplay(options) {
  const port = finite(options.get("port"));
  const path = options.get("path") ?? "reading";
  if (!port || port < 1 || port > 65535) throw new TypeError("--port must be 1..65535");
  if (!["reading", "motion"].includes(path)) throw new TypeError("--path must be reading or motion");
  const target = adbTargetArgs(adbState());
  if (!target) throw new Error("exactly one authorized Android transport is required");
  const reversed = command("adb", [...target, "reverse", `tcp:${port}`, `tcp:${port}`]);
  if (reversed === null) throw new Error("Android loopback workload forwarding failed");
  const displayOutput = command("adb", [...target, "shell", "cmd", "display", "get-displays", "-i", "--type", "virtual"]);
  const ids = (displayOutput ?? "").match(/\d+/gu) ?? [];
  if (ids.length !== 1) throw new Error("exactly one Android virtual display is required");
  const launched = command("adb", [
    ...target,
    "shell",
    "am",
    "start",
    "--display",
    ids[0],
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `http://127.0.0.1:${port}/${path}`,
  ]);
  if (launched === null) throw new Error("Android workload launch failed");
  process.stdout.write("workload-launch-intent-sent-to-one-virtual-display\n");
}

function usage() {
  return `Usage:
  node scripts/device-projection-experiment.mjs doctor
  node scripts/device-projection-experiment.mjs sample --label=idle [--output=/tmp/sample.jsonl]
  node scripts/device-projection-experiment.mjs measure --label=idle --duration=60 [--interval=5] [--process-token=name] [--output=/tmp/run.jsonl]
  node scripts/device-projection-experiment.mjs serve-workload [--port=0]
  node scripts/device-projection-experiment.mjs probe-wireless-reconnect
  node scripts/device-projection-experiment.mjs summarize --input=/tmp/run.jsonl [--output=/tmp/summary.json]
  node scripts/device-projection-experiment.mjs launch-workload-on-virtual --port=N [--path=reading|motion]
  node scripts/device-projection-experiment.mjs run <profile> [--label=name] [--duration=60] [--interval=5] [--output=/tmp/run.jsonl] [--app=Chrome]

Profiles: ${Object.keys(PROFILES).join(", ")}
`;
}

async function main(argv) {
  const [action, subject, ...rest] = argv;
  if (!action || action === "--help" || action === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (action === "doctor") {
    const state = adbState();
    process.stdout.write(`${JSON.stringify({
      scrcpy: command("scrcpy", ["--version"])?.split(/\r?\n/u)[0] ?? "unavailable",
      adb: command("adb", ["version"])?.split(/\r?\n/u)[0] ?? "unavailable",
      android: state,
      androidUsbCandidateCount: androidUsbCandidateCount(),
      hostDisplays: hostDisplays(),
    }, null, 2)}\n`);
    return;
  }
  if (action === "sample") {
    const options = parseOptions([subject, ...rest].filter(Boolean));
    writeSample(
      collectSample(options.get("label") ?? "sample", options.get("process-token") ?? null),
      options.get("output"),
    );
    return;
  }
  if (action === "measure") {
    await measureOnly(parseOptions([subject, ...rest].filter(Boolean)));
    return;
  }
  if (action === "serve-workload") {
    await serveWorkload(parseOptions([subject, ...rest].filter(Boolean)));
    return;
  }
  if (action === "probe-wireless-reconnect") {
    await probeWirelessReconnect();
    return;
  }
  if (action === "summarize") {
    summarizeFile(parseOptions([subject, ...rest].filter(Boolean)));
    return;
  }
  if (action === "launch-workload-on-virtual") {
    launchWorkloadOnVirtualDisplay(parseOptions([subject, ...rest].filter(Boolean)));
    return;
  }
  if (action === "run" && subject) {
    await runProfile(subject, parseOptions(rest));
    return;
  }
  throw new TypeError("invalid command");
}

if (process.argv[1]?.endsWith("device-projection-experiment.mjs")) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`device projection experiment failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
