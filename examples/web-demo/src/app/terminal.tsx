"use client";

import { Terminal as Xterm } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

type FitAddon = import("xterm-addon-fit").FitAddon;
let FitAddon: ["error", any] | typeof import("xterm-addon-fit").FitAddon;
try {
  FitAddon = require("xterm-addon-fit").FitAddon;
} catch (e) {
  FitAddon = ["error", e];
}

export type TerminalController = {
  onData: (cb: (data: Uint8Array) => void) => void,
  write(data: Uint8Array | string): void,
};

export default function Terminal(props: {
  onInit?: (terminal: TerminalController) => void,
}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const [fitAddon, setFitAddon] = useState<FitAddon | null>(null);
  const onInitRef = useRef(props.onInit);

  useEffect(() => {
    onInitRef.current = props.onInit;
  }, [props.onInit]);

  useEffect(() => {
    if (!terminalRef.current) {
      throw new Error("Terminal ref is not set");
    }

    const terminal = new Xterm({
      rows: 10,
    });
    if (Array.isArray(FitAddon)) {
      throw FitAddon[1];
    }
    const fitAddon = new FitAddon();
    setFitAddon(fitAddon);
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    onInitRef.current?.({
      onData: (cb) => terminal.onData(data => {
        const uint8Array = new TextEncoder().encode(data);
        cb(uint8Array);
      }),
      write: (data) => terminal.write(data),
    });

    return () => {
      terminal.dispose();
    };
  }, [terminalRef]);

  useEffect(() => {
    if (fitAddon) {
      const listener = () => {
        fitAddon.fit();
      };
      window.addEventListener("resize", listener);
      listener();
      return () => {
        window.removeEventListener("resize", listener);
      };
    }
  }, [fitAddon]);

  return (
    <div
      style={{
        height: "150px",
      }}
      ref={terminalRef}
    ></div>
  );
}
