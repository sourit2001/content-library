/**
 * AI chat back ends.
 *
 * Claude, Codex and Grok run through the official CLI the user has installed and
 * signed in on this computer, so a chat uses that tool's own login and plan. The
 * plugin never reads or stores those credentials. DeepSeek has no CLI with a
 * subscription, so it calls the DeepSeek API with the user's own key.
 */
import { FileSystemAdapter, Platform, requestUrl, type App } from "obsidian";
import { t } from "./i18n";

export type AIProviderId = "claude" | "codex" | "grok" | "deepseek";
export type CliProviderId = Exclude<AIProviderId, "deepseek">;

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  cli?: string;
  install: string;
  login: string;
  note: string;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: "claude",
    label: "Claude",
    cli: "claude",
    install: "curl -fsSL https://claude.ai/install.sh | bash",
    login: "claude",
    note: "用你在 Claude Code 里登录的账号。订阅用户在插件里的对话扣每月 Agent SDK 额度。",
  },
  {
    id: "codex",
    label: "Codex",
    cli: "codex",
    install: "npm install -g @openai/codex",
    login: "codex login",
    note: "用你在 Codex CLI 里登录的 ChatGPT 账号，扣套餐内的 Codex 额度。",
  },
  {
    id: "grok",
    label: "Grok",
    cli: "grok",
    install: "https://docs.x.ai/build/cli",
    login: "grok login --device-auth",
    note: "用你在 Grok CLI 里登录的 SuperGrok / X Premium+ 账号。",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    install: "https://platform.deepseek.com/api_keys",
    login: "",
    note: "DeepSeek 没有可用订阅额度的命令行工具，需要在设置里填自己的 API Key，按量计费。",
  },
];

export function providerInfo(id: AIProviderId): AIProviderInfo {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? AI_PROVIDERS[0]!;
}

export interface AIMessage {
  role: "user" | "assistant";
  text: string;
  time: number;
}

export interface AIRunOptions {
  provider: AIProviderId;
  prompt: string;
  history: AIMessage[];
  sessionId: string;
  cwd: string;
  binPath: string;
  /** Proxy URL for the CLI (e.g. http://127.0.0.1:7890); empty = detect automatically. */
  proxy: string;
  /** Optional model override for the CLI (empty = the CLI's own default). */
  model: string;
  deepseekKey: string;
  deepseekModel: string;
  onText: (fullText: string) => void;
  onActivity: (label: string) => void;
}

export interface AIRunResult {
  text: string;
  sessionId: string;
}

export interface AIRun {
  done: Promise<AIRunResult>;
  stop: () => void;
}

/* ------------------------------------------------------------------ */
/* Node helpers (desktop only, loaded lazily so mobile still loads)    */
/* ------------------------------------------------------------------ */

type ChildProcess = {
  stdout: { on(event: "data", cb: (chunk: Buffer) => void): void };
  stderr: { on(event: "data", cb: (chunk: Buffer) => void): void };
  on(event: "close", cb: (code: number | null) => void): void;
  on(event: "error", cb: (error: Error) => void): void;
  kill(signal?: string): void;
  pid?: number;
};
type NodeChildProcess = {
  spawn(cmd: string, args: string[], options: Record<string, unknown>): ChildProcess;
  execFile(cmd: string, args: string[], options: Record<string, unknown>, cb: (error: Error | null, stdout: string, stderr: string) => void): void;
};

function nodeRequire<T>(name: string): T | null {
  if (!Platform.isDesktopApp) return null;
  try {
    const req = (window as unknown as { require?: (id: string) => unknown }).require;
    return (req ? req(name) : null) as T | null;
  } catch {
    return null;
  }
}

export function cliSupported(): boolean {
  return Platform.isDesktopApp && nodeRequire<NodeChildProcess>("child_process") !== null;
}

export function vaultPath(app: App): string {
  const adapter = app.vault.adapter;
  return adapter instanceof FileSystemAdapter ? adapter.getBasePath() : "";
}

let cachedPath: Promise<string> | null = null;

/**
 * Apps launched from the Dock get a bare PATH, so `claude`, `codex`, `node` etc.
 * are usually missing. Merge the login shell's PATH with the usual install dirs.
 */
function searchPath(): Promise<string> {
  if (cachedPath) return cachedPath;
  cachedPath = (async () => {
    const proc = (globalThis as unknown as { process?: { env: Record<string, string | undefined>; platform: string } }).process;
    const env = proc?.env ?? {};
    const isWin = proc?.platform === "win32";
    const sep = isWin ? ";" : ":";
    const home = env.HOME ?? env.USERPROFILE ?? "";
    const parts: string[] = (env.PATH ?? "").split(sep).filter(Boolean);
    if (!isWin) {
      const shellPath = await loginShellPath(env.SHELL || "/bin/zsh");
      parts.unshift(...shellPath.split(":").filter(Boolean));
      parts.push(
        `${home}/.local/bin`, `${home}/.claude/local`, `${home}/.npm-global/bin`, `${home}/.bun/bin`,
        `${home}/.volta/bin`, `${home}/.grok/bin`, `${home}/.cargo/bin`, "/opt/homebrew/bin", "/usr/local/bin",
      );
      const fs = nodeRequire<{ readdirSync(path: string): string[] }>("fs");
      try {
        for (const version of fs?.readdirSync(`${home}/.nvm/versions/node`) ?? []) parts.push(`${home}/.nvm/versions/node/${version}/bin`);
      } catch {
        // no nvm
      }
    } else if (env.APPDATA) {
      parts.push(`${env.APPDATA}\\npm`, `${home}\\.local\\bin`);
    }
    return Array.from(new Set(parts)).join(sep);
  })();
  return cachedPath;
}

let cachedShellEnv: Promise<Record<string, string>> | null = null;

/**
 * The login shell's environment. Terminal users often set a proxy (HTTPS_PROXY…) or
 * API settings in ~/.zshrc; an app opened from the Dock never sees those, so the CLI
 * would work in Terminal but fail here (e.g. Claude's "403 Request not allowed").
 */
function loginShellEnv(): Promise<Record<string, string>> {
  if (cachedShellEnv) return cachedShellEnv;
  const cp = nodeRequire<NodeChildProcess>("child_process");
  const proc = (globalThis as unknown as { process?: { env: Record<string, string | undefined>; platform: string } }).process;
  if (!cp || proc?.platform === "win32") return (cachedShellEnv = Promise.resolve({}));
  const shell = proc?.env.SHELL || "/bin/zsh";
  cachedShellEnv = new Promise((resolve) => {
    try {
      cp.execFile(shell, ["-ilc", "printf '__CLD_ENV__'; env; printf '__CLD_ENV__'"], { timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => {
        const match = /__CLD_ENV__([\s\S]*?)__CLD_ENV__/.exec(stdout ?? "");
        const out: Record<string, string> = {};
        for (const line of (match?.[1] ?? "").split("\n")) {
          const eq = line.indexOf("=");
          if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
        }
        resolve(out);
      });
    } catch {
      resolve({});
    }
  });
  return cachedShellEnv;
}

let cachedSystemProxy: Promise<string> | null = null;

/** The macOS system proxy (what VPN apps set), as an http:// URL; "" when none. */
function systemProxy(): Promise<string> {
  if (cachedSystemProxy) return cachedSystemProxy;
  const cp = nodeRequire<NodeChildProcess>("child_process");
  const proc = (globalThis as unknown as { process?: { platform: string } }).process;
  if (!cp || proc?.platform !== "darwin") return (cachedSystemProxy = Promise.resolve(""));
  cachedSystemProxy = new Promise((resolve) => {
    cp.execFile("/usr/sbin/scutil", ["--proxy"], { timeout: 3000 }, (_error, stdout) => {
      const value = (key: string) => new RegExp(`\\b${key}\\s*:\\s*(\\S+)`).exec(stdout ?? "")?.[1] ?? "";
      if (value("HTTPSEnable") === "1" && value("HTTPSProxy") && value("HTTPSPort")) {
        resolve(`http://${value("HTTPSProxy")}:${value("HTTPSPort")}`);
      } else if (value("HTTPEnable") === "1" && value("HTTPProxy") && value("HTTPPort")) {
        resolve(`http://${value("HTTPProxy")}:${value("HTTPPort")}`);
      } else if (value("SOCKSEnable") === "1" && value("SOCKSProxy") && value("SOCKSPort")) {
        resolve(`socks5://${value("SOCKSProxy")}:${value("SOCKSPort")}`);
      } else {
        resolve("");
      }
    });
  });
  return cachedSystemProxy;
}

async function loginShellPath(_shell: string): Promise<string> {
  return (await loginShellEnv()).PATH ?? "";
}

const SHELL_ENV_KEYS = /^(https?_proxy|all_proxy|no_proxy|socks_proxy|ANTHROPIC_\w+|CLAUDE_\w+|OPENAI_\w+|CODEX_\w+|XAI_\w+|GROK_\w+|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|LANG|LC_ALL)$/i;

async function childEnv(proxyOverride = ""): Promise<Record<string, string | undefined>> {
  const proc = (globalThis as unknown as { process?: { env: Record<string, string | undefined> } }).process;
  const fromShell = await loginShellEnv();
  const extra: Record<string, string> = {};
  for (const [key, value] of Object.entries(fromShell)) if (SHELL_ENV_KEYS.test(key)) extra[key] = value;
  const env: Record<string, string | undefined> = { ...(proc?.env ?? {}), ...extra, PATH: await searchPath(), NO_COLOR: "1", TERM: "dumb" };
  // VPN apps usually set the macOS *system* proxy. Codex follows it, but Node-based CLIs
  // (Claude Code) don't, so their requests leave without the VPN and get refused
  // (Anthropic answers "403 Request not allowed"). Hand the system proxy to the CLI.
  if (proxyOverride.trim()) {
    const url = /^\w+:\/\//.test(proxyOverride.trim()) ? proxyOverride.trim() : `http://${proxyOverride.trim()}`;
    env.HTTPS_PROXY = url;
    env.HTTP_PROXY = url;
    env.NO_PROXY = env.NO_PROXY ?? "localhost,127.0.0.1,::1";
    return env;
  }
  const hasProxy = Object.keys(env).some((key) => /^(https?_proxy|all_proxy)$/i.test(key) && env[key]);
  if (!hasProxy) {
    const proxy = await systemProxy();
    if (proxy) {
      env.HTTPS_PROXY = proxy;
      env.HTTP_PROXY = proxy;
      env.NO_PROXY = env.NO_PROXY ?? "localhost,127.0.0.1,::1";
    }
  }
  return env;
}

/** Resolve the CLI binary: the user's override, else the bare name looked up on our PATH. */
async function resolveBinary(name: string, override: string): Promise<string> {
  if (override.trim()) return override.trim();
  const fs = nodeRequire<{ existsSync(path: string): boolean }>("fs");
  const proc = (globalThis as unknown as { process?: { platform: string } }).process;
  const isWin = proc?.platform === "win32";
  const sep = isWin ? ";" : ":";
  for (const dir of (await searchPath()).split(sep)) {
    for (const candidate of isWin ? [`${dir}\\${name}.cmd`, `${dir}\\${name}.exe`] : [`${dir}/${name}`]) {
      if (fs?.existsSync(candidate)) return candidate;
    }
  }
  return "";
}

export interface CliStatus {
  installed: boolean;
  path: string;
  version: string;
}

export async function detectCli(provider: CliProviderId, override: string): Promise<CliStatus> {
  const cp = nodeRequire<NodeChildProcess>("child_process");
  const name = providerInfo(provider).cli!;
  if (!cp) return { installed: false, path: "", version: "" };
  const path = await resolveBinary(name, override);
  if (!path) return { installed: false, path: "", version: "" };
  const env = await childEnv();
  return new Promise((resolve) => {
    cp.execFile(path, ["--version"], { timeout: 8000, env, shell: path.endsWith(".cmd") }, (error, stdout, stderr) => {
      const version = (stdout || stderr || "").trim().split("\n")[0] ?? "";
      resolve({ installed: !error || Boolean(version), path, version });
    });
  });
}

/* ------------------------------------------------------------------ */
/* Running a turn                                                      */
/* ------------------------------------------------------------------ */

export function runAI(options: AIRunOptions): AIRun {
  if (options.provider === "deepseek") return runDeepSeek(options);
  return runCli(options);
}

function newSessionId(): string {
  const cryptoObj = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** When a session can't be resumed, replay the conversation as plain text instead. */
function promptWithHistory(history: AIMessage[], prompt: string): string {
  if (history.length === 0) return prompt;
  const recent = history.slice(-12).map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.text}`).join("\n\n");
  return `Earlier in this conversation:\n\n${recent}\n\nUser: ${prompt}`;
}

function cliArgs(provider: CliProviderId, prompt: string, sessionId: string, cwd: string, resume: boolean, model: string): string[] {
  const modelArgs = model.trim() ? (provider === "claude" ? ["--model", model.trim()] : ["-m", model.trim()]) : [];
  switch (provider) {
    case "claude": {
      const args = [
        "-p", prompt,
        "--output-format", "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--allowedTools", "Read", "Glob", "Grep", "WebSearch", "WebFetch",
      ];
      if (resume && sessionId) args.push("--resume", sessionId);
      return [...args, ...modelArgs];
    }
    case "codex": {
      // `exec resume` has no --sandbox flag, so set the same read-only mode through config.
      if (resume && sessionId) return ["exec", "resume", "--json", "--skip-git-repo-check", "-c", 'sandbox_mode="read-only"', ...modelArgs, sessionId, prompt];
      return ["exec", "--json", "--skip-git-repo-check", "--sandbox", "read-only", ...modelArgs, "-C", cwd, prompt];
    }
    case "grok":
      return ["-p", prompt, "--output-format", "json", "--cwd", cwd, "-s", sessionId, "--no-auto-update", ...modelArgs];
  }
}

function runCli(options: AIRunOptions): AIRun {
  const provider = options.provider as CliProviderId;
  let child: ChildProcess | null = null;
  let stopped = false;
  const isWin = (globalThis as unknown as { process?: { platform: string } }).process?.platform === "win32";
  /** Kill the CLI and everything it started (it runs in its own process group). */
  const killChild = () => {
    const current = child;
    if (!current) return;
    const proc = (globalThis as unknown as { process?: { kill(pid: number, signal: string): void } }).process;
    try {
      if (!isWin && current.pid && proc) proc.kill(-current.pid, "SIGKILL");
      else current.kill("SIGKILL");
    } catch {
      try { current.kill("SIGKILL"); } catch { /* already gone */ }
    }
  };

  const attempt = async (resume: boolean): Promise<AIRunResult & { failed?: string; fatal?: boolean }> => {
    const cp = nodeRequire<NodeChildProcess>("child_process");
    if (!cp) throw new Error(t("命令行 AI 只能在电脑版 Obsidian 里使用。"));
    const bin = await resolveBinary(providerInfo(provider).cli!, options.binPath);
    if (!bin) throw new Error(t("没找到 {name} 命令行工具，请先安装并登录。", { name: providerInfo(provider).label }));
    let sessionId = options.sessionId || (provider === "grok" ? newSessionId() : "");
    let prompt = resume ? options.prompt : promptWithHistory(options.history, options.prompt);
    if (prompt.startsWith("-")) prompt = ` ${prompt}`; // never let a prompt be read as a flag
    const args = cliArgs(provider, prompt, sessionId, options.cwd, resume, options.model);
    const env = await childEnv(options.proxy);
    // If Obsidian was started from inside a Claude Code terminal, don't look like a nested session.
    if (provider === "claude") for (const key of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_SESSION_ID"]) delete env[key];

    return new Promise((resolve, reject) => {
      let text = "";
      let finalText = "";
      let stderr = "";
      let buffer = "";
      let errorMessage = "";
      try {
        // No stdin: a CLI that waits for keyboard input would otherwise hang forever.
        child = cp.spawn(bin, args, {
          cwd: options.cwd || undefined,
          env,
          shell: bin.endsWith(".cmd"),
          stdio: ["ignore", "pipe", "pipe"],
          detached: !isWin,
        });
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      // Watchdog: no output at all for a while means the CLI is stuck (retrying, waiting on something).
      let timedOut = false;
      let idleTimer = 0;
      const bump = () => {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          timedOut = true;
          killChild();
        }, IDLE_TIMEOUT_MS);
      };
      bump();
      // An error the CLI can't recover from (wrong model, signed out): stop now instead of letting it retry.
      const checkFatal = (message: string) => {
        if (FATAL_ERROR.test(message)) {
          errorMessage = friendlyError(provider, message);
          killChild();
        }
      };

      const handleEvent = (event: Record<string, unknown>) => {
        const result = parseEvent(provider, event);
        if (result.sessionId) sessionId = result.sessionId;
        if (result.delta) {
          text += result.delta;
          options.onText(text);
        }
        if (result.message !== undefined) {
          // A complete assistant message: prefer it over the streamed deltas for that message.
          finalText = finalText ? `${finalText}\n\n${result.message}` : result.message;
          text = finalText;
          options.onText(text);
        }
        if (result.final !== undefined && !text.trim()) {
          text = result.final;
          options.onText(text);
        }
        if (result.activity) options.onActivity(result.activity);
        if (result.error) {
          errorMessage = friendlyError(provider, result.error);
          checkFatal(result.error);
        }
      };

      child.stdout.on("data", (chunk: Buffer) => {
        bump();
        buffer += chunk.toString("utf8");
        if (provider === "grok") return; // one JSON object at the end; parsed on close
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            handleEvent(JSON.parse(trimmed) as Record<string, unknown>);
          } catch {
            // not an event line (progress output); ignore
          }
        }
      });
      child.stderr.on("data", (chunk: Buffer) => {
        bump();
        const piece = chunk.toString("utf8");
        stderr += piece;
        checkFatal(piece);
      });
      child.on("error", (error) => {
        window.clearTimeout(idleTimer);
        reject(error);
      });
      child.on("close", (code) => {
        window.clearTimeout(idleTimer);
        child = null;
        const rest = buffer.trim();
        if (rest) {
          try {
            handleEvent(JSON.parse(rest) as Record<string, unknown>);
          } catch {
            // Grok's single JSON object can span lines, or the CLI fell back to plain text.
            if (!text.trim()) {
              text = rest;
              options.onText(text);
            }
          }
        }
        if (errorMessage && FATAL_ERROR.test(errorMessage + stderr) && !stopped) {
          resolve({ text: "", sessionId, failed: errorMessage, fatal: true });
          return;
        }
        if (timedOut && !stopped) {
          const detail = errorMessage || cleanStderr(stderr);
          resolve({
            text: "",
            sessionId,
            failed: t("{name} 超过 {seconds} 秒没有任何输出，已自动停止。", { name: providerInfo(provider).label, seconds: String(IDLE_TIMEOUT_MS / 1000) }) + (detail ? `\n\n${detail.slice(0, 800)}` : ""),
            fatal: true,
          });
          return;
        }
        if (stopped) {
          resolve({ text: text.trim() ? `${text}\n\n_${t("已停止")}_` : `_${t("已停止")}_`, sessionId });
          return;
        }
        if (code !== 0 && !text.trim()) {
          const detail = (errorMessage || cleanStderr(stderr) || t("退出码 {code}", { code: String(code) })).slice(0, 1200);
          resolve({ text: "", sessionId, failed: detail });
          return;
        }
        if (errorMessage && !text.trim()) {
          resolve({ text: "", sessionId, failed: errorMessage });
          return;
        }
        resolve({ text: text.trim(), sessionId });
      });
    });
  };

  const done = (async () => {
    const canResume = Boolean(options.sessionId) && options.history.length > 0;
    let result = await attempt(canResume);
    if (result.failed && !result.fatal && canResume && !stopped) {
      // The CLI may have dropped the session (or its resume flags changed); carry the context over.
      options.onActivity(t("无法继续原会话，正在带上前文重新开始…"));
      options.sessionId = "";
      result = await attempt(false);
    }
    if (result.failed) throw new Error(result.failed);
    return { text: result.text, sessionId: result.sessionId };
  })();

  return {
    done,
    stop: () => {
      stopped = true;
      killChild();
    },
  };
}

const IDLE_TIMEOUT_MS = 120_000;
const FATAL_ERROR = /model_not_found|model is not supported|not supported when using|invalid_request_error|unauthori[sz]ed|\b401\b|not logged in|please run \/?login|invalid api key|authentication|\b403\b|request not allowed/i;

function friendlyError(provider: CliProviderId, message: string): string {
  let text = message;
  // Codex/Claude often wrap the real reason in a JSON blob.
  try {
    const parsed = JSON.parse(message.slice(message.indexOf("{"))) as Record<string, unknown>;
    text = str(obj(parsed.error).message) || str(parsed.detail) || str(parsed.message) || message;
  } catch {
    // plain text
  }
  if (/model_not_found|model is not supported|not supported when using/i.test(message)) {
    return `${text}\n\n${t("你的账号用不了这个模型。到插件设置“AI 对话”里给 {name} 填一个你的套餐支持的模型，或者在终端运行 {cli}，输入 /model 选一个，选完之后这里会跟着用。", { name: providerInfo(provider).label, cli: providerInfo(provider).cli! })}`;
  }
  if (/unauthori[sz]ed|\b401\b|not logged in|please run \/?login|invalid api key|authentication/i.test(message)) {
    return `${text}\n\n${t("{name} 还没登录或登录已过期。在终端运行 {login} 重新登录。", { name: providerInfo(provider).label, login: providerInfo(provider).login })}`;
  }
  if (/\b403\b|request not allowed|forbidden/i.test(message)) {
    return `${text}\n\n${t("请求被 {name} 拒绝。先在终端里试 {cli} -p \"hi\"：终端里也报这个错，说明是账号或网络（所在地区不支持）问题，可以运行 {cli} update 更新后重新登录；终端里正常、只有这里报错，请告诉作者。", { name: providerInfo(provider).label, cli: providerInfo(provider).cli! })}`;
  }
  return text;
}

function cleanStderr(stderr: string): string {
  return stderr.split("\n").map((line) => line.trim()).filter((line) => line && !/^\s*at\s/.test(line)).slice(-6).join("\n");
}

interface ParsedEvent {
  sessionId?: string;
  delta?: string;
  message?: string;
  final?: string;
  activity?: string;
  error?: string;
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function parseEvent(provider: CliProviderId, event: Record<string, unknown>): ParsedEvent {
  if (provider === "claude") return parseClaudeEvent(event);
  if (provider === "codex") return parseCodexEvent(event);
  return parseGrokEvent(event);
}

function parseClaudeEvent(event: Record<string, unknown>): ParsedEvent {
  const type = str(event.type);
  const out: ParsedEvent = {};
  if (str(event.session_id)) out.sessionId = str(event.session_id);
  if (type === "stream_event") {
    const inner = obj(event.event);
    const delta = obj(inner.delta);
    if (str(inner.type) === "content_block_delta" && str(delta.type) === "text_delta") out.delta = str(delta.text);
    if (str(inner.type) === "message_start") out.activity = t("正在思考…");
  } else if (type === "assistant") {
    const content = obj(event.message).content;
    if (Array.isArray(content)) {
      const texts = content.filter((block) => str(obj(block).type) === "text").map((block) => str(obj(block).text)).filter(Boolean);
      const joined = texts.join("\n\n");
      // Claude Code reports API failures (403, auth…) as an assistant message flagged as an error.
      const apiError = str(event.error) || (event.isApiErrorMessage === true || obj(event.message).isApiErrorMessage === true ? "api_error" : "")
        || (/^(Failed to authenticate|API Error:|Invalid API key|Please run \/login)/i.test(joined) ? "api_error" : "");
      if (apiError && joined) out.error = joined;
      else if (texts.length) out.message = joined;
      const tool = content.find((block) => str(obj(block).type) === "tool_use");
      if (tool) out.activity = toolActivity(str(obj(tool).name), obj(obj(tool).input));
    }
  } else if (type === "result") {
    out.final = str(event.result);
    if (event.is_error === true) out.error = str(event.result) || t("Claude 返回了错误");
  }
  return out;
}

function toolActivity(name: string, input: Record<string, unknown>): string {
  const target = str(input.file_path) || str(input.path) || str(input.pattern) || str(input.query) || str(input.url) || str(input.command);
  const short = target.length > 48 ? `…${target.slice(-46)}` : target;
  return short ? t("正在使用 {tool}：{target}", { tool: name, target: short }) : t("正在使用 {tool}", { tool: name });
}

function parseCodexEvent(event: Record<string, unknown>): ParsedEvent {
  const type = str(event.type);
  const out: ParsedEvent = {};
  if (type === "thread.started") out.sessionId = str(event.thread_id);
  if (type === "item.started" || type === "item.updated" || type === "item.completed") {
    const item = obj(event.item);
    const itemType = str(item.type) || str(item.item_type);
    if (itemType === "agent_message" || itemType === "assistant_message") {
      if (type === "item.completed") out.message = str(item.text);
    } else if (itemType === "error") {
      out.error = str(item.message) || str(item.text) || t("Codex 返回了错误");
    } else if (itemType === "reasoning") {
      out.activity = t("正在思考…");
    } else if (itemType === "command_execution") {
      out.activity = toolActivity(t("命令"), { command: str(item.command) });
    } else if (itemType === "web_search") {
      out.activity = toolActivity(t("网页搜索"), { query: str(item.query) });
    } else if (itemType) {
      out.activity = t("正在使用 {tool}", { tool: itemType });
    }
  }
  if (type === "turn.failed") out.error = str(obj(event.error).message) || t("Codex 返回了错误");
  if (type === "error") out.error = str(event.message);
  // Older Codex builds: { msg: { type: "agent_message", message } }
  const msg = obj(event.msg);
  if (str(msg.type) === "agent_message") out.message = str(msg.message);
  if (str(msg.type) === "session_configured") out.sessionId = str(msg.session_id);
  return out;
}

function parseGrokEvent(event: Record<string, unknown>): ParsedEvent {
  const out: ParsedEvent = {};
  const session = str(event.session_id) || str(event.sessionId);
  if (session) out.sessionId = session;
  const text = str(event.result) || str(event.response) || str(event.text) || str(event.content) || str(event.output)
    || str(obj(event.message).content) || str(event.message);
  if (text) out.final = text;
  else {
    // Unknown shape: take the longest string in the object as the reply.
    let best = "";
    const walk = (value: unknown, depth: number) => {
      if (depth > 6) return;
      if (typeof value === "string" && value.length > best.length) best = value;
      else if (Array.isArray(value)) value.forEach((entry) => walk(entry, depth + 1));
      else if (value && typeof value === "object") Object.entries(value).forEach(([key, entry]) => {
        if (!/id$|session|model|path|cwd|url/i.test(key)) walk(entry, depth + 1);
      });
    };
    walk(event, 0);
    if (best) out.final = best;
  }
  if (str(event.error) || str(obj(event.error).message)) out.error = str(event.error) || str(obj(event.error).message);
  return out;
}

/* ------------------------------------------------------------------ */
/* DeepSeek (API key)                                                  */
/* ------------------------------------------------------------------ */

function runDeepSeek(options: AIRunOptions): AIRun {
  let stopped = false;
  const done = (async () => {
    if (!options.deepseekKey.trim()) throw new Error(t("请先在插件设置的“AI 对话”里填写 DeepSeek API Key。"));
    options.onActivity(t("正在思考…"));
    const messages = [
      { role: "system", content: "You are a helpful assistant inside the user's Obsidian vault. Reply in the user's language and use Markdown." },
      ...options.history.slice(-20).map((message) => ({ role: message.role, content: message.text })),
      { role: "user", content: options.prompt },
    ];
    const response = await requestUrl({
      url: "https://api.deepseek.com/chat/completions",
      method: "POST",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${options.deepseekKey.trim()}` },
      body: JSON.stringify({ model: options.deepseekModel || "deepseek-chat", messages, stream: false }),
      throw: false,
    });
    if (stopped) return { text: `_${t("已停止")}_`, sessionId: "" };
    if (response.status >= 400) {
      const detail = str(obj(obj(response.json).error).message) || `HTTP ${response.status}`;
      throw new Error(response.status === 401 ? t("DeepSeek API Key 无效，请到设置里检查。") : detail);
    }
    const choice = obj((obj(response.json).choices as unknown[] | undefined)?.[0]);
    const text = str(obj(choice.message).content);
    options.onText(text);
    return { text, sessionId: "" };
  })();
  return { done, stop: () => { stopped = true; } };
}
