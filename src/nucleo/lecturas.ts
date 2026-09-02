/**
 * Lectura de numeros dentro de una trama, y las dos sumas de verificacion.
 *
 * Todo lo que aqui se llama «señal» es lo mismo que en el HelperBox: un valor
 * con nombre y unidad. Se mantiene el mismo vocabulario a proposito, porque los
 * dos sistemas leen los mismos aparatos y quien mire uno tiene que reconocer el
 * otro.
 */

export interface Senal {
  clave: string;
  nombre: string;
  unidad: string;
  valor: number | string | null;
  /** Cuando el aparato no puede distinguir «cero» de «no disponible». */
  ambiguo?: boolean;
}

export const senal = (
  clave: string,
  nombre: string,
  unidad: string,
  valor: number | string | null,
  extra: Partial<Senal> = {},
): Senal => ({ clave, nombre, unidad, valor, ...extra });

/* ── Lectores ─────────────────────────────────────────────────────────────── */

export type TipoLectura =
  | 'u8' | 's8'
  | 'u16le' | 'u16be' | 's16le' | 's16be'
  | 'u32le' | 'u32be' | 's32le' | 's32be'
  | 'f32le' | 'f32be';

export const TIPOS_LECTURA: TipoLectura[] = [
  'u8', 's8',
  'u16le', 'u16be', 's16le', 's16be',
  'u32le', 'u32be', 's32le', 's32be',
  'f32le', 'f32be',
];

const LARGO: Record<TipoLectura, number> = {
  u8: 1, s8: 1,
  u16le: 2, u16be: 2, s16le: 2, s16be: 2,
  u32le: 4, u32be: 4, s32le: 4, s32be: 4,
  f32le: 4, f32be: 4,
};

/** `null` si la trama es mas corta de lo que pide el tipo, en vez de reventar. */
export const leer = (b: Uint8Array, desde: number, tipo: TipoLectura): number | null => {
  const n = LARGO[tipo];
  if (desde < 0 || b.length < desde + n) return null;

  const dv = new DataView(b.buffer, b.byteOffset + desde, n);
  switch (tipo) {
    case 'u8': return dv.getUint8(0);
    case 's8': return dv.getInt8(0);
    case 'u16le': return dv.getUint16(0, true);
    case 'u16be': return dv.getUint16(0, false);
    case 's16le': return dv.getInt16(0, true);
    case 's16be': return dv.getInt16(0, false);
    case 'u32le': return dv.getUint32(0, true);
    case 'u32be': return dv.getUint32(0, false);
    case 's32le': return dv.getInt32(0, true);
    case 's32be': return dv.getInt32(0, false);
    case 'f32le': return dv.getFloat32(0, true);
    case 'f32be': return dv.getFloat32(0, false);
    default: return null;
  }
};

/** J1939 marca «no disponible» con todos los bits a uno. */
export const NO_DISPONIBLE_32 = 0xffffffff;
export const NO_DISPONIBLE_16 = 0xffff;
export const NO_DISPONIBLE_8 = 0xff;

/* ── Sumas de verificacion ────────────────────────────────────────────────── */

/**
 * CRC16 de Modbus RTU (polinomio 0xA001).
 *
 * En la trama viaja **con el byte bajo primero**. Comprobado contra los
 * vectores de siempre:
 *   01 03 00 00 00 0A → C5 CD
 *   01 04 02 FF FF    → B8 80
 *   11 03 00 6B 00 03 → 76 87
 */
export const crc16Modbus = (b: Uint8Array, largo = b.length): number => {
  let crc = 0xffff;
  for (let i = 0; i < largo; i += 1) {
    crc ^= b[i];
    for (let j = 0; j < 8; j += 1) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc & 0xffff;
};

/** CRC8 de Eurosens DDS, tal cual esta en el edge y en el plugin de Java. */
export const crc8Eurosens = (b: Uint8Array, largo = b.length): number => {
  let crc = 0;
  for (let k = 0; k < largo; k += 1) {
    const i = (b[k] ^ crc) & 0xff;
    crc = 0;
    if (i & 0x01) crc ^= 0x5e;
    if (i & 0x02) crc ^= 0xbc;
    if (i & 0x04) crc ^= 0x61;
    if (i & 0x08) crc ^= 0xc2;
    if (i & 0x10) crc ^= 0x9d;
    if (i & 0x20) crc ^= 0x23;
    if (i & 0x40) crc ^= 0x46;
    if (i & 0x80) crc ^= 0x8c;
  }
  return crc & 0xff;
};

/* ── J1939 ────────────────────────────────────────────────────────────────── */

/* 29 bits: prioridad(3) EDP(1) DP(1) PF(8) PS(8) SA(8). */
export const pgnDe = (id: number): number => (id >>> 8) & 0x3ffff;
export const saDe = (id: number): number => id & 0xff;
