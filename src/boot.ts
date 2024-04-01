import { Ipv4Address } from "./addresses/ip-address.js";
import { MacAddress } from "./addresses/mac-address.js";
import { NetworkAdapter } from "./network-adapter.js";
import { wait } from "./utils/wait.js";
import libv86 from "./dependencies/libv86.js";
import { Logger } from "./logger.js";

// Load binaries dynamically to decrease blocking bundle size
const binariesPromise = Promise.all([
  import("./binaries/v86wasm.js"),
  import("./binaries/state128.js"),
]);

const memorySizeMb = 128;

export async function bootEmulator(options: { subtle?: { v86Options?: any } }): Promise<any> {
  const startTime = performance.now();
  const t = () => `t=${Math.round(performance.now() - startTime)}ms`;
  Logger.log(t(), "Starting emulator boot sequence");

  const [{ v86Wasm }, { pgmockState128MbMemory }] = await binariesPromise;
  Logger.log(t(), "Binaries loaded");

  const v86Options = {
    wasm_fn: async (param: any) => {
      return (await WebAssembly.instantiate(v86Wasm, param)).instance.exports;
    },
    memory_size: memorySizeMb * 1024 * 1024,
    filesystem: {
      // no arguments means in-memory file system
    },
    network_adapter: (bus: any) => new NetworkAdapter(bus),
    preserve_mac_from_state_image: true,
    mac_address_translation: false,
    autostart: true,
    disable_keyboard: true,
    disable_mouse: true,
    disable_speaker: true,
    acpi: true,
    initial_state: pgmockState128MbMemory,
    ...Object.fromEntries(Object.entries(options?.subtle?.v86Options ?? {}).filter(([_, v]) => v !== undefined)),
  };


  // Create emulator
  const emulator = new libv86.V86(v86Options);
  const readyPromise = new Promise((resolve) => emulator.add_listener("emulator-ready", resolve));
  const loadedPromise = new Promise((resolve) => emulator.add_listener("emulator-loaded", resolve));
  // run a command to preload postgres command cache
  sendScript(emulator, "preloader", `psql -U postgres -c "\dt"`);
  Logger.log(t(), "Emulator created");


  // Register device as soon as emulator is ready
  await readyPromise;
  emulator.serial0_send(`\\! echo "boot_completed" && reset && echo Welcome to the serial console of your pgmock database.\n`);
  const device = emulator.network_adapter.router.registerDevice(new MacAddress("00:22:15:64:7B:90"));
  if (!device.ip.equals(new Ipv4Address([192, 168, 0, 1]))) {
    throw new Error(`Device IP address is not right. This is an error in pgmock; please report it (expected 192.168.0.1, actual ${device.ipAddress})`);
  }
  Logger.log(t(), "Emulator ready");


  // Wait for the emulator to be fully loaded before continuing
  await loadedPromise;
  Logger.log(t(), "Emulator loaded");


  // Make sure everything went well by pinging the device
  const pingPromise = emulator.network_adapter.ethernet.protocols.ipv4.protocols.icmp.ping({
    srcIp: new Ipv4Address([192, 168, 13, 37]),
    destIp: new Ipv4Address([192, 168, 0, 1]),
  });
  const timeoutPromise = wait(10_000).then(() => "timeout");
  if (await Promise.race([pingPromise, timeoutPromise]) === "timeout") {
    throw new Error("Ping timed out while trying to boot pgmock. This is an error in pgmock; please report this");
  }
  Logger.log(t(), "Ping successful");


  return emulator;
};

export function sendScript(emulator: any, name: string, text: string) {
  const script = new TextEncoder().encode(text);
  emulator.create_file("/inbox/" + name + ".sh", script);
}
