/** Marks Studio's hidden export frame; its value is the network policy ("https" or "none"). */
export const FRAME_ATTRIBUTE = "data-swarmloom-export";

/**
 * True inside the hidden export frame. The frame loads the exporter's render page module, which in
 * a bundled app shares chunks with the app's entry, so the entry must not start the app there.
 */
export function isExportFrame(win: Window = window): boolean {
  try {
    return win.frameElement?.hasAttribute(FRAME_ATTRIBUTE) ?? false;
  } catch {
    // A cross-origin parent hides frameElement: not our frame.
    return false;
  }
}
