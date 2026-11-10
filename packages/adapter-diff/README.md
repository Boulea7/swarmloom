# @swarmloom/adapter-diff

The patch adapter for SwarmLoom. It turns a unified diff, a git diff, `git log -p` output or a `git format-patch` mailbox into code-review panels that the swarm weaves: context lines appear, removed lines are struck through, selected and deleted with backspace, and added lines are typed. Load it through `@swarmloom/formats` so it is only fetched when needed.

```ts
import { createDiffAdapter } from "@swarmloom/adapter-diff";

const adapter = createDiffAdapter({ anonymize: false });
const { blueprint, plugins } = await adapter.load({ text }, { document, width: 960, theme: "light" });
```

How it works:

- The parser reads hunks by their line counts, so content such as `--- ` or `-- ` inside a hunk is never mistaken for a header. It understands git extended headers (new/deleted files, mode changes, renames and copies with similarity, quoted paths), `Binary files ... differ` and `GIT binary patch` blocks, `\ No newline at end of file`, RFC 2047 encoded author names and folded subjects in mailboxes, and `-- ` signatures. Cut-off hunks are flagged and parsing continues. Input that is binary or has no file changes is rejected with a `DiffError`.
- Each commit gets a header (subject, author, date, short hash) and each file one panel: path (old and new path for renames), status badge, `+added -removed` counts, hunk headers and one row per line with old and new line numbers.
- Each line is a `diff:line` custom layer of the `diff` plugin. Additions in a change block wait for the block's removals. The first change of every hunk shows its author's label next to the cursor, and every layer carries `meta.author`.
- Each distinct author (by e-mail, else name) maps to one label. With `anonymize: true` the labels are `Author 1..n` and no name or e-mail address reaches the blueprint.
- Files past the layer budget (`ctx.maxLayers`, default 6000) or the parser limits are dropped and counted in `blueprint.truncated`.

GitHub pull requests: `@swarmloom/adapter-diff/github` (`pullDiffUrl`, `fetchPullDiff`) is for the CLI. It accepts public `https://github.com/<owner>/<repo>/pull/<n>` URLs, sends an anonymous request, refuses URLs that carry credentials or token parameters, and stores nothing. In the browser, `load({ url })` refuses pull request URLs (GitHub serves diffs without CORS); download the `.diff` and open the file instead.

Options (`createDiffAdapter`): `anonymize` (false), `maxBytes` (16 MiB), `maxFiles` (300), `maxLines` (20 000), `tabSize` (4).

Limits: no syntax highlighting inside diff rows, no word-level (intra-line) highlights, combined merge diffs (`diff --cc`) are not parsed, long lines are clipped at the panel edge.

License: MIT.
