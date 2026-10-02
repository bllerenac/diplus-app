/**
 * Qué está haciendo la pala, a partir de tres lecturas.
 *
 * El giro solo cuenta parado: al trasladarse las orugas también giran la
 * cabina, y eso no es girar la pala.
 */

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
