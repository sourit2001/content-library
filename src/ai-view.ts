import {
  ItemView,
  MarkdownRenderer,
  Notice,
  TFile,
  TFolder,
  normalizePath,
  setIcon,
  type WorkspaceLeaf,
} from "obsidian";
import type ContentLibraryDashboardPlugin from "./main";
import { dateLocale, t } from "./i18n";
import {
  AI_PROVIDERS,
  cliSupported,
  detectCli,
  providerInfo,
  runAI,
  vaultPath,
  type AIMessage,
  type AIProviderId,
  type AIRun,
  type CliProviderId,
  type CliStatus,
} from "./ai";

export const AI_CHAT_VIEW_TYPE = "content-library-ai-chat";

const MARKER = /^<!-- cld-ai (user|assistant) (\d+) -->$/;

interface Conversation {
  file: TFile | null;
  provider: AIProviderId;
  sessionId: string;
  created: number;
  messages: AIMessage[];
}

export class AIChatView extends ItemView {
  private conversation: Conversation;
  private status = new Map<CliProviderId, CliStatus | "checking">();
  private run: AIRun | null = null;
  private showHistory = false;
  private attachNote: boolean;
  private bodyEl!: HTMLElement;
  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private activityEl!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: ContentLibraryDashboardPlugin) {
    super(leaf);
    this.conversation = this.blankConversation(plugin.settings.aiProvider);
    this.attachNote = plugin.settings.aiAttachActiveNote;
  }

  override getViewType(): string {
    return AI_CHAT_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return t("AI 对话");
  }

  override getIcon(): string {
    return "bot-message-square";
  }

  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("cld-ai");
    this.render();
    void this.checkProviders();
    // Keep the "include note" chip showing which note will be sent.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.updateAttachLabel()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.updateAttachLabel()));
    this.registerInterval(window.setInterval(() => this.updateAttachLabel(), 1500));
  }

  override async onClose(): Promise<void> {
    this.run?.stop();
  }

  private blankConversation(provider: AIProviderId): Conversation {
    return { file: null, provider, sessionId: "", created: Date.now(), messages: [] };
  }

  /* ------------------------------ layout ------------------------------ */

  private render(): void {
    const root = this.contentEl;
    const draft = this.inputEl?.value ?? "";
    root.empty();

    const header = root.createDiv({ cls: "cld-ai-header" });
    const tabs = header.createDiv({ cls: "cld-ai-tabs" });
    for (const provider of AI_PROVIDERS) {
      const tab = tabs.createEl("button", { cls: "cld-ai-tab", text: provider.label });
      tab.toggleClass("is-active", provider.id === this.conversation.provider);
      const state = provider.id === "deepseek" ? (this.plugin.settings.deepseekApiKey ? "ok" : "off")
        : this.cliState(provider.id as CliProviderId);
      tab.createSpan({ cls: `cld-ai-dot is-${state}` });
      tab.addEventListener("click", () => this.switchProvider(provider.id));
    }
    const actions = header.createDiv({ cls: "cld-ai-actions" });
    this.iconButton(actions, "plus", t("新对话"), () => this.newConversation());
    this.iconButton(actions, "history", t("历史对话"), () => {
      this.showHistory = !this.showHistory;
      this.render();
    }).toggleClass("is-active", this.showHistory);
    this.iconButton(actions, "file-text", t("打开对话笔记"), () => {
      if (this.conversation.file) void this.app.workspace.getLeaf("tab").openFile(this.conversation.file);
      else new Notice(t("这段对话还没有内容。"));
    });

    this.bodyEl = root.createDiv({ cls: "cld-ai-body" });
    if (this.showHistory) {
      void this.renderHistory(this.bodyEl);
    } else {
      this.messagesEl = this.bodyEl.createDiv({ cls: "cld-ai-messages" });
      this.renderMessages();
    }

    this.activityEl = root.createDiv({ cls: "cld-ai-activity" });
    const composer = root.createDiv({ cls: "cld-ai-composer" });
    const tools = composer.createDiv({ cls: "cld-ai-composer-tools" });
    const attach = tools.createEl("button", { cls: "cld-ai-chip" });
    setIcon(attach.createSpan(), "paperclip");
    attach.createSpan({ cls: "cld-ai-chip-label", text: t("附带当前笔记") });
    attach.toggleClass("is-active", this.attachNote);
    attach.addEventListener("click", async () => {
      this.attachNote = !this.attachNote;
      attach.toggleClass("is-active", this.attachNote);
      this.updateAttachLabel();
      this.plugin.settings.aiAttachActiveNote = this.attachNote;
      await this.plugin.saveSettings(false);
    });
    tools.createSpan({ cls: "cld-ai-hint", text: t("Enter 发送 · Shift+Enter 换行") });

    const row = composer.createDiv({ cls: "cld-ai-input-row" });
    this.inputEl = row.createEl("textarea", {
      cls: "cld-ai-input",
      attr: { rows: "3", placeholder: t("问问 {name}…", { name: providerInfo(this.conversation.provider).label }) },
    });
    this.inputEl.value = draft;
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        void this.send();
      }
    });
    this.sendBtn = row.createEl("button", { cls: "cld-ai-send mod-cta" });
    this.updateSendButton();
    this.updateAttachLabel();
    this.sendBtn.addEventListener("click", () => {
      if (this.run) this.run.stop();
      else void this.send();
    });
  }

  /**
   * The note the user is looking at in the main area: an open Markdown tab, or the
   * note open in the dashboard's reader. Focus sits in this sidebar while typing,
   * so look at the most recent main-area leaf rather than the active one.
   */
  private currentNote(): TFile | null {
    const workspace = this.app.workspace;
    const leaf = workspace.getMostRecentLeaf(workspace.rootSplit);
    const view = leaf?.view as { file?: unknown; currentNoteFile?: () => TFile | null } | undefined;
    let file: TFile | null = null;
    if (view?.currentNoteFile) file = view.currentNoteFile();
    else if (view?.file instanceof TFile) file = view.file;
    if (!file) {
      const active = workspace.getActiveFile();
      if (active) file = active;
    }
    if (!file || file.extension !== "md") return null;
    if (file.path.startsWith(normalizePath(this.plugin.settings.aiChatFolder) + "/")) return null;
    return file;
  }

  private updateAttachLabel(): void {
    const label = this.contentEl.querySelector(".cld-ai-chip .cld-ai-chip-label");
    if (!label) return;
    const note = this.attachNote ? this.currentNote() : null;
    label.textContent = note ? t("附带：{name}", { name: note.basename }) : t("附带当前笔记");
  }

  private iconButton(parent: HTMLElement, icon: string, label: string, onClick: () => void): HTMLElement {
    const button = parent.createEl("button", { cls: "cld-ai-icon clickable-icon", attr: { "aria-label": label } });
    setIcon(button, icon);
    button.addEventListener("click", onClick);
    return button;
  }

  private updateSendButton(): void {
    this.sendBtn.empty();
    setIcon(this.sendBtn, this.run ? "square" : "arrow-up");
    this.sendBtn.setAttr("aria-label", this.run ? t("停止") : t("发送"));
  }

  private cliState(id: CliProviderId): "ok" | "off" | "checking" {
    const status = this.status.get(id);
    if (!status || status === "checking") return "checking";
    return status.installed ? "ok" : "off";
  }

  private renderMessages(): void {
    const el = this.messagesEl;
    el.empty();
    if (this.conversation.messages.length === 0) {
      this.renderEmptyState(el);
      return;
    }
    for (const message of this.conversation.messages) this.renderMessage(el, message);
    el.scrollTop = el.scrollHeight;
  }

  private renderEmptyState(el: HTMLElement): void {
    const info = providerInfo(this.conversation.provider);
    const card = el.createDiv({ cls: "cld-ai-empty" });
    card.createDiv({ cls: "cld-ai-empty-title", text: info.label });
    card.createEl("p", { text: t(info.note) });
    if (info.id === "deepseek") {
      if (!this.plugin.settings.deepseekApiKey) {
        card.createEl("p", { cls: "cld-ai-warn", text: t("还没有填写 API Key。") });
        const button = card.createEl("button", { text: t("去设置填写") });
        button.addEventListener("click", () => this.plugin.openSettingTab());
      }
      return;
    }
    if (!cliSupported()) {
      card.createEl("p", { cls: "cld-ai-warn", text: t("命令行 AI 只能在电脑版 Obsidian 里使用。") });
      return;
    }
    const status = this.status.get(info.id as CliProviderId);
    if (!status || status === "checking") {
      card.createEl("p", { cls: "cld-ai-muted", text: t("正在检测 {name} 命令行工具…", { name: info.label }) });
      return;
    }
    if (status.installed) {
      card.createEl("p", { cls: "cld-ai-muted", text: t("已检测到：{version}", { version: status.version || status.path }) });
      card.createEl("p", { cls: "cld-ai-muted", text: t("AI 只读你的库，不会修改笔记。每段对话会自动保存到“{folder}”文件夹。", { folder: this.plugin.settings.aiChatFolder }) });
      return;
    }
    card.createEl("p", { cls: "cld-ai-warn", text: t("没找到 {name} 命令行工具。在终端里运行下面的命令安装并登录：", { name: info.label }) });
    this.codeLine(card, info.install);
    if (info.login) this.codeLine(card, info.login);
    const retry = card.createEl("button", { text: t("重新检测") });
    retry.addEventListener("click", () => void this.checkProviders(true));
  }

  private codeLine(parent: HTMLElement, text: string): void {
    const line = parent.createDiv({ cls: "cld-ai-code" });
    line.createEl("code", { text });
    const copy = line.createEl("button", { cls: "clickable-icon", attr: { "aria-label": t("复制") } });
    setIcon(copy, "copy");
    copy.addEventListener("click", async () => {
      await navigator.clipboard.writeText(text);
      new Notice(t("已复制"));
    });
  }

  private renderMessage(parent: HTMLElement, message: AIMessage): HTMLElement {
    const wrap = parent.createDiv({ cls: `cld-ai-msg is-${message.role}` });
    const meta = wrap.createDiv({ cls: "cld-ai-meta" });
    meta.setText(`${message.role === "user" ? t("我") : providerInfo(this.conversation.provider).label} · ${new Date(message.time).toLocaleTimeString(dateLocale(), { hour: "2-digit", minute: "2-digit" })}`);
    const bubble = wrap.createDiv({ cls: "cld-ai-bubble" });
    if (message.role === "user") {
      bubble.setText(message.text);
    } else {
      void MarkdownRenderer.render(this.app, message.text, bubble, this.conversation.file?.path ?? "", this);
      const copy = wrap.createEl("button", { cls: "cld-ai-copy clickable-icon", attr: { "aria-label": t("复制") } });
      setIcon(copy, "copy");
      copy.addEventListener("click", async () => {
        await navigator.clipboard.writeText(message.text);
        new Notice(t("已复制"));
      });
    }
    return wrap;
  }

  /* ------------------------------ history ------------------------------ */

  private chatFiles(): TFile[] {
    const folder = this.app.vault.getAbstractFileByPath(normalizePath(this.plugin.settings.aiChatFolder));
    if (!(folder instanceof TFolder)) return [];
    const files: TFile[] = [];
    const walk = (dir: TFolder) => {
      for (const child of dir.children) {
        if (child instanceof TFolder) walk(child);
        else if (child instanceof TFile && child.extension === "md") files.push(child);
      }
    };
    walk(folder);
    return files
      .filter((file) => this.app.metadataCache.getFileCache(file)?.frontmatter?.type === "ai-chat")
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }

  private async renderHistory(el: HTMLElement): Promise<void> {
    const list = el.createDiv({ cls: "cld-ai-history" });
    const files = this.chatFiles();
    if (files.length === 0) {
      list.createDiv({ cls: "cld-ai-empty", text: t("还没有保存的对话。") });
      return;
    }
    for (const file of files) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
      const row = list.createEl("button", { cls: "cld-ai-history-row" });
      row.toggleClass("is-active", file === this.conversation.file);
      const provider = AI_PROVIDERS.find((entry) => entry.id === fm.provider);
      row.createSpan({ cls: "cld-ai-history-badge", text: provider?.label ?? "AI" });
      row.createSpan({ cls: "cld-ai-history-title", text: file.basename.replace(/^\d{4}-\d{2}-\d{2} \d{4} /, "") });
      row.createSpan({ cls: "cld-ai-history-date", text: new Date(file.stat.mtime).toLocaleDateString(dateLocale(), { month: "short", day: "numeric" }) });
      row.addEventListener("click", () => void this.openConversation(file));
    }
  }

  async openConversation(file: TFile): Promise<void> {
    this.run?.stop();
    const raw = await this.app.vault.read(file);
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter ?? {};
    const provider = AI_PROVIDERS.some((entry) => entry.id === fm.provider) ? fm.provider as AIProviderId : "claude";
    this.conversation = {
      file,
      provider,
      sessionId: typeof fm.session_id === "string" ? fm.session_id : "",
      created: Date.parse(String(fm.created ?? "")) || file.stat.ctime,
      messages: parseMessages(raw),
    };
    this.showHistory = false;
    this.render();
  }

  /* ------------------------------ actions ------------------------------ */

  private switchProvider(id: AIProviderId): void {
    if (id === this.conversation.provider) return;
    this.run?.stop();
    // A conversation belongs to one AI; switching starts a fresh one.
    this.conversation = this.blankConversation(id);
    this.plugin.settings.aiProvider = id;
    void this.plugin.saveSettings(false);
    this.showHistory = false;
    this.render();
  }

  private newConversation(): void {
    this.run?.stop();
    this.conversation = this.blankConversation(this.conversation.provider);
    this.showHistory = false;
    this.render();
    this.inputEl.focus();
  }

  private async checkProviders(force = false): Promise<void> {
    if (!cliSupported()) return;
    const ids: CliProviderId[] = ["claude", "codex", "grok"];
    for (const id of ids) if (force || !this.status.has(id)) this.status.set(id, "checking");
    this.render();
    await Promise.all(ids.map(async (id) => {
      if (!force && this.status.get(id) !== "checking") return;
      this.status.set(id, await detectCli(id, this.plugin.settings.aiCliPaths[id] ?? ""));
    }));
    if (!this.run) this.render();
  }

  private async send(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.run) return;
    if (this.showHistory) {
      this.showHistory = false;
      this.render();
    }
    const conversation = this.conversation;
    const history = conversation.messages.slice();
    let prompt = text;
    if (this.attachNote) {
      const note = this.currentNote();
      if (note) {
        const content = await this.app.vault.cachedRead(note);
        prompt = `${text}\n\n---\n${t("当前笔记")}：${note.path}\n\n${content.slice(0, 30000)}`;
      } else {
        new Notice(t("左边没有打开的笔记，这条消息不会附带笔记。"));
      }
    }
    const userMessage: AIMessage = { role: "user", text, time: Date.now() };
    conversation.messages.push(userMessage);
    this.inputEl.value = "";
    if (this.messagesEl.querySelector(".cld-ai-empty")) this.messagesEl.empty();
    this.renderMessage(this.messagesEl, userMessage);

    const pending = this.messagesEl.createDiv({ cls: "cld-ai-msg is-assistant is-pending" });
    pending.createDiv({ cls: "cld-ai-meta", text: providerInfo(conversation.provider).label });
    const bubble = pending.createDiv({ cls: "cld-ai-bubble" });
    bubble.createSpan({ cls: "cld-ai-typing" });
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    this.activityEl.setText(t("正在连接 {name}…", { name: providerInfo(conversation.provider).label }));

    const settings = this.plugin.settings;
    this.run = runAI({
      provider: conversation.provider,
      prompt,
      history,
      sessionId: conversation.sessionId,
      cwd: vaultPath(this.app),
      binPath: conversation.provider === "deepseek" ? "" : settings.aiCliPaths[conversation.provider] ?? "",
      proxy: settings.aiProxy,
      model: conversation.provider === "deepseek" ? "" : settings.aiCliModels[conversation.provider] ?? "",
      deepseekKey: settings.deepseekApiKey,
      deepseekModel: settings.deepseekModel,
      onText: (full) => {
        bubble.empty();
        bubble.addClass("is-streaming");
        bubble.setText(full);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
      },
      onActivity: (label) => this.activityEl.setText(label),
    });
    this.updateSendButton();

    try {
      const result = await this.run.done;
      if (result.sessionId) conversation.sessionId = result.sessionId;
      const reply: AIMessage = { role: "assistant", text: result.text || t("（没有返回内容）"), time: Date.now() };
      conversation.messages.push(reply);
      pending.remove();
      if (this.conversation === conversation && !this.showHistory) this.renderMessage(this.messagesEl, reply);
      await this.save(conversation);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      bubble.empty();
      bubble.removeClass("is-streaming");
      pending.addClass("is-error");
      bubble.setText(message);
      // Keep the question in the box so it can be re-sent.
      conversation.messages.pop();
      if (!this.inputEl.value) this.inputEl.value = text;
    } finally {
      this.run = null;
      this.activityEl.setText("");
      this.updateSendButton();
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }
  }

  /* ------------------------------ saving ------------------------------ */

  private async save(conversation: Conversation): Promise<void> {
    const markdown = serialize(conversation);
    try {
      if (conversation.file && this.app.vault.getAbstractFileByPath(conversation.file.path)) {
        await this.app.vault.modify(conversation.file, markdown);
        return;
      }
      const folder = normalizePath(this.plugin.settings.aiChatFolder || "AI 对话");
      if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      const first = conversation.messages.find((message) => message.role === "user")?.text ?? t("对话");
      const title = first.replace(/[\\/:*?"<>|#^[\]\n\r]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 32) || t("对话");
      const stamp = formatStamp(new Date(conversation.created));
      let path = normalizePath(`${folder}/${stamp} ${title}.md`);
      for (let n = 2; this.app.vault.getAbstractFileByPath(path); n++) path = normalizePath(`${folder}/${stamp} ${title} ${n}.md`);
      conversation.file = await this.app.vault.create(path, markdown);
    } catch (error) {
      console.error("[Content Library] Saving AI chat failed", error);
      new Notice(t("对话保存失败"));
    }
  }
}

function formatStamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`;
}

function serialize(conversation: Conversation): string {
  const label = providerInfo(conversation.provider).label;
  const lines = [
    "---",
    "type: ai-chat",
    `provider: ${conversation.provider}`,
    `session_id: "${conversation.sessionId}"`,
    `created: ${new Date(conversation.created).toISOString()}`,
    `updated: ${new Date().toISOString()}`,
    "---",
    "",
  ];
  for (const message of conversation.messages) {
    lines.push(`<!-- cld-ai ${message.role} ${message.time} -->`);
    lines.push(`**${message.role === "user" ? t("我") : label}**`, "");
    lines.push(message.text.trim(), "");
  }
  return lines.join("\n");
}

function parseMessages(raw: string): AIMessage[] {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const messages: AIMessage[] = [];
  let current: AIMessage | null = null;
  let skipLabel = false;
  const lines: string[] = [];
  const flush = () => {
    if (current) {
      current.text = lines.join("\n").trim();
      messages.push(current);
    }
    lines.length = 0;
  };
  for (const line of body.split("\n")) {
    const match = MARKER.exec(line.trim());
    if (match) {
      flush();
      current = { role: match[1] as AIMessage["role"], time: Number(match[2]), text: "" };
      skipLabel = true;
      continue;
    }
    if (skipLabel) {
      if (/^\*\*.+\*\*$/.test(line.trim())) {
        skipLabel = false;
        continue;
      }
      if (line.trim()) skipLabel = false;
    }
    if (current) lines.push(line);
  }
  flush();
  return messages;
}
