/**
 * En que geocerca esta la maquina, y que se recomienda ahi.
 *
 * De esto cuelga la mitad de la pantalla: la velocidad y el consumo que hay que
 * mantener no son los mismos en una rampa que en una via de acarreo, y lo que
 * decide cual toca es el sitio donde uno esta en ese momento.
 */
import { Geocerca } from './servidor';

/**
 * Punto dentro de un poligono, por el metodo del rayo.
 *
 * Se traza una semirrecta horizontal desde el punto y se cuentan los lados que
 * cruza: impar es dentro, par es fuera. Vale para poligonos concavos, que en
 * una mina son la norma —una rampa no es un rectangulo—, y no le importa el
 * sentido en que se dibujaron los vertices.
 */
export const dentroDelPoligono = (p: [number, number], vertices: [number, number][]): boolean => {
  if (vertices.length < 3) return false;

  let dentro = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const [yi, xi] = vertices[i];
    const [yj, xj] = vertices[j];

    /* El lado cruza la altura del punto, y el corte queda a su derecha. */
    const cruza = yi > p[0] !== yj > p[0];
    if (cruza && p[1] < ((xj - xi) * (p[0] - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
};

/** Metros entre dos puntos, por la formula del semiverseno. */
export const metrosEntre = (a: [number, number], b: [number, number]): number => {
  const R = 6371000;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLon = ((b[1] - a[1]) * Math.PI) / 180;
  const la1 = (a[0] * Math.PI) / 180;
  const la2 = (b[0] * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
};

/**
 * La geocerca en la que esta el punto.
 *
 * Si cae en varias —en una mina se solapan, una rampa dentro de un area— gana
 * **la mas pequeña**, que es la mas concreta: estando en la rampa interesa el
 * limite de la rampa, no el del area entera que la contiene.
 */
export const geocercaDe = (p: [number, number], geocercas: Geocerca[]): Geocerca | null => {
  const dentro = geocercas.filter((g) =>
    g.tipo === 'circulo'
      ? g.puntos.length > 0 && metrosEntre(p, g.puntos[0]) <= g.radio
      : dentroDelPoligono(p, g.puntos),
  );
  if (!dentro.length) return null;

  return dentro.reduce((mas, g) => (areaAproximada(g) < areaAproximada(mas) ? g : mas));
};

/** Solo sirve para comparar tamaños entre geocercas, no como area de verdad. */
const areaAproximada = (g: Geocerca): number => {
  if (g.tipo === 'circulo') return Math.PI * g.radio * g.radio;

  let a = 0;
  const v = g.puntos;
  for (let i = 0, j = v.length - 1; i < v.length; j = i, i += 1) {
    a += (v[j][1] + v[i][1]) * (v[j][0] - v[i][0]);
  }
  /* En grados cuadrados, pasados a metros a ojo: basta para ordenarlas. */
  return Math.abs(a / 2) * 1.23e10;
};

/** Lo que hay que mantener en una geocerca. */
export interface Recomendacion {
  /** Kilometros por hora. */
  velocidad: number;
  /** Galones por hora. */
  galonesHora: number;
}

export const RECOMENDACION_POR_DEFECTO: Recomendacion = { velocidad: 30, galonesHora: 12 };

/**
 * Lo recomendado donde uno esta.
 *
 * El servidor no trae estos valores, asi que se configuran en el equipo, por
 * geocerca. Sin nada puesto se usa el general, que es mejor que no enseñar
 * nada: un limite aproximado orienta, y la ausencia de limite no.
 */
export const recomendacionDe = (
  g: Geocerca | null,
  puestas: Record<string, Recomendacion>,
  general: Recomendacion = RECOMENDACION_POR_DEFECTO,
): Recomendacion => (g && puestas[g.id]) || general;

/** Como va uno respecto a lo recomendado. */
export type Cumplimiento = 'bien' | 'justo' | 'pasado';

/**
 * Se avisa antes de pasarse, no despues.
 *
 * A partir del 90 % del limite ya se marca «justo»: en una rampa cargada, para
 * cuando el numero se pone rojo la maquina lleva un rato yendo demasiado
 * rapido.
 */
export const comoVoy = (valor: number, limite: number): Cumplimiento => {
  if (limite <= 0) return 'bien';
  if (valor > limite) return 'pasado';
  if (valor >= limite * 0.9) return 'justo';
  return 'bien';
};
