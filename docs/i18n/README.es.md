<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/hero-dark.svg" />
    <source media="(prefers-color-scheme: light)" srcset="../../assets/brand/hero-light.svg" />
    <img alt="SwarmLoom: mira cómo un enjambre de cursores lo teje" src="../../assets/brand/hero-light.svg" width="1280" />
  </picture>
</p>

<h1 align="center">SwarmLoom</h1>

<p align="center"><strong>Mira cómo un enjambre de cursores lo teje ante tus ojos.</strong><br/>Un enjambre de cursores construye páginas web, documentos, código, imágenes y modelos 3D ante tus ojos, pieza a pieza, y exporta el resultado como un video con sonido.<br/>Es una reproducción visual local, no un orquestador de agentes de IA.</p>

<p align="center">
  <a href="https://github.com/Boulea7/swarmloom/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/Boulea7/swarmloom/ci.yml?branch=main&amp;style=flat-square&amp;label=CI" /></a>
  <a href="../../LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/badge/license-MIT-5B5BF7?style=flat-square" /></a>
  <a href="../../CONTRIBUTING.en.md"><img alt="Se aceptan PR" src="https://img.shields.io/badge/PRs-welcome-5B5BF7?style=flat-square" /></a>
</p>

<p align="center"><a href="../../README.md">简体中文</a> · <a href="../../README.en.md">English</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.ja.md">日本語</a> · <a href="./README.ko.md">한국어</a> · <strong>Español</strong> · <a href="./README.fr.md">Français</a> · <a href="./README.de.md">Deutsch</a></p>

<p align="center">
  <a href="https://boulea7.github.io/swarmloom/studio/"><strong>Prueba Studio en línea</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/"><strong>Sitio web</strong></a> ·
  <a href="https://boulea7.github.io/swarmloom/docs/en/"><strong>Documentación</strong></a>
</p>

## Recorrido en video

<!-- VIDEO:main -->

El video principal está en producción y se reproducirá aquí mismo.

<!-- /VIDEO:main -->

Sin instalar nada, puedes abrir los mismos ejemplos en [Studio en línea](https://boulea7.github.io/swarmloom/studio/) o leer primero la [guía ilustrada](https://boulea7.github.io/swarmloom/docs/en/getting-started.html).

## Formatos compatibles

Todas las animaciones de abajo se generaron de verdad con SwarmLoom. Selecciona una para reproducir el mismo ejemplo en Studio.

<table>
  <tr>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=web-demo"><img alt="Un enjambre reconstruyendo una página web" src="../../docs/assets/formats/web.webp" width="100%" /></a><br/>Páginas web</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=html-landing"><img alt="Una página HTML construida bloque a bloque" src="../../docs/assets/formats/html.webp" width="100%" /></a><br/>HTML</td>
    <td align="center" width="33%"><a href="https://boulea7.github.io/swarmloom/studio/?example=svg-emblem"><img alt="Trazos SVG dibujados uno a uno" src="../../docs/assets/formats/svg.webp" width="100%" /></a><br/>SVG</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=markdown-welcome.en"><img alt="Títulos y cuerpo de texto Markdown reconstruidos" src="../../docs/assets/formats/markdown.webp" width="100%" /></a><br/>Markdown</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=docx-report"><img alt="Un documento de Word reconstruido" src="../../docs/assets/formats/docx.webp" width="100%" /></a><br/>DOCX</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=doc-report"><img alt="Un documento de Word antiguo reconstruido" src="../../docs/assets/formats/doc.webp" width="100%" /></a><br/>DOC</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=pdf-brochure"><img alt="Una página PDF reconstruida" src="../../docs/assets/formats/pdf.webp" width="100%" /></a><br/>PDF</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=slides-pitch"><img alt="Una diapositiva reconstruida" src="../../docs/assets/formats/slides.webp" width="100%" /></a><br/>Presentaciones</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=sheet-sales"><img alt="Una hoja de cálculo construida fila a fila" src="../../docs/assets/formats/sheet.webp" width="100%" /></a><br/>Hojas de cálculo</td>
  </tr>
  <tr>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=code-swarm"><img alt="Código fuente escrito token a token" src="../../docs/assets/formats/code.webp" width="100%" /></a><br/>Código</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=image-scene"><img alt="Una imagen primero esbozada y luego coloreada" src="../../docs/assets/formats/image.webp" width="100%" /></a><br/>Imágenes</td>
    <td align="center"><a href="https://boulea7.github.io/swarmloom/studio/?example=3d-shuttle-glb"><img alt="Un modelo 3D construido a partir de su malla y sus materiales" src="../../docs/assets/formats/three.webp" width="100%" /></a><br/>Modelos 3D</td>
  </tr>
</table>

<details>
<summary>Otros formatos que puedes abrir</summary>

OpenDocument (ODT / ODS / ODP), EPUB, RTF, OFD, Jupyter Notebook, grabaciones de terminal asciinema, Patch / Diff, mapas mentales de XMind / FreeMind y animaciones Lottie. Las hojas de cálculo incluyen XLSX / CSV / ODS; los formatos 3D incluyen GLB / glTF / OBJ / STL / PLY. La [guía de formatos](https://boulea7.github.io/swarmloom/docs/en/formats.html) enumera todas las extensiones y el grado de fidelidad con que se reproduce cada formato.

</details>

## ¿Por qué SwarmLoom?

<table>
  <tr>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/web-dark.svg" /><img alt="Tarjeta de página web" src="../../assets/brand/cards/web-light.svg" width="100%" /></picture><br/><b>Reconstruye la página que estás viendo</b><br/>La extensión reconstruye la pestaña actual o un área seleccionada y luego deja la página como estaba.</td>
    <td width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/docs-dark.svg" /><img alt="Tarjeta de documentos" src="../../assets/brand/cards/docs-light.svg" width="100%" /></picture><br/><b>Muchos formatos, un solo escenario</b><br/>Los mismos cursores construyen documentos, hojas de cálculo, presentaciones, código, imágenes y modelos 3D.</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/video-dark.svg" /><img alt="Tarjeta de exportación de video" src="../../assets/brand/cards/video-light.svg" width="100%" /></picture><br/><b>Exporta videos con sonido</b><br/>La CLI exporta MP4, WebM o GIF fotograma a fotograma; con los mismos ajustes, obtienes la misma imagen y el mismo sonido.</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/platforms-dark.svg" /><img alt="Tarjeta de plataformas" src="../../assets/brand/cards/platforms-light.svg" width="100%" /></picture><br/><b>Varias plataformas</b><br/>Extensiones para Chrome, Edge, Firefox y Safari, Studio como PWA y un reproductor compacto para relojes inteligentes.</td>
  </tr>
  <tr>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/html-svg-dark.svg" /><img alt="Tarjeta de animaciones HTML y SVG" src="../../assets/brand/cards/html-svg-light.svg" width="100%" /></picture><br/><b>Las animaciones continúan</b><br/>Las animaciones SVG comienzan a reproducirse cuando el dibujo está terminado; las animaciones CSS se reanudan al seleccionar Go live.</td>
    <td><picture><source media="(prefers-color-scheme: dark)" srcset="../../assets/brand/cards/code-dark.svg" /><img alt="Tarjeta de código" src="../../assets/brand/cards/code-light.svg" width="100%" /></picture><br/><b>Incrústalo y contrólalo con scripts</b><br/>Usa el elemento <code>&lt;swarm-loom&gt;</code>, la API de JavaScript o la CLI.</td>
  </tr>
</table>

## Cómo funciona

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="../../docs/assets/how-it-works-dark.svg" />
    <img alt="Lee una página web o un archivo, organiza los cursores en orden de lectura y reproduce en vivo o exporta un video" src="../../docs/assets/how-it-works-light.svg" width="760" />
  </picture>
</p>

SwarmLoom divide una página web o un archivo en capas y las asigna a los cursores siguiendo el orden de lectura. Studio reproduce la construcción en vivo. La CLI la captura fotograma a fotograma y añade el sonido, de modo que la exportación no depende de la velocidad de tu equipo.

## Inicio rápido

### Pruébalo en línea

Abre [Studio en línea](https://boulea7.github.io/swarmloom/studio/) y elige un ejemplo, arrastra un archivo local, pega texto o introduce una URL. Los archivos locales permanecen en tu navegador. Si introduces una URL, tu navegador hace la solicitud directamente a ese sitio, y el sitio tiene que permitir lecturas de origen cruzado.

### Compilar desde el código fuente

Está previsto publicar releases de GitHub, paquetes de npm y versiones en las tiendas. Por ahora, compila desde el código fuente. Necesitas Node.js 22.12 o superior; la versión de pnpm está fijada en `packageManager`.

```bash
git clone https://github.com/Boulea7/swarmloom.git
cd swarmloom
corepack enable
pnpm install
pnpm build
```

### CLI

Desde la raíz del repositorio, convierte un archivo en video:

```bash
node apps/cli/dist/cli.js render examples/svg/emblem.svg -o emblem.mp4
```

Necesitas Chrome o Chromium; para MP4, WebM, GIF y WebP también necesitas FFmpeg 4 o superior. Ejecuta `node apps/cli/dist/cli.js doctor` para comprobar tu configuración. Cuando se publique el paquete de npm, `npx swarmloom` funcionará directamente (previsto).

### Componente web

El paquete de npm `@swarmloom/element` aún no está publicado (previsto). El elemento en sí ya funciona:

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

Consulta la [guía del componente](https://boulea7.github.io/swarmloom/docs/en/element.html) para ver todos los atributos y eventos.

## Instalación por plataforma

Las versiones para tiendas y los paquetes firmados aún no están disponibles. Todo lo siguiente usa los paquetes de desarrollo que `pnpm build` generó en el paso anterior.

<details>
<summary>Chrome / Edge / Brave / Opera</summary>

- Chrome: abre `chrome://extensions`, activa el modo de desarrollador, selecciona Cargar extensión sin empaquetar y elige `apps/extension/dist/chrome/`.
- Edge: abre `edge://extensions` y elige `apps/extension/dist/edge/`.
- Brave / Opera: activa el modo de desarrollador en su página de extensiones y elige el mismo `dist/chrome/`.
- En una página web normal, selecciona el icono de la barra de herramientas o pulsa Alt+Shift+W. Las páginas internas del navegador, las tiendas web y el visor de PDF integrado no permiten ejecutar extensiones.

</details>

<details>
<summary>Firefox para escritorio y Android (versión firmada prevista)</summary>

Escritorio: abre `about:debugging#/runtime/this-firefox`, selecciona Cargar complemento temporal y elige `apps/extension/dist/firefox/manifest.json`; Firefox lo eliminará al reiniciarse. Android usa el mismo paquete; para depurar se necesitan web-ext, ADB y un dispositivo con la depuración activada. Una instalación permanente requiere la versión firmada por AMO; hasta entonces, usa Studio como PWA en los teléfonos.

</details>

<details>
<summary>Safari en macOS / iOS / iPadOS / visionOS (pruebas en dispositivos y firma previstas)</summary>

En una Mac con Xcode, ejecuta `pnpm --filter @swarmloom/extension package:safari`, abre `apps/extension/build/safari/` en Xcode, elige tu equipo y ejecuta la app contenedora; después, activa la extensión en los ajustes del sistema. Para instalarla en un dispositivo se necesita el Apple Developer Program; todavía no se han realizado pruebas en dispositivos reales con estos sistemas.

</details>

<details>
<summary>PWA: escritorio, Android, iOS / iPadOS</summary>

En Chrome / Edge, abre Studio y usa Instalar aplicación en la barra de direcciones o el menú. En Safari para macOS, usa Añadir al Dock; en Android, Instalar aplicación o Añadir a pantalla de inicio; en iOS / iPadOS, elige Añadir a pantalla de inicio en el menú Compartir de Safari. En Firefox para escritorio, usa Studio en una pestaña normal.

</details>

<details>
<summary>Plegables y relojes</summary>

Los dispositivos plegables no necesitan nada adicional: cuando el navegador admite Viewport Segments, Studio se divide en dos paneles, uno al lado del otro o apilados; en caso contrario, usa el diseño normal. Los relojes no tienen extensión ni se promete una PWA completa. Abre `?watch=1` para usar un reproductor compacto que empieza sin sonido, o `?round=1` para pantallas redondas. Exporta las escenas más grandes en otro dispositivo y mira el resultado.

</details>

## Comparación con Swarm Rebuild

| Área | Qué aporta SwarmLoom |
| --- | --- |
| Entradas | Documentos, código, imágenes y modelos 3D, no solo la página web actual. |
| Plataformas | Studio PWA, CLI, componente web y un reproductor para relojes, no solo una extensión de Chrome. |
| Salida | Videos con sonido; con los mismos ajustes se obtiene el mismo resultado. |

## Documentación

[Primeros pasos](https://boulea7.github.io/swarmloom/docs/en/getting-started.html) · [Formatos y límites](https://boulea7.github.io/swarmloom/docs/en/formats.html) · [Instalación por plataforma](https://boulea7.github.io/swarmloom/docs/en/install.html) · [CLI](https://boulea7.github.io/swarmloom/docs/en/cli.html) · [Componente web](https://boulea7.github.io/swarmloom/docs/en/element.html) · [Privacidad](../../PRIVACY.md)

## Preguntas frecuentes

1. **¿Hay IA detrás de los cursores?** No. Los cursores son una animación local controlada por una semilla fija. No se llama a ningún modelo y nunca se ejecutan los scripts incluidos en documentos o HTML.
2. **¿Se suben los archivos locales?** No. Los archivos se procesan en tu navegador. El navegador solo se comunica con un sitio cuando abres su URL; las imágenes y fuentes enlazadas desde HTML se pueden desactivar en los ajustes de Studio. Consulta [Privacidad](../../PRIVACY.md).
3. **¿Por qué algunas páginas no se pueden reconstruir en el mismo lugar?** Los navegadores no permiten que las extensiones se ejecuten en páginas internas, tiendas web o el visor de PDF integrado. En ese caso, arrastra el archivo a Studio; para una página normal que requiera iniciar sesión, usa la extensión.
4. **¿Los mismos ajustes generan un MP4 idéntico byte a byte?** La imagen y el sonido coinciden fotograma a fotograma (con la misma entrada, navegador, fuentes, sistema operativo y ajustes). El archivo MP4 en sí puede tener bytes distintos según la versión del codificador.
5. **¿Se puede instalar la extensión en teléfonos y relojes?** En teléfonos, usa Studio como PWA por ahora; está prevista una versión firmada de Firefox para Android. Los relojes solo tienen el reproductor compacto, sin extensión ni reproducción en segundo plano.

## Hoja de ruta

- **Ahora**: Studio en línea, páginas web y 20 formatos de archivo, exportación de video fotograma a fotograma con la CLI o dentro de Studio, y extensiones para Chrome / Edge / Firefox / Safari compiladas desde el código fuente.
- **Próximamente**: la primera release de GitHub y paquetes de npm, publicación en tiendas y extensiones firmadas, y pruebas en teléfonos y dispositivos con Safari.
- **Más adelante**: más formatos y plataformas, sin prometer fechas. Comparte ideas en [Ideas](https://github.com/Boulea7/swarmloom/discussions/categories/ideas).

## Contribuciones y soporte

- Código, documentación, traducciones y ejemplos: lee primero [CONTRIBUTING](../../CONTRIBUTING.en.md) y el [Código de conducta](../../CODE_OF_CONDUCT.md).
- Preguntas: [Preguntas y respuestas en Discussions](https://github.com/Boulea7/swarmloom/discussions/categories/q-a). Errores que puedas reproducir: [Informe de error](https://github.com/Boulea7/swarmloom/issues/new?template=bug_report.yml).
- Un formato que te gustaría ver: [Solicitud de formato](https://github.com/Boulea7/swarmloom/issues/new?template=format_request.yml).
- Problemas de seguridad: repórtalos en privado como se describe en [SECURITY](../../SECURITY.md), nunca en una incidencia pública.

## Créditos

Inspirado por Swarm, de Joel Califa, y Swarm Rebuild, de Dhvanil Patel. SwarmLoom es una implementación independiente, desarrollada en sala limpia: no reutiliza nada de su código, sus tablas de constantes ni sus recursos visuales, y no tiene afiliación con ninguno de los dos proyectos. Los cursores, colores, iconos, sonidos y el código son originales o tienen licencias claras; consulta los [créditos de terceros](https://boulea7.github.io/swarmloom/docs/en/credits.html).

Clawd, el director de orquesta en los videos promocionales, es una reinterpretación de la mascota de Claude Code hecha por fans, sin ninguna afiliación con Anthropic.

## Licencia

[MIT](../../LICENSE) © 2026 Boulea7 y los colaboradores de SwarmLoom
