/**
 * Posicion, de dos fuentes distintas.
 *
 * El equipo tiene dos receptores y no son lo mismo:
 *
 *   RTK      un u-blox aparte, por /dev/ttyHSL2, que da NMEA con calidad de
 *            fix. Con correcciones llega a centimetros.
 *   interno  el GNSS del propio SoC, el que usa Android. Metros, y no hace RTK.
 *
 * La version anterior de esta aplicacion escuchaba las dos; esta solo escuchaba
 * el RTK, asi que si el receptor externo se quedaba sin antena la pantalla se
 * quedaba en blanco aunque el equipo supiera perfectamente donde esta.
 *
 * Ahora manda el RTK y el interno entra como respaldo. **Siempre se dice cual de
 * los dos esta dando la posicion**: un metro y dos centimetros no son la misma
 * informacion y en un mapa se ven exactamente igual.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

export type Origen = 'rtk' | 'interno';

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
  origen: Origen;
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

/** La precision que cabe esperar, para no prometer mas de lo que se tiene. */
export const precisionAproximada = (p: Posicion): string => {
  if (p.origen === 'interno') return p.hdop ? `± ${Math.round(p.hdop)} m` : '± varios m';
  if (p.calidad === 4) return '± 2 cm';
  if (p.calidad === 5) return '± 30 cm';
  if (p.calidad === 2) return '± 1 m';
  if (p.calidad === 1) return `± ${Math.max(2, Math.round(p.hdop * 3))} m`;
  return '—';
};

export const nombreOrigen = (o: Origen) => (o === 'rtk' ? 'receptor RTK' : 'GPS del equipo');

interface PluginGps {
  setPortBaudrate(o: { devicePath: string; baudrate: number }): Promise<unknown>;
  startGpsListener(o: { devicePath: string; baudrate?: number }): Promise<unknown>;
  addListener(evento: string, fn: (d: any) => void): Promise<unknown>;
}

const Nativo = registerPlugin<PluginGps>('CanRs485');

type Oyente = (p: Posicion) => void;

/**
 * Cuanto se espera antes de tirar del respaldo.
 *
 * Si el RTK acaba de dar posicion, la del GPS interno se descarta: es peor y
 * pisarla seria empeorar la lectura. Solo cuando el RTK lleva un rato callado
 * se acepta la otra.
 */
const PACIENCIA_RTK_MS = 20000;

class Gps {
  private oyentes = new Set<Oyente>();
  private ultima: Posicion | null = null;
  private ultimaRtk = 0;
  private enganchado = false;
  private rastro: [number, number][] = [];

  async arrancar(ruta: string, baudios = 921600) {
    if (!Capacitor.isNativePlatform()) return;

    if (!this.enganchado) {
      this.enganchado = true;
      await Nativo.addListener('onGpsData', (d: any) => this.deRtk(d));
      /* El GNSS del propio Android, que el plugin ya publicaba y nadie escuchaba. */
      await Nativo.addListener('onGpsLocationFix', (d: any) => this.deInterno(d));
    }

    /* El puerto se configura antes de leer: si alguien lo dejo a otra velocidad
       llegaria basura en vez de sentencias, y pareceria un receptor roto. */
    try {
      await Nativo.setPortBaudrate({ devicePath: ruta, baudrate: baudios });
    } catch {
      /* si no se puede, se intenta leer con lo que haya */
    }

    await Nativo.startGpsListener({ devicePath: ruta, baudrate: baudios });
  }

  private deRtk(d: any) {
    /* Solo interesan las sentencias que traen posicion; las demas llegan igual. */
    if (typeof d?.latitude !== 'number' || typeof d?.longitude !== 'number') return;
    if (d.latitude === 0 && d.longitude === 0) return;

    this.ultimaRtk = Date.now();
    this.publicar({
      lat: d.latitude,
      lon: d.longitude,
      alt: Number(d.altitude) || 0,
      velocidad: Number(d.speed) || 0,
      rumbo: Number(d.course) || 0,
      hdop: Number(d.hdop) || 99.9,
      satelites: Number(d.satellites) || 0,
      calidad: Number(d.rtkQuality) || 0,
      origen: 'rtk',
      at: Date.now(),
    });
  }

  private deInterno(d: any) {
    if (typeof d?.latitude !== 'number' || typeof d?.longitude !== 'number') return;
    /* Mientras el RTK conteste, el respaldo no pinta nada. */
    if (Date.now() - this.ultimaRtk < PACIENCIA_RTK_MS) return;

    this.publicar({
      lat: d.latitude,
      lon: d.longitude,
      alt: Number(d.altitude) || 0,
      /* En este evento el plugin ya lo pasa a km/h; aqui todo va en m/s. */
      velocidad: (Number(d.speed) || 0) / 3.6,
      rumbo: Number(d.bearing) || 0,
      hdop: Number(d.accuracy) || 0,
      satelites: 0,
      calidad: 1,
      origen: 'interno',
      at: Date.now(),
    });
  }

  /**
   * Posicion de maqueta.
   *
   * Solo la llama el simulador, y la pantalla avisa mientras esta encendido.
   * Sin ese aviso esto seria justo el fallo de la version anterior: unas
   * coordenadas inventadas que en un mapa no se distinguen de las buenas.
   */
  simular(p: Posicion) {
    this.publicar(p);
  }

  private publicar(p: Posicion) {
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
