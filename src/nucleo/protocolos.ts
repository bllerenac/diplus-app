/**
 * Catalogo de protocolos.
 *
 * Un protocolo declara **que configuracion necesita** y **como saca señales de
 * una trama**. La pantalla dibuja el formulario a partir de `campos`, asi que
 * añadir un protocolo es añadir una entrada aqui y no tocar ninguna vista.
 *
 * Es el mismo trato que el HelperBox le da a sus tipos de sensor, y a
 * proposito: los dos leen los mismos aparatos y conviene que quien mire uno
 * reconozca el otro. Lo que en el HelperBox se decide en el equipo, aqui se
 * decide en la aplicacion; el vocabulario no cambia.
 *
 * Nada de esto vive en Java. El plugin nativo solo transporta bytes: quien
 * decide que significan es esta tabla, que el usuario puede ajustar sin
 * recompilar nada.
 */
import {
  NO_DISPONIBLE_16,
  NO_DISPONIBLE_32,
  Senal,
  TIPOS_LECTURA,
  TipoLectura,
  crc16Modbus,
  crc8Eurosens,
  leer,
  senal,
} from './lecturas';
import { aAscii, aHex, aTexto } from './tramas';

export type TipoCampo = 'numero' | 'texto' | 'seleccion' | 'senales';

export interface CampoProtocolo {
  clave: string;
  etiqueta: string;
  tipo: TipoCampo;
  defecto: unknown;
  min?: number;
  max?: number;
  opciones?: string[];
  ayuda?: string;
  /** Se esconde tras «mostrar avanzado»: son los del manual del fabricante. */
  avanzado?: boolean;
}

/** Una señal definida a mano sobre una trama cualquiera. */
export interface SenalManual {
  clave: string;
  nombre: string;
  unidad: string;
  desde: number;
  tipo: TipoLectura;
  escala: number | string;
  desplazamiento: number | string;
  min?: number | string;
  max?: number | string;
  /** Solo para CAN: de que PGN sale. Vacio = de cualquiera. */
  pgn?: number | string;
}

export interface Contexto {
  /** Solo en CAN. */
  pgn?: number;
  sa?: number;
}

export interface Protocolo {
  id: string;
  nombre: string;
  descripcion: string;
  /** Por donde llega: un puerto serie o el bus CAN. */
  transporte: 'serie' | 'can';
  /** Como se separan las tramas en el flujo. */
  troceo: 'linea' | 'silencio' | 'largo';
  campos: CampoProtocolo[];
  decodificar(trama: Uint8Array, cfg: Record<string, any>, ctx?: Contexto): Senal[];
}

/** Respeta un 0 puesto a mano; solo cae al defecto si el campo esta vacio. */
const num = (cfg: Record<string, any>, clave: string, defecto: number): number => {
  const v = Number(cfg?.[clave]);
  return Number.isFinite(v) ? v : defecto;
};

/* ── Señales definidas a mano ─────────────────────────────────────────────── */

const CAMPO_SENALES: CampoProtocolo = {
  clave: 'senales',
  etiqueta: 'Señales',
  tipo: 'senales',
  defecto: [],
  ayuda:
    'Cada señal dice en qué byte empieza, con qué tamaño se lee, su escala y su ' +
    'unidad. El valor final es (crudo × escala) + desplazamiento.',
};

const aplicarSenales = (
  trama: Uint8Array,
  cfg: Record<string, any>,
  ctx: Contexto | undefined,
  desplazamientoBase = 0,
): Senal[] => {
  const lista: SenalManual[] = cfg?.senales ?? [];
  const salida: Senal[] = [];

  for (const s of lista) {
    /* En CAN, una señal puede estar atada a un PGN concreto. */
    if (s.pgn !== undefined && s.pgn !== '' && ctx?.pgn !== undefined) {
      if (Number(s.pgn) !== ctx.pgn) continue;
    }

    const crudo = leer(trama, desplazamientoBase + Number(s.desde ?? 0), s.tipo ?? 'u16le');
    if (crudo === null) continue;

    const escala = s.escala === undefined || s.escala === '' ? 1 : Number(s.escala);
    const desp = Number(s.desplazamiento) || 0;
    const valor = crudo * escala + desp;

    const fuera =
      (s.min !== undefined && s.min !== '' && valor < Number(s.min)) ||
      (s.max !== undefined && s.max !== '' && valor > Number(s.max));

    salida.push(senal(s.clave || `b${s.desde}`, s.nombre || s.clave, s.unidad || '', fuera ? null : valor));
  }

  return salida;
};

/* ── Lo que emite el HelperBox ────────────────────────────────────────────── */

/**
 * El puente del HelperBox manda una linea de JSON por vuelta:
 *
 *   {"at":1788301359870,"1.caudal":12.3,"equipo.bus_vivo":1}
 *
 * Las claves son las que se eligieron alli. `at` no es una señal, es la hora.
 */
const helperboxJson: Protocolo = {
  id: 'helperbox-json',
  nombre: 'HelperBox · JSON por línea',
  descripcion:
    'Lo que emite el puente del HelperBox en formato JSON. Se toman todas las ' +
    'claves tal como vengan, así que no hay nada que configurar: si allá se ' +
    'añade una señal, aquí aparece sola.',
  transporte: 'serie',
  troceo: 'linea',
  campos: [],
  decodificar(trama) {
    try {
      const obj = JSON.parse(aTexto(trama));
      if (!obj || typeof obj !== 'object') return [];

      return Object.entries(obj)
        .filter(([k]) => k !== 'at')
        .map(([k, v]) =>
          senal(k, k, '', typeof v === 'number' || typeof v === 'string' ? v : null),
        );
    } catch {
      /* Una linea a medias o basura del cable: se descarta sin ruido. */
      return [];
    }
  },
};

/**
 * El mismo puente, en CSV. Aqui **si** hay que decir que es cada columna,
 * porque la trama no lleva los nombres:
 *
 *   HB;51.092;35.000;0.000
 */
const helperboxCsv: Protocolo = {
  id: 'helperbox-csv',
  nombre: 'HelperBox · CSV por línea',
  descripcion:
    'Valores separados por punto y coma, en el mismo orden en que se eligieron ' +
    'en el HelperBox. Como la trama no trae los nombres, hay que ponerlos aquí.',
  transporte: 'serie',
  troceo: 'linea',
  campos: [
    {
      clave: 'prefijo',
      etiqueta: 'Prefijo de la línea',
      tipo: 'texto',
      defecto: '',
      ayuda: 'Si en el HelperBox se puso uno, se descarta antes de leer los valores.',
    },
    {
      clave: 'columnas',
      etiqueta: 'Nombre de cada columna',
      tipo: 'texto',
      defecto: '',
      ayuda: 'Separados por coma, en orden. Por ejemplo: caudal,memoria,bus_vivo',
    },
    {
      clave: 'separador',
      etiqueta: 'Separador',
      tipo: 'texto',
      defecto: ';',
      avanzado: true,
    },
  ],
  decodificar(trama, cfg) {
    const sep = (cfg.separador as string) || ';';
    let partes = aTexto(trama).trim().split(sep);
    if (!partes.length) return [];

    const prefijo = (cfg.prefijo as string) || '';
    if (prefijo && partes[0] === prefijo) partes = partes.slice(1);

    const nombres = String(cfg.columnas || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    return partes.map((p, i) => {
      const clave = nombres[i] || `col${i + 1}`;
      const v = Number(p);
      return senal(clave, clave, '', p === '' ? null : Number.isFinite(v) ? v : p);
    });
  },
};

/* ── Modbus RTU ───────────────────────────────────────────────────────────── */

/**
 * Respuesta de lectura de registros (funcion 0x03/0x04):
 *
 *   esclavo · funcion · nbytes · datos… · CRC(lo,hi)
 *
 * Sirve tanto para el puente del HelperBox como para un caudalimetro Modbus
 * cualquiera. Nada esta fijado: el esclavo, la funcion, como se agrupan los
 * registros y la escala se ponen aqui.
 *
 * La version vieja de esta aplicacion buscaba literalmente `01 03 08` y una
 * trama de 13 bytes. Con eso, un HelperBox emitiendo con otro esclavo u otro
 * numero de registros no se reconocia.
 */
const modbusRtu: Protocolo = {
  id: 'modbus-rtu',
  nombre: 'Modbus RTU · respuesta de registros',
  descripcion:
    'Respuesta a una lectura de registros. Vale para el puente del HelperBox y ' +
    'para cualquier equipo Modbus. Se comprueba el CRC y se descarta la trama si no cuadra.',
  transporte: 'serie',
  troceo: 'silencio',
  campos: [
    {
      clave: 'esclavo',
      etiqueta: 'Dirección de esclavo',
      tipo: 'numero',
      defecto: 1,
      min: 0,
      max: 247,
      ayuda: 'Con 0 se acepta cualquiera.',
    },
    {
      clave: 'agrupacion',
      etiqueta: 'Cómo se leen los datos',
      tipo: 'seleccion',
      defecto: 'u16',
      opciones: ['u16', 's16', 'u32', 'f32'],
      ayuda:
        'u16: un registro por valor. u32 y f32: dos registros por valor — así es ' +
        'como manda un caudalímetro el caudal y el totalizador en coma flotante.',
    },
    {
      clave: 'escala',
      etiqueta: 'Escala',
      tipo: 'numero',
      defecto: 1,
      ayuda: 'Cada valor se multiplica por esto. En el HelperBox suele ser 0,01.',
    },
    {
      clave: 'columnas',
      etiqueta: 'Nombre de cada valor',
      tipo: 'texto',
      defecto: '',
      ayuda: 'Separados por coma, en orden. Los que falten salen como reg1, reg2…',
    },
    {
      clave: 'exigir_crc',
      etiqueta: 'Exigir CRC correcto',
      tipo: 'seleccion',
      defecto: 'si',
      opciones: ['si', 'no'],
      avanzado: true,
      ayuda: 'Con «no» se acepta la trama aunque el CRC falle. Solo para depurar.',
    },
  ],
  decodificar(trama, cfg) {
    if (trama.length < 5) return [];

    const esclavo = num(cfg, 'esclavo', 1);
    if (esclavo !== 0 && trama[0] !== esclavo) return [];

    const funcion = trama[1];
    if (funcion !== 0x03 && funcion !== 0x04) return [];

    const nBytes = trama[2];
    if (trama.length < 3 + nBytes + 2) return [];

    /* El CRC cubre todo menos sus propios dos bytes, y viaja al reves. */
    const hasta = 3 + nBytes;
    const esperado = crc16Modbus(trama, hasta);
    const recibido = trama[hasta] | (trama[hasta + 1] << 8);
    const crcOk = esperado === recibido;
    if (!crcOk && (cfg.exigir_crc ?? 'si') === 'si') return [];

    const modo = (cfg.agrupacion as string) || 'u16';
    const escala = num(cfg, 'escala', 1);
    const nombres = String(cfg.columnas || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const paso = modo === 'u16' || modo === 's16' ? 2 : 4;
    const tipo: TipoLectura =
      modo === 'u16' ? 'u16be' : modo === 's16' ? 's16be' : modo === 'u32' ? 'u32be' : 'f32be';

    const salida: Senal[] = [];
    for (let i = 0, n = 0; i + paso <= nBytes; i += paso, n += 1) {
      const crudo = leer(trama, 3 + i, tipo);
      const clave = nombres[n] || `reg${n + 1}`;
      salida.push(senal(clave, clave, '', crudo === null ? null : crudo * escala));
    }

    if (!crcOk) salida.push(senal('crc_ok', 'CRC correcto', '', 0));
    return salida;
  },
};

/* ── Eurosens DDS ─────────────────────────────────────────────────────────── */

const eurosens: Protocolo = {
  id: 'eurosens-dds',
  nombre: 'Eurosens DDS',
  descripcion:
    'Respuesta del caudalímetro Eurosens DDS por RS485. Cabecera 0x3E y CRC8 ' +
    'propio del fabricante.',
  transporte: 'serie',
  troceo: 'silencio',
  campos: [
    {
      clave: 'escala',
      etiqueta: 'Escala del valor',
      tipo: 'numero',
      defecto: 1,
      ayuda: 'El crudo son 16 bits; esto lo pasa a la unidad de verdad.',
    },
    {
      clave: 'unidad',
      etiqueta: 'Unidad',
      tipo: 'texto',
      defecto: 'L',
    },
    {
      clave: 'desde',
      etiqueta: 'Byte donde empieza el valor',
      tipo: 'numero',
      defecto: 6,
      avanzado: true,
    },
  ],
  decodificar(trama, cfg) {
    if (trama.length < 9 || trama[0] !== 0x3e) return [];

    const esperado = crc8Eurosens(trama, 8);
    const crcOk = trama[8] === esperado;
    if (!crcOk) return [];

    const crudo = leer(trama, num(cfg, 'desde', 6), 'u16le');
    if (crudo === null) return [];

    return [
      senal('valor', 'Valor', (cfg.unidad as string) || 'L', crudo * num(cfg, 'escala', 1)),
    ];
  },
};

/* ── CAN / J1939 ──────────────────────────────────────────────────────────── */

/**
 * Caudalimetro DFM sobre J1939, con **todas** las constantes del manual como
 * campos configurables.
 *
 * Que sean campos y no numeros incrustados no es capricho: son justo lo que hay
 * que cuadrar contra el equipo de referencia. Si el aparato resulta ser otro
 * modelo, se ajusta aqui sin recompilar el APK.
 */
const PGN_DFM: Record<number, string> = {
  0xf6b7: 'Parámetros del caudalímetro',
  0xf6b5: 'Horas totales de operación',
  0xf6b9: 'Consumo de alta resolución',
  0xf6ba: 'Caudal medio',
  0xf6bf: 'Horas y consumo borrables',
  0xf6c2: 'Ralentí',
  0xf6c3: 'Óptimo',
  0xf6c4: 'Sobrecarga',
  0xf6c5: 'Manipulación',
  0xfeee: 'Temperatura del motor',
  0xfee9: 'Consumo (SAE J1939)',
  0xfd09: 'Consumo alta resolución (SAE)',
  0xf60b: 'Tensión del vehículo',
};

/** Con este desplazamiento, un caudal de cero cae en el «no disponible». */
const AMBIGUO_32 = 0x7fffffff;

const dfm: Protocolo = {
  id: 'dfm-j1939',
  nombre: 'Caudalímetro DFM (J1939)',
  descripcion:
    'Caudalímetro DFM/Technoton sobre CAN a 250 kbit/s. Todas las constantes ' +
    'del manual son editables, porque son las que hay que cuadrar contra el equipo real.',
  transporte: 'can',
  troceo: 'largo',
  campos: [
    { clave: 'sa', etiqueta: 'Origen en el bus (SA)', tipo: 'numero', defecto: 111, min: -1, max: 255,
      ayuda: 'El del DFM es 0x6F = 111. Con −1 se acepta cualquiera.' },
    { clave: 'factor_caudal', etiqueta: 'Factor del caudal', tipo: 'numero', defecto: 1000,
      ayuda: 'El número que hay que cuadrar contra el equipo de referencia.' },
    { clave: 'factor_volumen', etiqueta: 'Factor de los totales', tipo: 'numero', defecto: 1000 },
    { clave: 'caudal_max', etiqueta: 'Caudal máximo creíble', tipo: 'numero', defecto: 5000,
      ayuda: 'Por encima de esto la lectura se descarta.' },
    { clave: 'res_caudal', etiqueta: 'Resolución del caudal', tipo: 'numero', defecto: 0.00001, avanzado: true },
    { clave: 'desplazamiento_caudal', etiqueta: 'Desplazamiento del caudal', tipo: 'numero', defecto: 21474.83647, avanzado: true,
      ayuda: 'Es el que hace que un caudal de cero caiga en el valor reservado para «no disponible».' },
    { clave: 'res_totales', etiqueta: 'Resolución de los totales', tipo: 'numero', defecto: 0.00001, avanzado: true },
    { clave: 'res_alta', etiqueta: 'Resolución de alta precisión', tipo: 'numero', defecto: 0.000001, avanzado: true },
    { clave: 'temp_desplazamiento', etiqueta: 'Desplazamiento de temperatura', tipo: 'numero', defecto: 40, avanzado: true },
    { clave: 'factor_tension', etiqueta: 'Factor de tensión', tipo: 'numero', defecto: 0.05, avanzado: true },
    { clave: 'segundos_por_hora', etiqueta: 'Segundos por hora', tipo: 'numero', defecto: 3600, avanzado: true },
  ],
  decodificar(d, cfg, ctx) {
    const pgn = ctx?.pgn;
    if (pgn === undefined) return [];

    const sa = num(cfg, 'sa', 111);
    if (sa >= 0 && ctx?.sa !== undefined && ctx.sa !== sa) return [];

    const fc = num(cfg, 'factor_caudal', 1000);
    const fv = num(cfg, 'factor_volumen', 1000);
    const tope = num(cfg, 'caudal_max', 5000);
    const resC = num(cfg, 'res_caudal', 0.00001);
    const resT = num(cfg, 'res_totales', 0.00001);
    const resA = num(cfg, 'res_alta', 0.000001);
    const despC = num(cfg, 'desplazamiento_caudal', 21474.83647);
    const porHora = num(cfg, 'segundos_por_hora', 3600) || 3600;

    const u32 = (o: number) => leer(d, o, 'u32le');
    const usable = (v: number | null) => v !== null && v !== NO_DISPONIBLE_32;

    const caudal = (o: number): Senal => {
      const raw = u32(o);
      if (raw === null || raw === NO_DISPONIBLE_32) return senal('caudal', 'Caudal', 'L/h', null);
      if (raw === AMBIGUO_32) {
        return senal('caudal', 'Caudal', 'L/h', null, { ambiguo: true });
      }
      const v = (raw * resC - despC) * fc;
      return senal('caudal', 'Caudal', 'L/h', v < 0 || v > tope ? null : v);
    };

    const litros = (o: number, res: number, clave: string, nombre: string): Senal => {
      const raw = u32(o);
      return senal(clave, nombre, 'L', usable(raw) ? (raw as number) * res * fv : null);
    };

    const horas = (o: number, clave: string, nombre: string): Senal => {
      const raw = u32(o);
      return senal(clave, nombre, 'h', usable(raw) ? (raw as number) / porHora : null);
    };

    switch (pgn) {
      case 0xf6b7: return [caudal(0)];
      case 0xf6ba: {
        const s = caudal(0);
        return [senal('caudal_medio', 'Caudal medio', 'L/h', s.valor)];
      }
      case 0xf6b5: return [litros(0, resT, 'total', 'Total consumido'), horas(4, 'horas_motor', 'Horas de motor')];
      case 0xf6b9: return [litros(0, resA, 'viaje', 'Consumo del viaje'), litros(4, resA, 'total_alta', 'Total alta resolución')];
      case 0xf6bf: return [litros(0, resT, 'borrable', 'Consumo borrable'), horas(4, 'borrable_horas', 'Horas borrables')];
      case 0xf6c2: return [litros(0, resT, 'ralenti', 'Consumo en ralentí'), horas(4, 'ralenti_horas', 'Horas en ralentí')];
      case 0xf6c3: return [litros(0, resT, 'optimo', 'Consumo en óptimo'), horas(4, 'optimo_horas', 'Horas en óptimo')];
      case 0xf6c4: return [litros(0, resT, 'sobrecarga', 'Consumo en sobrecarga'), horas(4, 'sobrecarga_horas', 'Horas en sobrecarga')];
      case 0xf6c5: return [litros(0, resT, 'manipulacion', 'Consumo en manipulación'), horas(4, 'manipulacion_horas', 'Horas en manipulación')];
      case 0xfeee: {
        const b = leer(d, 1, 'u8');
        const t = b === null || b === 0xff ? null : b - num(cfg, 'temp_desplazamiento', 40);
        return [senal('temperatura', 'Temperatura', '°C', t === null || t < -40 || t > 150 ? null : t)];
      }
      case 0xf60b: {
        const v = leer(d, 0, 'u16le');
        const volt = v === null || v === NO_DISPONIBLE_16 ? null : v * num(cfg, 'factor_tension', 0.05);
        return [senal('tension', 'Tensión', 'V', volt === null || volt <= 0 || volt > 60 ? null : volt)];
      }
      default: return [];
    }
  },
};

/** CAN sin interpretar: señales definidas a mano sobre el PGN que sea. */
const canManual: Protocolo = {
  id: 'can-manual',
  nombre: 'CAN · señales a mano',
  descripcion:
    'Para cualquier aparato del bus que aún no tenga protocolo propio. Se mira ' +
    'en el monitor qué PGN manda y con qué bytes, y se describe aquí.',
  transporte: 'can',
  troceo: 'largo',
  campos: [
    { clave: 'sa', etiqueta: 'Origen en el bus (SA)', tipo: 'numero', defecto: -1, min: -1, max: 255,
      ayuda: 'Con −1 se acepta cualquiera.' },
    CAMPO_SENALES,
  ],
  decodificar(trama, cfg, ctx) {
    const sa = num(cfg, 'sa', -1);
    if (sa >= 0 && ctx?.sa !== undefined && ctx.sa !== sa) return [];
    return aplicarSenales(trama, cfg, ctx);
  },
};

/* ── Crudo ────────────────────────────────────────────────────────────────── */

const crudo: Protocolo = {
  id: 'crudo',
  nombre: 'Sin interpretar',
  descripcion:
    'No traduce nada: enseña la trama en hexadecimal y en texto. Es con lo que ' +
    'se empieza cuando no se sabe todavía qué hay al otro lado del cable.',
  transporte: 'serie',
  troceo: 'silencio',
  campos: [CAMPO_SENALES],
  decodificar(trama, cfg, ctx) {
    const manuales = aplicarSenales(trama, cfg, ctx);
    if (manuales.length) return manuales;

    return [
      senal('hex', 'Trama', '', aHex(trama)),
      senal('ascii', 'Texto', '', aAscii(trama)),
    ];
  },
};

/* ── Catalogo ─────────────────────────────────────────────────────────────── */

export const PROTOCOLOS: Protocolo[] = [
  helperboxJson,
  helperboxCsv,
  modbusRtu,
  eurosens,
  crudo,
  dfm,
  canManual,
];

export const protocolo = (id: string): Protocolo =>
  PROTOCOLOS.find((p) => p.id === id) ?? crudo;

export const protocolosDe = (transporte: 'serie' | 'can'): Protocolo[] =>
  PROTOCOLOS.filter((p) => p.transporte === transporte);

export const nombrePgn = (pgn: number): string | null => PGN_DFM[pgn] ?? null;

export const defectosDe = (p: Protocolo): Record<string, unknown> =>
  Object.fromEntries(p.campos.map((c) => [c.clave, c.defecto]));

export { TIPOS_LECTURA };
export type { Senal, TipoLectura };
