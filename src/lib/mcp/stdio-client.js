import { spawn } from "node:child_process";
import process from "node:process";

function buildMessage(payload) {
  return Buffer.from(`${JSON.stringify(payload)}\n`, "utf8");
}

function parseCommand(command, args = []) {
  let normalizedCommand = command;
  let useShell = false;
  if (process.platform === "win32") {
    const lower = String(command).toLowerCase();
    if (lower === "npx") {
      normalizedCommand = "npx.cmd";
      useShell = true;
    } else if (lower === "npm") {
      normalizedCommand = "npm.cmd";
      useShell = true;
    } else if (lower === "node") {
      normalizedCommand = "node.exe";
    }
  }

  return {
    command: normalizedCommand,
    args: Array.isArray(args) ? args : [],
    useShell,
  };
}

export class McpStdioClient {
  constructor(options) {
    const parsed = parseCommand(options.command, options.args);
    this.command = parsed.command;
    this.args = parsed.args;
    this.useShell = parsed.useShell;
    this.cwd = options.cwd;
    this.env = options.env || process.env;
    this.child = null;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.nextId = 1;
    this.initialized = false;
    this.stderr = "";
    this.onLog = options.onLog || null;
  }

  async start() {
    if (this.child) {
      return;
    }

    try {
      this.child = spawn(this.command, this.args, {
        cwd: this.cwd,
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
        shell: this.useShell,
      });
    } catch (error) {
      throw new Error(
        `Failed to start MCP command "${this.command}": ${error?.message || error}`
      );
    }

    this.child.stdout.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.#drainBuffer();
    });

    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      this.stderr += text;
      if (this.onLog) {
        this.onLog(text);
      }
    });

    this.child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });

    this.child.on("exit", (code) => {
      const error = new Error(
        `MCP process exited with code ${code}. ${this.stderr}`.trim()
      );
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    });

    await this.initialize();
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    const result = await this.request("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: {
        name: "portfolio-weekly-intelligence-reporter",
        version: "0.1.0",
      },
    });

    await this.notify("notifications/initialized", {});
    this.initialized = true;
    this.serverInfo = result?.serverInfo;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result?.tools || [];
  }

  async callTool(name, args = {}) {
    return this.request("tools/call", {
      name,
      arguments: args,
    });
  }

  async notify(method, params) {
    const payload = {
      jsonrpc: "2.0",
      method,
      params,
    };
    this.child.stdin.write(buildMessage(payload));
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const payload = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };
      this.child.stdin.write(buildMessage(payload));
    });
  }

  close() {
    if (!this.child) {
      return;
    }
    this.child.kill();
    this.child = null;
  }

  #drainBuffer() {
    while (true) {
      const newlineIndex = this.buffer.indexOf("\n");
      if (newlineIndex === -1) {
        return;
      }
      const body = this.buffer.slice(0, newlineIndex).toString("utf8").trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (!body) {
        continue;
      }
      const payload = JSON.parse(body);
      this.#handlePayload(payload);
    }
  }

  #handlePayload(payload) {
    if (payload.id === undefined) {
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }
    this.pending.delete(payload.id);

    if (payload.error) {
      pending.reject(
        new Error(payload.error.message || JSON.stringify(payload.error))
      );
      return;
    }

    pending.resolve(payload.result);
  }
}
