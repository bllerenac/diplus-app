/**
 * Qué está haciendo la pala, a partir de tres lecturas.
 *
 * El giro solo cuenta parado: al trasladarse las orugas también giran la
 * cabina, y eso no es girar la pala.
 */

import { Vector3 } from './ksensor';

export interface LecturaPala {
  /** km/h, del GPS. */
  velocidad: number;
  /** °/s alrededor del eje vertical, del giroscopio de la tablet. */
  giro: number;
  /** °/s de inclinación de la pluma, del beacon. Positivo es subir. */
  pluma: number;
}

export type EstadoPala = 'quieta' | 'trasladando' | 'girando' | 'subiendo' | 'bajando';

export const UMBRALES_PALA = { velocidad: 0.5, giro: 5, pluma: 2 };

export const estadosPala = (l: LecturaPala, u = UMBRALES_PALA): EstadoPala[] => {
  const res: EstadoPala[] = [];
  const parada = Math.abs(l.velocidad) <= u.velocidad;

  if (!parada) res.push('trasladando');
  if (parada && Math.abs(l.giro) > u.giro) res.push('girando');
  if (l.pluma > u.pluma) res.push('subiendo');
  if (l.pluma < -u.pluma) res.push('bajando');

  return res.length ? res : ['quieta'];
};

export const NOMBRE_ESTADO: Record<EstadoPala, string> = {
  quieta: 'Quieta',
  trasladando: 'Trasladándose',
  girando: 'Girando',
  subiendo: 'Subiendo pluma',
  bajando: 'Bajando pluma',
};

/* ---------------------------------------------------------------------------
 * Los beacons y su calibración.
 *
 * Un acelerómetro quieto mide hacia dónde tira la gravedad. Al girar la pluma,
 * ese vector recorre un arco: basta con capturarlo en dos posturas para saber
 * en qué plano se mueve y medir el ángulo, sin exigir que el beacon quede
 * atornillado en ninguna orientación concreta. Eso último importa en campo,
 * donde no hay forma de alinear nada con precisión sobre una pluma.
 * ------------------------------------------------------------------------ */

export type PapelBeacon = 'tornamesa' | 'pluma' | 'brazo';

export const NOMBRE_PAPEL: Record<PapelBeacon, string> = {
  tornamesa: 'Tornamesa',
  pluma: 'Pluma',
  brazo: 'Brazo',
};

export interface Calibracion {
  /** La postura de referencia: aquí el ángulo vale cero. */
  a: Vector3;
  /** La segunda postura. Fija el plano de giro y hacia dónde crece el ángulo. */
  b?: Vector3;
}

const resta = (p: Vector3, q: Vector3): Vector3 => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
const escala = (p: Vector3, k: number): Vector3 => ({ x: p.x * k, y: p.y * k, z: p.z * k });
const punto = (p: Vector3, q: Vector3) => p.x * q.x + p.y * q.y + p.z * q.z;
const cruz = (p: Vector3, q: Vector3): Vector3 => ({
  x: p.y * q.z - p.z * q.y,
  y: p.z * q.x - p.x * q.z,
  z: p.x * q.y - p.y * q.x,
});
const modulo = (p: Vector3) => Math.sqrt(punto(p, p));

export const unitario = (p: Vector3): Vector3 | null => {
  const m = modulo(p);
  return m > 1e-9 ? escala(p, 1 / m) : null;
};

const GRADOS = 180 / Math.PI;

/** Cuánto se abrieron dos vectores, en grados. Sin signo. */
export const anguloEntre = (p: Vector3, q: Vector3): number | null => {
  const a = unitario(p);
  const b = unitario(q);
  if (!a || !b) return null;
  return Math.acos(Math.min(1, Math.max(-1, punto(a, b)))) * GRADOS;
};

/**
 * El ángulo de la pieza, contado desde la postura de referencia y creciendo
 * hacia la segunda. Se mide en el plano que definen las dos posturas, así que
 * lo que se mueva fuera de ese plano no lo ensucia.
 */
export const anguloCalibrado = (cal: Calibracion, lectura: Vector3): number | null => {
  const u = unitario(cal.a);
  const segunda = cal.b ? unitario(cal.b) : null;
  const v = unitario(lectura);
  if (!u || !segunda || !v) return null;

  const n = unitario(cruz(u, segunda));
  if (!n) return null; /* las dos posturas coinciden: no hay plano que medir */

  const w = cruz(n, u); /* unitario: n y u son unitarios y perpendiculares */
  const plano = resta(v, escala(n, punto(v, n)));
  if (modulo(plano) < 1e-9) return null;

  return Math.atan2(punto(plano, w), punto(plano, u)) * GRADOS;
};

/** Cuánto se ha inclinado la máquina respecto de su referencia en plano. */
export const inclinacionMaquina = (cal: Calibracion, lectura: Vector3): number | null =>
  anguloEntre(cal.a, lectura);

export interface Muestra {
  at: number;
  angulo: number;
}

/**
 * Grados por segundo en la ventana.
 *
 * Es lo que `estadosPala` espera como `pluma`. Va sobre el ángulo y no sobre
 * las cuentas crudas porque así la pendiente del banco se cancela sola: una
 * inclinación constante desaparece al derivar.
 */
export const gradosPorSegundo = (m: Muestra[]): number => {
  if (m.length < 2) return 0;
  const vieja = m[0];
  const nueva = m[m.length - 1];
  const seg = (nueva.at - vieja.at) / 1000;
  return seg > 0 ? (nueva.angulo - vieja.angulo) / seg : 0;
};

/** Deja en la ventana solo lo ocurrido en los últimos `ms`. */
export const ventana = (m: Muestra[], ms: number, ahora = Date.now()): Muestra[] =>
  m.filter((x) => ahora - x.at <= ms);

/**
 * Las posturas que hay que poner la máquina para calibrar, en orden.
 *
 * Son posturas de la pala, no del beacon en una mesa: así la calibración
 * recoge de una vez cómo quedó atornillado cada uno y en qué plano se mueve
 * de verdad su pieza. Entre una y otra la máquina tiene que estar quieta, que
 * un acelerómetro en movimiento mide la sacudida además de la gravedad.
 */
export interface Postura {
  id: string;
  papel: PapelBeacon;
  /** Dónde se guarda: `a` es la referencia y `b` la que abre el plano. */
  ranura: 'a' | 'b';
  titulo: string;
  detalle: string;
  /**
   * Cómo se dibuja la máquina en esta postura: es a lo que hay que apuntar.
   *
   * Al estar definidas aquí, la pantalla sabe qué ángulo del dibujo
   * corresponde a cada extremo medido sin que nadie tenga que ajustarlo.
   */
  pose: { pluma: number; brazo: number };
}

export const POSTURAS: Postura[] = [
  {
    id: 'tornamesa-plano',
    papel: 'tornamesa',
    ranura: 'a',
    titulo: 'Máquina en terreno plano',
    detalle: 'Parada y quieta sobre piso nivelado. De aquí sale el cero contra el que se mide después la pendiente del banco.',
    pose: { pluma: -18, brazo: -10 },
  },
  {
    id: 'pluma-abajo',
    papel: 'pluma',
    ranura: 'a',
    titulo: 'Pluma abajo, cucharón en el piso',
    detalle: 'Pluma hasta abajo y el cucharón apoyado, como al empezar a excavar. Es el cero de la pluma.',
    pose: { pluma: -24, brazo: -6 },
  },
  {
    id: 'pluma-arriba',
    papel: 'pluma',
    ranura: 'b',
    titulo: 'Pluma arriba del todo',
    detalle: 'Sube la pluma al máximo sin mover el brazo. Esto abre el plano de giro y fija hacia dónde crece el ángulo.',
    pose: { pluma: 26, brazo: -6 },
  },
  {
    id: 'brazo-recogido',
    papel: 'brazo',
    ranura: 'a',
    titulo: 'Brazo recogido',
    detalle: 'Brazo cerrado contra la pluma, dejando la pluma como esté. Es el cero del brazo.',
    pose: { pluma: 4, brazo: -28 },
  },
  {
    id: 'brazo-extendido',
    papel: 'brazo',
    ranura: 'b',
    titulo: 'Brazo extendido del todo',
    detalle: 'Abre el brazo al máximo sin tocar la pluma. Con esto queda medido su recorrido completo.',
    pose: { pluma: 4, brazo: 26 },
  },
];
