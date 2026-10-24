import { App, Modal } from "obsidian";
import wechatCode from "../assets/support-wechat.jpg";
import alipayCode from "../assets/support-alipay.png";
import { t } from "./i18n";

/** Inline "support the author" card with both tip codes, shown at the top of settings and the pack store. */
export function renderSupportPanel(parent: HTMLElement): HTMLElement {
  const panel = parent.createDiv({ cls: "cld-support-panel" });
  const copy = panel.createDiv({ cls: "cld-support-panel-copy" });
  copy.createEl("strong", { text: t("支持作者 🧋") });
  copy.createEl("p", { text: t("插件和素材包都是免费的。如果它对你有帮助，欢迎请我喝杯奶茶 🧋") });
  copy.createEl("small", { text: t("用手机扫码即可，金额随意。谢谢你的支持！") });
  const codes = panel.createDiv({ cls: "cld-support-panel-codes" });
  for (const [src, label, cls] of [[wechatCode, t("微信"), "is-wechat"], [alipayCode, t("支付宝"), "is-alipay"]] as const) {
    const code = codes.createDiv({ cls: `cld-support-code ${cls}` });
    code.createEl("img", { attr: { src, alt: label } });
    code.createEl("strong", { text: label });
  }
  return panel;
}

/** "Support the author" dialog with WeChat and Alipay tip codes, bundled into the plugin (no network). */
export class SupportModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("cld-support-modal");
    this.titleEl.setText(t("支持作者"));
    const { contentEl } = this;
    contentEl.createEl("p", {
      cls: "cld-support-intro",
      text: t("插件和素材包都是免费的。如果它对你有帮助，欢迎请我喝杯奶茶 🧋"),
    });
    const codes = contentEl.createDiv({ cls: "cld-support-codes" });
    this.renderCode(codes, wechatCode, t("微信"), "is-wechat");
    this.renderCode(codes, alipayCode, t("支付宝"), "is-alipay");
    contentEl.createEl("small", { cls: "cld-support-note", text: t("用手机扫码即可，金额随意。谢谢你的支持！") });
  }

  private renderCode(parent: HTMLElement, src: string, label: string, cls: string): void {
    const card = parent.createDiv({ cls: `cld-support-code ${cls}` });
    card.createEl("img", { attr: { src, alt: label } });
    card.createEl("strong", { text: label });
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
