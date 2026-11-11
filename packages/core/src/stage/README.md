# src/stage

Owner: stage team (W1). Shadow DOM isolated stage, layer mounting with viewport virtualization, `reveal`/`finish` implementations and the `StageApi` surface. The stage team also owns `src/overlay/` and `src/cursor/`.

While the stage builds, the world tree is a visual replay: `aria-hidden` and `inert`, so nothing in it takes focus or reaches a screen reader (the toolbar and its announcements stand in for it). An inline stage that goes live turns it back into a page: the content is read, its links and controls take Tab focus, text is selectable and content animations run. Replay or reset hides it again and keeps focus on the stage.
