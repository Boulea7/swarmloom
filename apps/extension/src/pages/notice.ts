/**
 * Restricted-page notice. Opened next to a tab SwarmLoom cannot script, it explains why and offers
 * ways forward: open the page in Studio, import a file into Studio, or copy the link when Studio can
 * open it. Query parameters are untrusted: `reason` must be a known reason and `url` is shown as
 * text only.
 */

import { BUILD_TARGET, engineOf } from "../shared/build-info";
import { MAX_SOURCE_URL, studioSource, studioUrl } from "../shared/links";
import { requestSourceAccess } from "../shared/permissions";
import { isBlockReason, reasonMessageKey } from "../shared/restricted";
import { applyI18n, byId, onReady, pageContext } from "./dom";

/** Parsed and validated notice parameters. */
function noticeParams(search: string): { reason: ReturnType<typeof reasonOf>; url: string | null } {
  const params = new URLSearchParams(search);
  const url = params.get("url");
  return { reason: reasonOf(params.get("reason")), url: url && url.length <= MAX_SOURCE_URL ? url : null };
}

function reasonOf(value: string | null) {
  return isBlockReason(value) ? value : "blocked";
}

async function copyText(text: string, fallbackTarget: HTMLElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API refused (no focus, policy): select the text so the user can copy it.
    const range = document.createRange();
    range.selectNodeContents(fallbackTarget);
    const selection = getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fallbackTarget.focus();
    return false;
  }
}

onReady(async () => {
  const { api, tr } = await pageContext();
  applyI18n(document, tr);
  const { reason, url } = noticeParams(location.search);
  const getURL = api ? (p: string) => api.runtime.getURL(p) : null;
  const src = studioSource(url ?? undefined);

  byId("reason").textContent = tr.t(reasonMessageKey(reason));
  if (url) {
    byId("page").hidden = false;
    byId("page-url").textContent = url;
  }

  if (reason === "file-access") {
    byId("file-help").hidden = false;
    const details = byId<HTMLButtonElement>("open-details");
    details.hidden = engineOf(BUILD_TARGET) !== "chromium" || !api;
    details.addEventListener("click", () => {
      if (api) void api.tabs.create({ url: `chrome://extensions/?id=${api.runtime.id}` });
    });
  }

  const open = byId<HTMLAnchorElement>("open-studio");
  open.href = studioUrl(getURL, src ? { src } : {});
  byId("open-studio-hint").textContent = tr.t(src ? "noticeOpenStudioHint" : "noticeOpenStudioHomeHint");
  open.addEventListener("click", (e) => {
    if (!api || !src) return;
    e.preventDefault();
    // Ask inside the click so the prompt is allowed, then continue whatever the answer.
    void requestSourceAccess(api, src).then(() => location.assign(open.href));
  });

  byId<HTMLAnchorElement>("import").href = studioUrl(getURL, { importFile: true });

  // The hint says to paste the link into Studio, which only takes web and file links: a chrome://
  // or about: address would just be refused there, so the step is offered for loadable links only.
  const copyCard = byId("copy-card");
  copyCard.hidden = !src;
  const status = byId("copy-status");
  byId<HTMLButtonElement>("copy").addEventListener("click", async () => {
    if (!src) return;
    const ok = await copyText(src, byId("page-url"));
    status.textContent = tr.t(ok ? "noticeCopied" : "noticeCopyFailed");
  });
});
