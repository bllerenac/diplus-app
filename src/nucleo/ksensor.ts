/**
 * Las tramas KSensor de los beacons KKM.
 *
 * Van en el anuncio, no en una conexión: el beacon corta a los pocos segundos
 * si no se autentica, y una conexión no aguantaría una pluma moviéndose. Con
 * `Sensor Axis` encendido la trama trae los tres ejes del acelerómetro.
 *
 * Los campos salieron de tramas reales del KBPro_686915. Los ejes van en
 * cuentas crudas a propósito: cuántas cuentas son un g lo fija la calibración,
 * que además recoge cómo quedó atornillado cada beacon.
 */
import { Anuncio, uuidCorto } from './bluetooth';

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface LecturaKSensor {
  /** Milivoltios de la pila. Una CR2477 nueva ronda los 3000. */
  pilaMv: number;
  /** Grados centígrados. */
  temperatura: number;
  /** Cuentas crudas del acelerómetro, sin escalar. */
  ejes: Vector3;
  /** Potencia declarada a un metro, en dBm. */
  tx: number;
}

/** Los KKM cuelgan sus lecturas del UUID de Eddystone. */
export const UUID_KSENSOR = '0xfeaa';

const TIPO = 0x21;
const LARGO_MINIMO = 13;

const aBytes = (hex: string): number[] =>
  (hex.match(/../g) ?? []).map((b) => parseInt(b, 16)).filter((n) => !Number.isNaN(n));

const sinSigno16 = (b: number[], i: number) => b[i] | (b[i + 1] << 8);
const conSigno16 = (b: number[], i: number) => {
  const v = sinSigno16(b, i);
  return v & 0x8000 ? v - 0x10000 : v;
};
const conSigno8 = (v: number) => (v & 0x80 ? v - 0x100 : v);

export const leerKSensor = (hex: string): LecturaKSensor | null => {
  const b = aBytes(hex);
  if (b.length < LARGO_MINIMO || b[0] !== TIPO) return null;
  return {
    pilaMv: sinSigno16(b, 2),
    temperatura: conSigno16(b, 4) / 256,
    ejes: { x: conSigno16(b, 6), y: conSigno16(b, 8), z: conSigno16(b, 10) },
    tx: conSigno8(b[12]),
  };
};

/** La lectura del anuncio, si el beacon la trae. */
export const kSensorDe = (a: Anuncio): LecturaKSensor | null => {
  for (const [uuid, hex] of Object.entries(a.datosServicio ?? {})) {
    if (uuidCorto(uuid) !== UUID_KSENSOR) continue;
    const l = leerKSensor(hex);
    if (l) return l;
  }
  return null;
};
