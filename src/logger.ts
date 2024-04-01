type LogMessage = [
  level: number,
  args: any[],
  options: { groupType: "start" | "end" | null },
];

type Sink = (...log: LogMessage) => void;

const sinks: Sink[] = [];

function logAtLevel(...log: LogMessage) {
  sinks.forEach((sink) => sink(...log));
}

export const Logger = {
  addSink: (sink: Sink) => {
    sinks.push(sink);
  },
  log: (...args: any[]) => {
    logAtLevel(0, args, { groupType: null });
  },
  warn: (...args: any[]) => {
    logAtLevel(1, args, { groupType: null });
  },
  error: (...args: any[]) => {
    logAtLevel(2, args, { groupType: null });
  },
  group: (...args: any[]) => {
    logAtLevel(0, args, { groupType: "start" });
  },
  groupEnd: (...args: any[]) => {
    logAtLevel(0, args, { groupType: "end" });
  },
};

if (typeof process !== "undefined" && process.env.PGMOCK_ENABLE_CONSOLE_LOGGING) {
  Logger.addSink((level, args, options) => {
    const method = 
      options.groupType === "start" ? "group"
      : options.groupType === "end" ? "groupEnd"
      : level === 0 ? "log"
      : level === 1 ? "warn"
      : "error";

    console[method](...args);
  });
}
