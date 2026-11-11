<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/hero-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="../../assets/brand/hero-light.svg" />
    <img alt="SwarmLoom : une nuée de curseurs donne vie à vos contenus" src="../../assets/brand/hero-light.svg" width="1280" />
  </picture>
</p>

<h1 align="center">SwarmLoom</h1>

<p align="center"><strong>Regardez une nuée de curseurs donner vie à vos contenus.</strong><br/>Pages web, documents, code, images et modèles 3D : une nuée de curseurs les assemble sous vos yeux, pièce par pièce, puis exporte le résultat en vidéo avec du son.<br/>Il s’agit d’une reconstitution visuelle locale, et non d’un orchestrateur d’agents IA.</p>

<p align="center">
  <a href="https://github.com/Boulea7/swarmloom/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Boulea7/swarmloom/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" /></a>
  <a href="../../LICENSE"><img alt="Licence MIT" src="https://img.shields.io/badge/license-MIT-5B5BF7?style=flat-square" /></a>
  <a href="../../CONTRIBUTING.en.md"><img alt="PR bienvenues" src="https://img.shields.io/badge/PRs-welcome-5B5BF7?style=flat-square" /></a>
</p>

<p align="center"><a href="../../README.md">简体中文</a> · <a href="../../README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <a href="./README.es.md">Español</a> · <strong>Français</strong> · <a href="./README.de.md">Deutsch</a></p>

<p align="center">
  <a href="https://boulea7.github.io/swarmloom/studio/"><strong>Essayer Studio en ligne</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/"><strong>Site web</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/docs/en/"><strong>Documentation</strong></a>
</p>

## Présentation vidéo

<!-- VIDEO:main -->

La vidéo de présentation est en cours de production et pourra être visionnée directement ici.

<!-- /VIDEO:main -->

Sans rien installer, vous pouvez ouvrir les mêmes exemples dans [Studio en ligne](https://boulea7.github.io/swarmloom/studio/), ou commencer par lire le [guide illustré](https://boulea7.github.io/swarmloom/docs/en/getting-started.html).

## Formats pris en charge

Chaque animation ci-dessous est un véritable rendu de SwarmLoom. Sélectionnez-en une pour lire le même exemple dans Studio.

<table>
  <tr>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=web-demo"><img alt="Une nuée de curseurs reconstitue une page web" src="../../docs/assets/formats/web.webp" width="100%" /></a><br/>Pages web</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=html-landing"><img alt="Une page HTML assemblée bloc par bloc" src="../../docs/assets/formats/html.webp" width="100%" /></a><br/>HTML</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=svg-emblem"><img alt="Des tracés SVG dessinés trait par trait" src="../../docs/assets/formats/svg.webp" width="100%" /></a><br/>SVG</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=markdown-welcome.en"><img alt="Titres et corps de texte Markdown reconstitués" src="../../docs/assets/formats/markdown.webp" width="100%" /></a><br/>Markdown</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=docx-report"><img alt="Un document Word reconstitué" src="../../docs/assets/formats/docx.webp" width="100%" /></a><br/>DOCX</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=doc-report"><img alt="Un document Word au format ancien reconstitué" src="../../docs/assets/formats/doc.webp" width="100%" /></a><br/>DOC</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=pdf-brochure"><img alt="Une page PDF reconstituée" src="../../docs/assets/formats/pdf.webp" width="100%" /></a><br/>PDF</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=slides-pitch"><img alt="Une diapositive reconstituée" src="../../docs/assets/formats/slides.webp" width="100%" /></a><br/>Diapositives</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=sheet-sales"><img alt="Une feuille de calcul assemblée ligne par ligne" src="../../docs/assets/formats/sheet.webp" width="100%" /></a><br/>Feuilles de calcul</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=code-swarm"><img alt="Du code source saisi fragment par fragment" src="../../docs/assets/formats/code.webp" width="100%" /></a><br/>Code</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=image-scene"><img alt="Une image esquissée puis colorisée" src="../../docs/assets/formats/image.webp" width="100%" /></a><br/>Images</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=3d-shuttle-glb"><img alt="Un modèle 3D construit à partir de son maillage et de ses matériaux" src="../../docs/assets/formats/three.webp" width="100%" /></a><br/>Modèles 3D</td>
  </tr>
</table>

<details>
<summary>Autres formats pris en charge</summary>

OpenDocument (ODT / ODS / ODP), EPUB, RTF, OFD, Jupyter Notebook, enregistrements de terminal asciinema, fichiers Patch / Diff et cartes mentales XMind / FreeMind sont également pris en charge. Les formats de feuilles de calcul compatibles sont XLSX / CSV / ODS ; les formats 3D sont GLB / glTF / OBJ / STL / PLY. Le [guide des formats](https://boulea7.github.io/swarmloom/docs/en/formats.html) répertorie toutes les extensions et le degré de fidélité de la reconstitution pour chaque format.

</details>

## Pourquoi SwarmLoom ?

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/web-dark.svg" /><img alt="Carte consacrée aux pages web" src="../../assets/brand/cards/web-light.svg" width="100%" /></picture><br/><b>Reconstituez la page affichée</b><br/>L’extension reconstitue l’onglet actif ou une zone sélectionnée, puis rétablit la page dans son état initial.</td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/docs-dark.svg" /><img alt="Carte consacrée aux documents" src="../../assets/brand/cards/docs-light.svg" width="100%" /></picture><br/><b>De nombreux formats, une même scène</b><br/>Documents, feuilles de calcul, diapositives, code, images et modèles 3D prennent tous vie grâce aux mêmes curseurs.</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/video-dark.svg" /><img alt="Carte consacrée à l’export vidéo" src="../../assets/brand/cards/video-light.svg" width="100%" /></picture><br/><b>Exportez une vidéo avec du son</b><br/>La CLI exporte des fichiers MP4, WebM ou GIF image par image ; à réglages identiques, l’image et le son sont identiques.</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/platforms-dark.svg" /><img alt="Carte consacrée aux plateformes" src="../../assets/brand/cards/platforms-light.svg" width="100%" /></picture><br/><b>De nombreuses plateformes</b><br/>Des extensions pour Chrome, Edge, Firefox et Safari, Studio en PWA et un petit lecteur pour montres connectées.</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/html-svg-dark.svg" /><img alt="Carte consacrée aux animations HTML et SVG" src="../../assets/brand/cards/html-svg-light.svg" width="100%" /></picture><br/><b>Les animations continuent</b><br/>Les animations SVG démarrent une fois le dessin reconstitué ; les animations CSS reprennent lorsque vous sélectionnez « Passer en direct ».</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/code-dark.svg" /><img alt="Carte consacrée au code" src="../../assets/brand/cards/code-light.svg" width="100%" /></picture><br/><b>Intégrez-le, scriptez-le</b><br/>Utilisez l’élément <code>&lt;swarm-loom&gt;</code>, l’API JavaScript ou la CLI.</td>
  </tr>
</table>

## Comment ça marche

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/how-it-works-dark.svg" />
    <img alt="Lire une page web ou un fichier, ordonner les curseurs selon le sens de lecture, puis lire en direct ou exporter une vidéo" src="../../docs/assets/how-it-works-light.svg" width="760" />
  </picture>
</p>

SwarmLoom décompose une page web ou un fichier en calques et les confie aux curseurs dans l’ordre de lecture. Studio rejoue la construction en direct. La CLI la capture image par image et ajoute le son : l’export ne dépend donc pas de la vitesse de votre machine.

## Premiers pas

### Essayer en ligne

Ouvrez [Studio en ligne](https://boulea7.github.io/swarmloom/studio/) et choisissez un exemple, déposez un fichier local, collez du texte ou saisissez une URL. Les fichiers locaux restent dans votre navigateur. Pour une URL, votre navigateur contacte directement le site concerné, qui doit autoriser les lectures interorigines.

### Compiler à partir des sources

Les publications sur GitHub Releases, les paquets npm et les fiches dans les boutiques sont prévus. Pour l’instant, compilez à partir des sources. Node.js 22.12 ou une version ultérieure est requis ; la version de pnpm est fixée dans `packageManager`.

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
pnpm install
pnpm build
```

### CLI

Depuis la racine du dépôt, convertissez un fichier en vidéo :

```bash
node apps/cli/dist/cli.js render examples/svg/emblem.svg -o emblem.mp4
```

Chrome ou Chromium est requis ; l’export en MP4, WebM, GIF et WebP nécessite aussi FFmpeg 4 ou une version ultérieure. Exécutez `node apps/cli/dist/cli.js doctor` pour vérifier votre environnement. Une fois le paquet npm publié, `npx swarmloom` fonctionnera directement (prévu).

### Composant Web

Le paquet npm `@swarmloom/element` n’est pas encore publié (prévu). L’élément, lui, fonctionne :

```html
<script type="module">
  import { define } from "@swarmloom/element";
  define();
</script>

<swarm-loom
  src="./demo.md"
  type="markdown"
  agents="24"
  seed="7"
  autoplay
  controls>
</swarm-loom>
```

Consultez le [guide du composant](https://boulea7.github.io/swarmloom/docs/en/element.html) pour découvrir tous les attributs et événements.

## Installation par plateforme

Les fiches en boutique et les paquets signés ne sont pas encore disponibles. Toutes les instructions ci-dessous utilisent les paquets de développement générés par `pnpm build` à l’étape précédente.

<details>
<summary>Chrome / Edge / Brave / Opera</summary>

- Chrome : ouvrez `chrome://extensions`, activez le mode développeur, sélectionnez « Charger l’extension non empaquetée » et choisissez `apps/extension/dist/chrome/`.
- Edge : ouvrez `edge://extensions`, puis choisissez `apps/extension/dist/edge/` de la même manière.
- Brave / Opera : activez le mode développeur sur leur page d’extensions et choisissez le même `dist/chrome/`.
- Sur une page web classique, cliquez sur l’icône de la barre d’outils ou appuyez sur Alt+Shift+W. Les pages internes du navigateur, les boutiques d’extensions et la visionneuse PDF intégrée ne permettent pas l’exécution d’extensions.

</details>

<details>
<summary>Firefox pour ordinateur et Android (version signée prévue)</summary>

Sur ordinateur : ouvrez `about:debugging#/runtime/this-firefox`, sélectionnez « Charger un module temporaire » et choisissez `apps/extension/dist/firefox/manifest.json` ; Firefox le supprimera au redémarrage. Android utilise le même paquet ; le débogage nécessite web-ext, ADB et un appareil avec le débogage activé. Une installation durable nécessite la version signée par AMO ; d’ici là, utilisez Studio comme PWA sur téléphone.

</details>

<details>
<summary>Safari sur macOS / iOS / iPadOS / visionOS (tests sur appareils et signature prévus)</summary>

Sur un Mac où Xcode est installé, exécutez `pnpm --filter @swarmloom/extension package:safari`, ouvrez `apps/extension/build/safari/` dans Xcode, choisissez votre équipe et lancez l’application conteneur, puis activez l’extension dans les réglages système. L’installation sur un appareil nécessite l’adhésion à l’Apple Developer Program ; les tests sur des appareils réels pour ces systèmes n’ont pas encore été réalisés.

</details>

<details>
<summary>PWA : ordinateur, Android, iOS / iPadOS</summary>

Dans Chrome / Edge, ouvrez Studio et choisissez « Installer l’application » dans la barre d’adresse ou le menu. Dans Safari sur macOS, utilisez « Ajouter au Dock » ; sur Android, « Installer l’application » ou « Ajouter à l’écran d’accueil » ; sur iOS / iPadOS, choisissez « Sur l’écran d’accueil » dans le menu Partager de Safari. Dans Firefox pour ordinateur, utilisez Studio dans un onglet classique.

</details>

<details>
<summary>Écrans pliables et montres connectées</summary>

Aucune installation supplémentaire n’est nécessaire sur les écrans pliables : si le navigateur prend en charge Viewport Segments, Studio affiche deux panneaux côte à côte ou superposés ; sinon, il conserve la disposition habituelle. Sur montre, il n’y a pas d’extension et aucune garantie de PWA complète. Ouvrez `?watch=1` pour un petit lecteur qui démarre en sourdine, ou `?round=1` pour les cadrans ronds. Exportez les scènes plus complexes sur un autre appareil, puis regardez le résultat.

</details>

## Comparaison avec Swarm Rebuild

| Aspect | Ce que SwarmLoom apporte en plus |
| --- | --- |
| Entrées | Documents, code, images et modèles 3D, et pas seulement la page web active. |
| Plateformes | Studio en PWA, CLI, composant Web et lecteur pour montre, et pas seulement une extension Chrome. |
| Sortie | Des vidéos avec du son ; à réglages identiques, le résultat est identique. |

## Documentation

[Premiers pas](https://boulea7.github.io/swarmloom/docs/en/getting-started.html) · [Formats et limites](https://boulea7.github.io/swarmloom/docs/en/formats.html) · [Installation par plateforme](https://boulea7.github.io/swarmloom/docs/en/install.html) · [CLI](https://boulea7.github.io/swarmloom/docs/en/cli.html) · [Composant Web](https://boulea7.github.io/swarmloom/docs/en/element.html) · [Confidentialité](../../PRIVACY.md)

## FAQ

1. **Y a-t-il de l’IA derrière les curseurs ?** Non. L’animation des curseurs s’exécute localement à partir d’une graine fixe. Aucun modèle n’est sollicité, et les scripts contenus dans les documents ou le HTML ne sont jamais exécutés.
2. **Vos fichiers locaux sont-ils envoyés sur un serveur ?** Non. Ils sont traités dans votre navigateur. Celui-ci ne contacte un site que lorsque vous ouvrez son URL ; vous pouvez désactiver les images et polices distantes référencées par le HTML dans les réglages de Studio. Consultez [Confidentialité](../../PRIVACY.md).
3. **Pourquoi certaines pages ne peuvent-elles pas être reconstituées sur place ?** Les navigateurs n’autorisent pas les extensions à s’exécuter sur les pages internes, les boutiques d’extensions ou la visionneuse PDF intégrée. Déposez plutôt le fichier dans Studio ; pour une page classique nécessitant une connexion, utilisez l’extension.
4. **Les mêmes réglages produisent-ils un fichier MP4 identique à l’octet près ?** Les images et le son correspondent image par image (même entrée, navigateur, polices, système d’exploitation et réglages). Le contenu binaire du fichier MP4 peut toutefois varier selon la version de l’encodeur.
5. **Peut-on installer l’extension sur téléphone et montre ?** Sur téléphone, utilisez Studio comme PWA pour le moment ; une version signée de Firefox pour Android est prévue. Sur montre, seul le petit lecteur est disponible, sans extension ni lecture en arrière-plan.

## Feuille de route

- **Aujourd’hui** : Studio en ligne, pages web et 19 formats de fichiers, export image par image via la CLI, et extensions Chrome / Edge / Firefox / Safari compilables depuis les sources.
- **Ensuite** : première version sur GitHub Releases et paquets npm, fiches en boutique et extensions signées, export vidéo dans Studio, ainsi que tests sur téléphones et appareils Safari.
- **Plus tard** : d’autres formats et plateformes, sans date promise. Partagez vos idées dans [Idées](https://github.com/Boulea7/swarmloom/discussions/categories/ideas).

## Contribuer et obtenir de l’aide

- Code, documentation, traductions et exemples : lisez d’abord [CONTRIBUTING](../../CONTRIBUTING.en.md) et le [code de conduite](../../CODE_OF_CONDUCT.md).
- Questions : [Discussions Q&A](https://github.com/Boulea7/swarmloom/discussions/categories/q-a). Bugs reproductibles : [rapport de bug](https://github.com/Boulea7/swarmloom/issues/new?template=bug_report.yml).
- Un format que vous souhaitez voir pris en charge : [demande de format](https://github.com/Boulea7/swarmloom/issues/new?template=format_request.yml).
- Problèmes de sécurité : signalez-les en privé comme indiqué dans [SECURITY](../../SECURITY.md), jamais dans un ticket public.

## Crédits

Inspiré par Swarm de Joel Califa et Swarm Rebuild de Dhvanil Patel. SwarmLoom est une implémentation indépendante en salle blanche : elle ne réutilise ni leur code, ni leurs tables de constantes, ni leurs ressources visuelles, et n’est affiliée à aucun de ces projets. Les curseurs, couleurs, icônes, sons et le code sont originaux ou assortis d’une licence claire ; consultez les [crédits tiers](https://boulea7.github.io/swarmloom/docs/en/credits.html).

Clawd, le chef d’orchestre des vidéos promotionnelles, est une interprétation de la mascotte de Claude Code réalisée par des fans, sans affiliation à Anthropic.

## Licence

[MIT](../../LICENSE) © 2026 Boulea7 et les contributeurs de SwarmLoom
