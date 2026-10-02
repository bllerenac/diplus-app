/**
 * Bluetooth de baja energía (plugin nativo `Bluetooth`).
 *
 * Dos formas de recibir datos: los anuncios del escaneo, que es como mandan
 * sus lecturas la mayoría de los beacons, y las notificaciones GATT de un
 * equipo conectado.
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export interface EstadoBt {
  soportado: boolean;
  encendido: boolean;
  permiso: boolean;
  /** Hasta Android 11 el escaneo no devuelve nada con la ubicación apagada. */
  ubicacionActiva: boolean;
  escaneando: boolean;
  conectado: string | null;
}

export interface Anuncio {
  mac: string;
  nombre: string | null;
  rssi: number;
  at: number;
  conectable?: boolean;
  crudo?: string;
  tx?: number;
  /** Por id de fabricante en hex de 4 cifras. */
  fabricante: Record<string, string>;
  servicios: string[];
  datosServicio: Record<string, string>;
}

export type Propiedad = 'leer' | 'escribir' | 'escribirSinRespuesta' | 'notificar' | 'indicar';
export interface Caracteristica { uuid: string; propiedades: Propiedad[] }
export interface Servicio { uuid: string; caracteristicas: Caracteristica[] }

export interface Dato { mac: string; servicio: string; caracteristica: string; hex: string; at: number }

interface Ruta { servicio: string; caracteristica: string }

interface PluginBluetooth {
  estado(): Promise<EstadoBt>;
  pedirPermisos(): Promise<EstadoBt>;
  encender(): Promise<void>;
  /** `segundos: 0` escanea sin parar. `minMs` limita los avisos por equipo. */
  escanear(o: { segundos: number; minMs?: number; macs?: string[] }): Promise<void>;
  detener(): Promise<void>;
  conectar(o: { mac: string }): Promise<{ mac: string; servicios: Servicio[] }>;
  desconectar(): Promise<void>;
  leer(o: Ruta): Promise<{ hex: string }>;
  escribir(o: Ruta & { hex: string; sinRespuesta?: boolean }): Promise<void>;
  escuchar(o: Ruta): Promise<void>;
  dejarDeEscuchar(o: Ruta): Promise<void>;
  addListener(e: 'dispositivo', fn: (a: Anuncio) => void): Promise<{ remove: () => void }>;
  addListener(e: 'datos', fn: (d: Dato) => void): Promise<{ remove: () => void }>;
  addListener(e: 'conexion', fn: (c: { mac: string; estado: string; codigo: number }) => void): Promise<{ remove: () => void }>;
  addListener(e: 'escaneoTerminado' | 'escaneoFallido', fn: (x: { codigo?: number }) => void): Promise<{ remove: () => void }>;
}

const Nativo = registerPlugin<PluginBluetooth>('Bluetooth');

export const hayBluetooth = () => Capacitor.isNativePlatform();

/** Se suscribe y devuelve con qué soltarlo, sin esperar a la promesa. */
const oir = <T,>(evento: string, fn: (x: T) => void) => {
  const h = (Nativo.addListener as (e: string, f: (x: T) => void) => Promise<{ remove: () => void }>)(evento, fn);
  return () => {
    h.then((x) => x.remove());
  };
};

export const bluetooth = {
  estado: () => Nativo.estado(),
  pedirPermisos: () => Nativo.pedirPermisos(),
  encender: () => Nativo.encender(),
  /** Con `macs`, el filtro lo hace Android y sigue funcionando con la pantalla apagada. */
  escanear: (segundos: number, minMs = 200, macs?: string[]) => Nativo.escanear({ segundos, minMs, macs }),
  detener: () => Nativo.detener(),
  conectar: (mac: string) => Nativo.conectar({ mac }),
  desconectar: () => Nativo.desconectar(),
  leer: (r: Ruta) => Nativo.leer(r),
  escribir: (r: Ruta, hex: string, sinRespuesta = false) => Nativo.escribir({ ...r, hex, sinRespuesta }),
  escuchar: (r: Ruta) => Nativo.escuchar(r),
  dejarDeEscuchar: (r: Ruta) => Nativo.dejarDeEscuchar(r),

  alAnuncio: (fn: (a: Anuncio) => void) => oir('dispositivo', fn),
  alDato: (fn: (d: Dato) => void) => oir('datos', fn),
  alConexion: (fn: (c: { mac: string; estado: string; codigo: number }) => void) => oir('conexion', fn),
  alTerminarEscaneo: (fn: () => void) => oir('escaneoTerminado', fn),
};

/* ── Para leer lo que llega ─────────────────────────────────────────────── */

export const esMac = (t: string) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(t.trim());

/** Los UUID del estándar en su forma de 16 bits: 0x2a19 en vez de los 36 caracteres. */
export const uuidCorto = (uuid: string) => {
  const m = uuid.toLowerCase().match(/^0000([0-9a-f]{4})-0000-1000-8000-00805f9b34fb$/);
  return m ? `0x${m[1]}` : uuid.toLowerCase();
};

const CONOCIDOS: Record<string, string> = {
  '0x1800': 'Acceso genérico',
  '0x1801': 'Atributos genéricos',
  '0x180a': 'Información del equipo',
  '0x180f': 'Batería',
  '0x2a00': 'Nombre',
  '0x2a19': 'Nivel de batería',
  '0x2a24': 'Modelo',
  '0x2a26': 'Firmware',
  '0x2a29': 'Fabricante',
  '0xfeaa': 'Eddystone',
};
export const nombreUuid = (uuid: string) => CONOCIDOS[uuidCorto(uuid)] ?? null;

const FABRICANTES: Record<string, string> = {
  '004c': 'Apple / iBeacon',
  '0059': 'Nordic',
  '0006': 'Microsoft',
  '0075': 'Samsung',
  '0157': 'Huami',
};
export const nombreFabricante = (id: string) => FABRICANTES[id.toLowerCase()] ?? null;

/** Los caracteres imprimibles, para reconocer texto a simple vista. */
export const ascii = (hex: string) =>
  (hex.match(/../g) ?? [])
    .map((b) => parseInt(b, 16))
    .map((c) => (c >= 32 && c < 127 ? String.fromCharCode(c) : '·'))
    .join('');

export interface IBeacon { uuid: string; major: number; minor: number; tx: number }

/** Lo que va tras el id 004c cuando es un iBeacon: 02 15, UUID, major, minor, potencia. */
export const leerIBeacon = (hex: string): IBeacon | null => {
  const h = hex.toLowerCase();
  if (!h.startsWith('0215') || h.length < 46) return null;
  const u = h.slice(4, 36);
  const tx = parseInt(h.slice(44, 46), 16);
  return {
    uuid: `${u.slice(0, 8)}-${u.slice(8, 12)}-${u.slice(12, 16)}-${u.slice(16, 20)}-${u.slice(20)}`,
    major: parseInt(h.slice(36, 40), 16),
    minor: parseInt(h.slice(40, 44), 16),
    tx: tx > 127 ? tx - 256 : tx,
  };
};
