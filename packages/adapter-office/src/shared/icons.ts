/** File-type icons shown at the centre of the intro orbit (original artwork, brand palette). */

function svgData(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const SLIDES_ICON = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="12" width="52" height="34" rx="5" fill="#5B5BF7"/><rect x="13" y="19" width="22" height="4" rx="2" fill="#fff"/><rect x="13" y="27" width="16" height="3" rx="1.5" fill="#C9CBF9"/><rect x="13" y="33" width="19" height="3" rx="1.5" fill="#C9CBF9"/><circle cx="45" cy="30" r="7" fill="#FF4F7B"/><rect x="29" y="46" width="6" height="8" fill="#5B5BF7"/><rect x="20" y="53" width="24" height="4" rx="2" fill="#5B5BF7"/></svg>',
);

export const SHEET_ICON = svgData(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="8" y="8" width="48" height="48" rx="6" fill="#14B8A6"/><path d="M8 22h48M8 34h48M8 46h48M24 8v48M40 8v48" stroke="#fff" stroke-width="2.5" opacity=".85"/><rect x="8" y="8" width="48" height="14" rx="6" fill="#0F8F82"/><rect x="40" y="34" width="16" height="12" fill="#F5A524"/></svg>',
);
