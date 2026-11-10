/**
 * Shadow styles of `<swarm-loom>`.
 *
 * Children mode: the light-DOM children stay in flow and give the element its size; the stage
 * overlays them while the swarm builds and the real children come back on "go live". They are made
 * transparent rather than hidden so assistive technology keeps reading the real content, while the
 * decorative stage is aria-hidden.
 * Source mode (`src` or `load()`): children are not shown and a 16:10 sizer gives the element an
 * intrinsic height unless the page sets one.
 */
export const STYLES = `
:host{display:block;position:relative;overflow:hidden;contain:content}
:host([hidden]){display:none}
.root{position:relative;height:100%}
.sizer{display:none;width:100%;aspect-ratio:16/10}
.root[data-mode=source] .sizer{display:block}
.root[data-mode=source] .content{display:none}
.stage{position:absolute;inset:0;display:none}
.root[data-active] .stage{display:block}
.root[data-active][data-mode=children] .content{opacity:0}
.error{display:none;position:absolute;left:12px;right:12px;bottom:12px;padding:8px 12px;border-radius:8px;
font:13px/1.45 system-ui,sans-serif;color:#0b0b12;background:#fafafc;box-shadow:0 0 0 1px rgba(11,11,18,.12)}
.root[data-error] .error{display:block}
@media (prefers-color-scheme:dark){.error{color:#fafafc;background:#0b0b12;box-shadow:0 0 0 1px rgba(255,255,255,.14)}}
`;
