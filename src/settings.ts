import {
  App,
  ButtonComponent,
  PluginSettingTab,
  Setting,
  TFolder,
} from "obsidian";
import type ContentLibraryDashboardPlugin from "./main";
import {
  SOURCE_KIND_LABELS,
  SOURCE_GROUP_LABELS,
  THEME_LABELS,
  type ContentSource,
} from "./types";

export class ContentLibrarySettingsTab extends PluginSettingTab {
  constructor(app: App, private plugin: ContentLibraryDashboardPlugin) {
    super(app, plugin);
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass("cld-settings");
    new Setting(containerEl).setName("内容图书馆").setHeading();
    containerEl.createEl("p", {
      text: "不需要预先创建固定文件夹。选择 Vault 里已有的文件夹即可；显示名称可以和实际路径不同。",
    });

    new Setting(containerEl).setName("外观").setHeading();

    new Setting(containerEl)
      .setName("标题")
      .addText((text) => text
        .setValue(this.plugin.settings.dashboardTitle)
        .onChange(async (value) => {
          this.plugin.settings.dashboardTitle = value.trim() || "内容图书馆";
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName("颜色")
      .addDropdown((dropdown) => {
        for (const [value, label] of Object.entries(THEME_LABELS)) dropdown.addOption(value, label);
        dropdown.setValue(this.plugin.settings.theme).onChange(async (value) => {
          this.plugin.settings.theme = value as keyof typeof THEME_LABELS;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("明暗模式")
      .setDesc("选择跟随系统，或固定使用白天 / 夜间模式。")
      .addDropdown((dropdown) => {
        dropdown.addOption("system", "跟随系统");
        dropdown.addOption("light", "白天模式");
        dropdown.addOption("dark", "夜间模式");
        dropdown.setValue(this.plugin.settings.themeMode).onChange(async (value) => {
          this.plugin.settings.themeMode = value as "system" | "light" | "dark";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("批注高亮颜色")
      .setDesc("文章内已保存摘录的高亮颜色。")
      .addDropdown((dropdown) => {
        dropdown.addOption("yellow", "亮黄色");
        dropdown.addOption("orange", "橙色");
        dropdown.addOption("blue", "蓝色");
        dropdown.addOption("pink", "粉色");
        dropdown.setValue(this.plugin.settings.annotationHighlight).onChange(async (value) => {
          this.plugin.settings.annotationHighlight = value as "yellow" | "orange" | "blue" | "pink";
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("横幅图片")
      .setDesc("可填写 Vault 内图片路径或网络图片地址，也可以直接导入。没有图片时使用内置玻璃占位图。")
      .addText((text) => text
        .setPlaceholder("Card Dashboard Assets/banner.jpg")
        .setValue(this.plugin.settings.bannerPath)
        .onChange(async (value) => {
          this.plugin.settings.bannerPath = value.trim();
          await this.plugin.saveSettings();
        }))
      .addButton((button) => button.setButtonText("导入图片").onClick(() => {
        chooseImage(async (file) => {
          try {
            this.plugin.settings.bannerPath = await this.plugin.importImage(file, "Banners");
            await this.plugin.saveSettings();
            this.display();
          } catch (error) {
            console.error("[Content Library] Banner import failed", error);
          }
        });
      }));

    new Setting(containerEl)
      .setName("批注保存位置")
      .setDesc("阅读批注和音频笔记会保存到这里；文件夹会在第一次保存时创建，也可以改成你自己的路径。")
      .addText((text) => text
        .setValue(this.plugin.settings.annotationFolder)
        .onChange(async (value) => {
          this.plugin.settings.annotationFolder = value.trim() || "Dashboard Notes";
          await this.plugin.saveSettings(false);
        }));

    const sourceHeader = containerEl.createDiv({ cls: "cld-settings-heading" });
    new Setting(sourceHeader).setName("我的文件夹").setHeading();
    new ButtonComponent(sourceHeader)
      .setButtonText("添加文件夹")
      .setIcon("folder-plus")
      .onClick(async () => {
        this.plugin.settings.sources.push({
          id: `source-${Date.now()}`,
          name: "新文件夹",
          folder: "",
          kind: "generic",
          group: "ideas",
          icon: "folder",
          coverPath: "",
          enabled: true,
        });
        await this.plugin.saveSettings(false);
        this.display();
      });

    sourceHeader.createEl("p", {
      cls: "setting-item-description",
      text: "这里只管理你选择的文件夹，不再自动添加默认栏目。",
    });

    for (const source of this.plugin.settings.sources) this.renderSource(containerEl, source);

    if (!this.plugin.settings.sources.length) {
      containerEl.createDiv({
        cls: "cld-settings-empty",
        text: "还没有文件夹。点击上面的“添加文件夹”开始。",
      });
    }
  }

  private renderSource(container: HTMLElement, source: ContentSource): void {
    const stats = this.plugin.indexer.sourceStats(source.folder);
    const detectedLabel = stats.playlists > 0
      ? `${stats.playlists} 个歌单${stats.notes > stats.playlists ? ` · ${stats.notes - stats.playlists} 篇笔记` : ""}`
      : stats.audio > 0
      ? `${stats.audio} 个音频${stats.notes ? ` · ${stats.notes} 篇笔记` : ""}`
      : `${stats.notes} 篇笔记 · ${SOURCE_KIND_LABELS[source.kind]}`;
    const card = container.createDiv({ cls: "cld-source-setting" });
    const title = card.createDiv({ cls: "cld-source-setting-title" });
    const copy = title.createDiv({ cls: "cld-source-setting-copy" });
    copy.createEl("strong", { text: source.name || "未命名文件夹" });
    copy.createEl("small", {
      text: source.folder ? `${source.folder} · ${detectedLabel}` : "请选择一个文件夹",
    });
    const controls = title.createDiv({ cls: "cld-source-setting-controls" });
    const visible = controls.createEl("input", {
      attr: { type: "checkbox", "aria-label": "显示在 Dashboard" },
    });
    visible.checked = source.enabled;
    visible.addEventListener("change", async () => {
      source.enabled = visible.checked;
      await this.plugin.saveSettings();
    });
    const body = card.createDiv({ cls: "cld-source-setting-body" });
    body.hidden = true;
    new ButtonComponent(controls).setButtonText("编辑").onClick(() => {
      body.hidden = !body.hidden;
    });
    new ButtonComponent(controls).setIcon("trash-2").setTooltip("删除").onClick(async () => {
      this.plugin.settings.sources = this.plugin.settings.sources.filter((entry) => entry.id !== source.id);
      await this.plugin.saveSettings(false);
      this.display();
    });

    new Setting(body).setName("显示名称").setDesc("这是 Dashboard 上显示的名称，不会修改 Vault 中的实际文件夹名称。").addText((text) => text
      .setValue(source.name)
      .onChange(async (value) => {
        source.name = value.trim() || "文件夹";
        await this.plugin.saveSettings();
      }));
    new Setting(body).setName("所属分类").addDropdown((dropdown) => {
      for (const [value, label] of Object.entries(SOURCE_GROUP_LABELS)) dropdown.addOption(value, label);
      dropdown.setValue(source.group).onChange(async (value) => {
        source.group = value as keyof typeof SOURCE_GROUP_LABELS;
        await this.plugin.saveSettings();
      });
    });
    new Setting(body).setName("选择文件夹").setDesc("选择 Vault 中已有的任意文件夹；插件不会移动或复制其中的笔记。").addDropdown((dropdown) => {
      const folders = this.app.vault.getAllLoadedFiles()
        .filter((file): file is TFolder => file instanceof TFolder && Boolean(file.path))
        .sort((a, b) => a.path.localeCompare(b.path));
      if (source.folder && !folders.some((folder) => folder.path === source.folder)) dropdown.addOption(source.folder, source.folder);
      dropdown.addOption("", "请选择");
      for (const folder of folders) dropdown.addOption(folder.path, folder.path);
      dropdown.setValue(source.folder).onChange(async (value) => {
        source.folder = value;
        source.kind = this.plugin.indexer.inferSourceKind(value, source.kind);
        source.icon = source.kind === "podcast" ? "headphones" : "folder";
        if ((!source.name || source.name === "新文件夹") && value) {
          source.name = value.split("/").pop() || "文件夹";
        }
        await this.plugin.saveSettings(false);
        this.display();
      });
    });
    body.createEl("p", {
      cls: "setting-item-description",
      text: stats.playlists > 0
        ? "已识别为音乐歌单文件夹。Markdown 文件的 playlist_url 会同步网易云歌单。"
        : stats.audio > 0
        ? "已自动识别为音频播放列表。"
        : "已自动识别为笔记文件夹。",
    });
  }

}

function chooseImage(callback: (file: File) => void | Promise<void>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/webp,image/gif";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void callback(file);
  }, { once: true });
  input.click();
}
