import { mountStudio } from "./app";

const root = document.getElementById("app");
if (!root) throw new Error("#app element is missing from index.html");
mountStudio(root);
