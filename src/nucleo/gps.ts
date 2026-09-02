/**
 * GPS con calidad RTK.
 *
 * El indicador que importa es el de calidad de la sentencia GGA, no el numero
 * de satelites: con RTK fijo la posicion vale centimetros y con GPS suelto vale
 * metros. Confundirlos en una pantalla de navegacion es hacer creer que se sabe
 * donde esta la maquina con una precision que no se tiene.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

export interface Posicion {
  lat: number;
  lon: number;
  alt: number;
  velocidad: number;
  rumbo: number;
  hdop: number;
  satelites: number;
  /** 0 sin fijar · 1 GPS · 2 DGPS · 4 RTK fijo · 5 RTK flotante */
  calidad: number;
  at: number;
}

export const CALIDADES: Record<number, { nombre: string; corto: string; tono: 'ok' | 'warn' | 'bad' }> = {
  0: { nombre: 'Sin señal', corto: 'SIN FIX', tono: 'bad' },
  1: { nombre: 'GPS autónomo', corto: 'GPS', tono: 'warn' },
  2: { nombre: 'DGPS', corto: 'DGPS', tono: 'warn' },
  3: { nombre: 'PPS', corto: 'PPS', tono: 'warn' },
  4: { nombre: 'RTK fijo', corto: 'RTK FIJO', tono: 'ok' },
  5: { nombre: 'RTK flotante', corto: 'RTK FLOT', tono: 'warn' },
  6: { nombre: 'Estimada', corto: 'ESTIM', tono: 'bad' },
};

export const calidad = (n: number) => CALIDADES[n] ?? CALIDADES[0];

/** La precisión que cabe esperar, para no prometer más de lo que se tiene. */
export const precisionAproximada = (c: number, hdop: number): string => {
  if (c === 4) return '± 2 cm';
  if (c === 5) return '± 30 cm';
  if (c === 2) return '± 1 m';
  if (c === 1) return `± ${Math.max(2, Math.round(hdop * 3))} m`;
  return '—';
};

interface PluginGps {
  startGpsListener(o: { devicePath: string }): Promise<any>;
  addListener(evento: string, fn: (d: any) => void): Promise<any>;
}

const Nativo = registerPlugin<PluginGps>('CanRs485');

type Oyente = (p: Posicion) => void;

class Gps {
  private oyentes = new Set<Oyente>();
  private ultima: Posicion | null = null;
  private enganchado = false;
  /** Últimos puntos, para pintar por dónde ha ido. */
  private rastro: [number, number][] = [];

  async arrancar(ruta: string) {
    if (!Capacitor.isNativePlatform()) return;

    if (!this.enganchado) {
      this.enganchado = true;
      await Nativo.addListener('onGpsData', (d: any) => this.recibir(d));
    }
    await Nativo.startGpsListener({ devicePath: ruta });
  }

  private recibir(d: any) {
    /* Solo interesa la sentencia que trae posición; las demás llegan igual. */
    if (typeof d?.latitude !== 'number' || typeof d?.longitude !== 'number') return;
    if (d.latitude === 0 && d.longitude === 0) return;

    const p: Posicion = {
      lat: d.latitude,
      lon: d.longitude,
      alt: Number(d.altitude) || 0,
      velocidad: Number(d.speed) || 0,
      rumbo: Number(d.course) || 0,
      hdop: Number(d.hdop) || 99.9,
      satelites: Number(d.satellites) || 0,
      calidad: Number(d.rtkQuality) || 0,
      at: Date.now(),
    };

    this.ultima = p;
    this.rastro.push([p.lat, p.lon]);
    if (this.rastro.length > 500) this.rastro = this.rastro.slice(-500);
    this.oyentes.forEach((f) => f(p));
  }

  alMoverse(fn: Oyente): () => void {
    this.oyentes.add(fn);
    return () => {
      this.oyentes.delete(fn);
    };
  }

  posicion(): Posicion | null {
    return this.ultima;
  }

  camino(): [number, number][] {
    return this.rastro;
  }
}

export const gps = new Gps();
