# Sabbath School · Descargador de PDFs

Aplicación web moderna y optimizada construida con **[Astro](https://astro.build)**, **TypeScript** y **[Bun](https://bun.sh)** para explorar, previsualizar y descargar los PDFs oficiales de las lecciones de la Escuela Sabática (*Sabbath School*) mediante la API pública de `adventech.io`.

---

## ✨ Novedades y Funcionalidades

- **📦 Descarga completa en ZIP (.zip)**: Descarga todos los PDFs del trimestre (o de una lección individual) empaquetados en un único archivo comprimido mediante `JSZip`. ¡Se acabaron los bloqueos de descargas múltiples del navegador!
- **⬇️ Descargas por lote secuenciales (.pdf)**: Opción de descarga individual continua con pausa entre archivos (600 ms) y barra de progreso.
- **🛑 Control y cancelación en tiempo real**: Cancela descargas en cualquier momento con `AbortController`.
- **⚡ Carga progresiva y concurrente**: Interfaz fluida con *pools* de peticiones paralelas para consultar las lecciones sin congelar la pantalla.
- **💾 Caché inteligente en cliente**: Almacenamiento en memoria y `sessionStorage` para navegación instantánea entre trimestres previamente consultados sin saturar la API de Adventech.
- **📅 Filtros rápidos por año**: Chips dinámicos (`2026`, `2025`, `2024`...) combinados con buscador incremental por título o código.
- **⌨️ Atajos de teclado**:
  - `/` o `Ctrl+K`: Enfocar el buscador de trimestres.
  - `Escape`: Cerrar el modal de previsualización de PDF.
- **🌐 Multilingüe**: Acceso a trimestres en español, inglés, portugués, francés, alemán, italiano, rumano, ruso, ucraniano, coreano, entre otros.
- **👁️ Previsualizador y utilidades**:
  - Vista previa de PDFs en ventana modal.
  - Copiado rápido de URLs directas al portapapeles con confirmación visual (*toast*).
  - Inspección del JSON crudo de la API por lección y trimestre completo (con botón de copia).
  - Consola/terminal de actividad con registro en tiempo real y timestamps.
- **📱 Interfaz responsiva y moderna**: Tema oscuro refinado con diseño adaptado a móviles (con menú lateral deslizable).

---

## 🚀 Requisitos y Puesta en Marcha

Se recomienda **[Bun](https://bun.sh)** (v1.2+) o **Node.js** (>= 22.12.0).

### Instalación

```bash
bun install
```

### Desarrollo

Para iniciar el servidor de desarrollo en segundo plano (según `AGENTS.md`):

```bash
astro dev --background
```

O en modo interactivo estándar con Bun:

```bash
bun run dev
# → Servidor listo en http://localhost:4321
```

### Compilación para Producción

Genera la versión estática optimizada en `./dist/`:

```bash
bun run build
```

Para previsualizar el sitio compilado:

```bash
bun run preview
```

---

## 📡 API Adventech

La aplicación consume directamente los endpoints públicos v2 de Adventech (no requiere autenticación):

```http
GET https://sabbath-school.adventech.io/api/v2/languages/index.json
→ Catálogo de idiomas disponibles

GET https://sabbath-school.adventech.io/api/v2/{lang}/quarterlies/index.json
→ Lista de trimestres del idioma

GET https://sabbath-school.adventech.io/api/v2/{lang}/quarterlies/{qid}/index.json
→ Metadatos del trimestre e índice de lecciones

GET https://sabbath-school.adventech.io/api/v2/{lang}/quarterlies/{qid}/lessons/{lid}/index.json
→ Detalle de la lección, días y URLs a los PDFs (pdfs[])
```

El array `pdfs[]` enlaza directamente al CDN oficial `https://sabbath-school-pdf.adventech.io`, que cuenta con cabeceras `Access-Control-Allow-Origin: *`.

---

## 🛠️ Notas de Implementación

- **Estructura SPA de Adventech**: La API organiza las lecciones jerárquicamente; los enlaces a los archivos PDF residen dentro de cada `lessons/{id}/index.json`. La aplicación los resuelve concurrentemente para mayor velocidad.
- **Descargas CORS vía Blob**: El CDN no envía la cabecera `Content-Disposition: attachment`. Si se usara un simple `<a href="..." download>`, el navegador abriría el PDF en una pestaña. Para forzar la descarga con nombres limpios y normalizados (`2026-04-cq_es_L01_Titulo.pdf`), se descargan como `Blob` y se genera una URL temporal con `URL.createObjectURL`.
- **Generación de ZIPs en el navegador**: Gracias a `JSZip`, las descargas completas se procesan y comprimen directamente en el cliente a través de `ArrayBuffer`, generando un único archivo `.zip` sin requerir un backend propio.
- **Trimestres legados sin PDF**: Ciertos trimestres antiguos (ej. `2020-04`) sólo existen en formato texto web. La aplicación detecta automáticamente si `totalPdfs === 0` y notifica al usuario con un aviso descriptivo.

---

## 📁 Estructura del Proyecto

```text
.
├── public/                 # Favicons y recursos públicos estáticos
├── src/
│   ├── types/
│   │   └── adventech.ts    # Modelos TypeScript de la API y descargas
│   ├── lib/
│   │   ├── api.ts          # Cliente API con caché y control de concurrencia
│   │   ├── downloader.ts   # Servicios de descarga individual, batch y ZIP
│   │   └── formatters.ts   # Sanitización, formato de bytes y nombres de archivo
│   ├── styles/
│   │   └── global.css      # Sistema de diseño, tema oscuro y responsive
│   ├── components/
│   │   ├── Header.astro       # Barra de navegación superior
│   │   ├── Sidebar.astro      # Catálogo de trimestres y filtros por año
│   │   ├── QuarterStage.astro # Panel principal con lecciones y acciones
│   │   ├── PdfModal.astro     # Visor modal de PDFs
│   │   └── Toast.astro        # Notificaciones de retroalimentación
│   ├── layouts/
│   │   └── Layout.astro       # Layout base HTML5
│   ├── scripts/
│   │   └── app.ts             # Orquestador cliente de estado e interactividad
│   └── pages/
│       └── index.astro        # Página principal
├── package.json
├── astro.config.mjs
└── tsconfig.json
```

---

## ⚖️ Aviso Legal y Derechos de Autor

El contenido de las lecciones de la Escuela Sabática es propiedad intelectual de la General Conference of Seventh-day Adventists® y sus casas editoras asociadas.

Esta herramienta es un cliente no oficial de acceso a la API pública de [Adventech](https://adventech.io). El uso y distribución de los archivos PDF descargados está sujeto a las condiciones y derechos de autor del servicio oficial.
