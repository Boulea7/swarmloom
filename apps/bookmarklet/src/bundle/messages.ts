/** Strings of the in-page failure notice. The install page has its own catalogue. */
export interface NoticeMessages {
  title: string;
  body: string;
  popupBlocked: string;
  openStudio: string;
  close: string;
}

const MESSAGES: Record<"zh" | "en", NoticeMessages> = {
  zh: {
    title: "群织没能在这个页面上直接重建",
    body: "可以把页面副本交给 SwarmLoom Studio，在新标签页里重建。副本只在你的浏览器里传递，不会上传。",
    popupBlocked: "浏览器拦截了新标签页，请再点一次“在 Studio 中打开”。",
    openStudio: "在 Studio 中打开",
    close: "关闭",
  },
  en: {
    title: "SwarmLoom couldn't rebuild this page in place",
    body: "Hand a copy to SwarmLoom Studio and rebuild it in a new tab. The copy stays in your browser and is never uploaded.",
    popupBlocked: "The browser blocked the new tab. Press “Open in Studio” again.",
    openStudio: "Open in Studio",
    close: "Close",
  },
};

/** Picks the catalogue for a BCP 47 tag: Chinese for `zh*`, English otherwise. */
export function noticeMessages(locale: string | undefined): NoticeMessages {
  return locale?.toLowerCase().startsWith("zh") ? MESSAGES.zh : MESSAGES.en;
}
