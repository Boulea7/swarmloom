# src/stage

Owner: stage team (W1). Shadow DOM isolated stage, layer mounting with viewport virtualization, `reveal`/`finish` implementations and the `StageApi` surface. The stage team also owns `src/overlay/` and `src/cursor/`.

While the stage builds, the world tree is a visual replay: `aria-hidden` and `inert`, so nothing in it takes focus or reaches a screen reader (the toolbar and its announcements stand in for it). An inline stage that goes live turns it back into a page: the content is read, its links and controls take Tab focus, text is selectable and content animations run. Replay or reset hides it again and keeps focus on the stage.

Caret geometry is read in batches of 64 boundaries and cached until glyphs can move (fonts, scale, transient styles other than `translate`, `opacity` and `clip-path`). Those reads happen in the stage's read phase (`measure()`, which the engine runs before each tick's writes): a text a task starts on (`prefetch(id)`) gets its first block, a text being typed the block at its typed position and the next one past the middle. A caret asked for before it was read is still measured on the spot, and every pending read is taken with it, under the one layout that read forces. `caretAt` reports the caret where the text is drawn, so a transient `translate` in px (a snapping text typed beside its guide) moves it along.
