/**
 * Troceado del flujo serie en tramas.
 *
 * Un puerto serie entrega **bytes, no mensajes**. Una trama puede llegar
 * partida en dos lecturas, o dos tramas pueden llegar pegadas en una sola. Dar
 * por hecho que cada `read()` trae exactamente una trama funciona en la mesa de
 * pruebas y falla en campo de forma intermitente, que es la peor manera de
 * fallar.
 *
 * Asi que todo lo que entra se acumula aqui y es el troceador quien decide
 * donde empieza y acaba cada mensaje. Cada protocolo elige su forma de
 * trocear porque no hay una que valga para todos:
 *
 *   porLinea    el mensaje acaba en salto de linea. JSON y CSV.
 *   porSilencio el mensaje acaba cuando el cable calla. Modbus RTU y Eurosens,
 *               que son binarios y no tienen separador.
 *   porLargo    el mensaje mide siempre lo mismo.
 */

/** Tope del acumulador: sin el, una linea sin fin se come la memoria. */
const MAX_ACUMULADO = 8192;

/* TypeScript 5.9 distingue el tipo del bufer que hay debajo, y `slice()`
   devuelve el generico. Con el alias se evita pelear con eso en cada linea. */
export type Bytes = Uint8Array<ArrayBufferLike>;
export type Trozo = Bytes;

export interface Troceador {
  /** Mete bytes y devuelve las tramas completas que hayan quedado. */
  empujar(bytes: Bytes): Trozo[];
  /** Lo que el tiempo haya dejado listo (solo lo usa `porSilencio`). */
  vencidos(): Trozo[];
  reiniciar(): void;
}

const concatenar = (a: Bytes, b: Bytes): Bytes => {
  const r = new Uint8Array(a.length + b.length);
  r.set(a, 0);
  r.set(b, a.length);
  return r;
};

/** Trama por linea: todo hasta `\n`. Los `\r` sobrantes se quitan. */
export const porLinea = (): Troceador => {
  let buf: Bytes = new Uint8Array(0);

  return {
    empujar(bytes) {
      buf = concatenar(buf, bytes);
      const salida: Trozo[] = [];

      let corte = buf.indexOf(0x0a);
      while (corte !== -1) {
        let fin = corte;
        if (fin > 0 && buf[fin - 1] === 0x0d) fin -= 1; // \r\n
        if (fin > 0) salida.push(buf.slice(0, fin));
        buf = buf.slice(corte + 1);
        corte = buf.indexOf(0x0a);
      }

      /* Una linea que nunca acaba no puede crecer sin fin. Se descarta lo viejo
         y se sigue: es preferible perder una trama a quedarse sin memoria. */
      if (buf.length > MAX_ACUMULADO) buf = buf.slice(-MAX_ACUMULADO);

      return salida;
    },
    vencidos: () => [],
    reiniciar() {
      buf = new Uint8Array(0);
    },
  };
};

/**
 * Trama por silencio, que es como separa Modbus RTU.
 *
 * El estandar habla de 3,5 caracteres de silencio; a 9600 baudios son unos
 * 4 ms. En Android, entre el driver y la maquina virtual, esos 4 ms no se
 * miden con fiabilidad, asi que se usa una pausa mas holgada. Es de sobra
 * mientras no haya dos aparatos hablando encima.
 */
export const porSilencio = (pausaMs = 25): Troceador => {
  let buf: Bytes = new Uint8Array(0);
  let ultimo = 0;

  const cerrar = (): Trozo[] => {
    if (!buf.length) return [];
    const t = buf;
    buf = new Uint8Array(0);
    return [t];
  };

  return {
    empujar(bytes) {
      const ahora = Date.now();
      const salida = buf.length && ahora - ultimo >= pausaMs ? cerrar() : [];
      ultimo = ahora;
      buf = concatenar(buf, bytes);
      if (buf.length > MAX_ACUMULADO) buf = buf.slice(-MAX_ACUMULADO);
      return salida;
    },
    vencidos() {
      return buf.length && Date.now() - ultimo >= pausaMs ? cerrar() : [];
    },
    reiniciar() {
      buf = new Uint8Array(0);
      ultimo = 0;
    },
  };
};

/** Trama de largo fijo. */
export const porLargo = (largo: number): Troceador => {
  let buf: Bytes = new Uint8Array(0);

  return {
    empujar(bytes) {
      buf = concatenar(buf, bytes);
      const salida: Trozo[] = [];
      while (buf.length >= largo) {
        salida.push(buf.slice(0, largo));
        buf = buf.slice(largo);
      }
      return salida;
    },
    vencidos: () => [],
    reiniciar() {
      buf = new Uint8Array(0);
    },
  };
};

export const troceador = (modo: 'linea' | 'silencio' | 'largo', largo = 8): Troceador => {
  if (modo === 'linea') return porLinea();
  if (modo === 'largo') return porLargo(largo);
  return porSilencio();
};

/* ── Conversiones ─────────────────────────────────────────────────────────── */

export const aHex = (b: Bytes): string =>
  Array.from(b)
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0'))
    .join(' ');

export const deHex = (s: string): Bytes => {
  const limpio = s.replace(/[^0-9a-fA-F]/g, '');
  const par = limpio.length % 2 ? `0${limpio}` : limpio;
  const out = new Uint8Array(par.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(par.substr(i * 2, 2), 16);
  return out;
};

export const aTexto = (b: Bytes): string => new TextDecoder('utf-8').decode(b);

/** Solo lo imprimible; el resto como punto, para poder mirar un binario. */
export const aAscii = (b: Bytes): string =>
  Array.from(b)
    .map((x) => (x >= 32 && x <= 126 ? String.fromCharCode(x) : '.'))
    .join('');
