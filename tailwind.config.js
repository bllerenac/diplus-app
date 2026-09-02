/**
 * Tailwind 3 y no 4, a proposito.
 *
 * El WebView de este equipo es **Chrome 78** (Android 9, de 2019). Tailwind 4
 * genera `@layer`, `@property` y `color-mix()`, que ese navegador no entiende:
 * descarta los bloques `@layer` enteros, asi que las clases existen en el CSS
 * y no pintan nada. Se probo y se vio en el equipo.
 *
 * La version 3 sale aplanada por PostCSS y funciona. Mientras el objetivo sea
 * Android 9, no se puede subir.
 *
 * Los colores apuntan a las variables de `theme/diplus.css` para tener una sola
 * paleta, la misma que el panel del HelperBox y el cliente web.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        sur: 'rgb(var(--sur-rgb) / <alpha-value>)',
        sur2: 'rgb(var(--sur2-rgb) / <alpha-value>)',
        sur3: 'rgb(var(--sur3-rgb) / <alpha-value>)',
        line: 'rgb(var(--line-rgb) / <alpha-value>)',
        line2: 'rgb(var(--line2-rgb) / <alpha-value>)',
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        ink2: 'rgb(var(--ink2-rgb) / <alpha-value>)',
        ink3: 'rgb(var(--ink3-rgb) / <alpha-value>)',
        acc: 'rgb(var(--acc-rgb) / <alpha-value>)',
        acc2: 'rgb(var(--acc2-rgb) / <alpha-value>)',
        ok: 'rgb(var(--acc-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        bad: 'rgb(var(--bad-rgb) / <alpha-value>)',
      },
      fontFamily: {
        titulo: ['Archivo Variable', 'Archivo', 'Helvetica Neue', 'Arial', 'sans-serif'],
        texto: ['IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Roboto Mono', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
