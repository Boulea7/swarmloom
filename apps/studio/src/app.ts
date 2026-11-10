/** Renders the Studio shell into `root`. Placeholder until the sample wall and player land. */
export function mountStudio(root: HTMLElement): void {
  const title = root.ownerDocument.createElement("h1");
  title.textContent = "SwarmLoom Studio";
  const note = root.ownerDocument.createElement("p");
  note.textContent = "Placeholder: open a file or URL and watch the swarm build it.";
  root.replaceChildren(title, note);
}
