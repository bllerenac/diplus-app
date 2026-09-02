/**
 * Puente con el plugin nativo.
 *
 * El reparto es deliberado: **Java transporta y TypeScript interpreta**. El
 * plugin entrega bytes en crudo y aqui se trocean y se traducen segun el
 * protocolo que el usuario haya elegido. Asi se puede dar soporte a un aparato
 * nuevo sin recompilar el APK, que es justo lo que antes obligaba a hacer tener
 * las cabeceras escritas a fuego en el codigo nativo.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { Senal, pgnDe, saDe } from './lecturas';
import { Contexto, protocolo } from './protocolos';
import { Troceador, aHex, deHex, troceador } from './tramas';

export type Puerto = 'rs485' | 'can1' | 'can2';

export interface Fuente {
  id: string;
  nombre: string;
  puerto: Puerto;
  /** Ruta del device para serie; se ignora en CAN. */
  ruta: string;
  baudios: number;
  /** Bitrate del bus, solo CAN. */
  bitrate: number;
  protocoloId: string;
  config: Record<string, any>;
  activa: boolean;
}

export interface TramaVista {
  n: number;
  fuenteId: string;
  puerto: string;
  hex: string;
  /** Solo CAN. */
  id?: string;
  pgn?: number;
  sa?: number;
  senales: Senal[];
  at: number;
}

export interface ProblemaPuerto {
  port: string;
  source: string;
  message: string;
  timestamp: number;
}

interface NativoCan {
  id: string;
  rawId: number;
  dlc: number;
  ff: number;
  rtr: number;
  raw: string;
  timestamp: number;
  port: string;
}

interface NativoSerie {
  raw: string;
  bytes: number;
  timestamp: number;
  port: string;
}

export interface PluginNativo {
  setPortBaudrate(o: { devicePath: string; baudrate: number }): Promise<any>;
  startGpsListener(o: { devicePath: string }): Promise<any>;
  startCan1Listener(o: { baudrate?: number; serialBaudrate?: number }): Promise<any>;
  startCan2Listener(o: { baudrate?: number; serialBaudrate?: number }): Promise<any>;
  startRs485Listener(o: { devicePath: string; baudrate?: number }): Promise<any>;
  sendRawBytes(o: { devicePath: string; hexData: string }): Promise<any>;
  sendModbusQuery(o: {
    devicePath: string; address: number; functionCode?: number;
    startRegister?: number; registerCount?: number;
  }): Promise<any>;
  sendEurosensQuery(o: { devicePath: string; address: number; command?: number }): Promise<any>;
  addListener(evento: string, fn: (d: any) => void): Promise<any>;
}

const Nativo = registerPlugin<PluginNativo>('CanRs485');

export const hayHardware = (): boolean => Capacitor.isNativePlatform();

type OyenteTramas = (t: TramaVista) => void;
type OyenteProblemas = (p: ProblemaPuerto) => void;

/** Tope de la consola: sin el, una sesion larga se come la memoria del equipo. */
const MAX_TRAMAS = 300;

class Hardware {
  private fuentes = new Map<string, Fuente>();
  private troceadores = new Map<string, Troceador>();
  private oyentesTrama = new Set<OyenteTramas>();
  private oyentesProblema = new Set<OyenteProblemas>();
  private ultimas: TramaVista[] = [];
  private valores = new Map<string, Senal>();
  private contador = 0;
  private enganchado = false;
  private temporizador: any = null;

  /** Se engancha una sola vez, aunque se arranquen varias fuentes. */
  private async enganchar() {
    if (this.enganchado || !hayHardware()) return;
    this.enganchado = true;

    await Nativo.addListener('onRs485Data', (d: NativoSerie) => this.serie('rs485', d));
    await Nativo.addListener('onCan1Data', (d: NativoCan) => this.can('can1', d));
    await Nativo.addListener('onCan2Data', (d: NativoCan) => this.can('can2', d));
    await Nativo.addListener('onPortError', (d: ProblemaPuerto) =>
      this.oyentesProblema.forEach((f) => f(d)),
    );

    /* El troceo por silencio necesita que alguien mire el reloj: si el aparato
       calla justo despues de la ultima trama, sin esto se quedaria sin cerrar. */
    this.temporizador = setInterval(() => {
      for (const [id, tr] of this.troceadores) {
        for (const trozo of tr.vencidos()) this.procesar(id, trozo, {});
      }
    }, 50);
  }

  private troceadorDe(f: Fuente): Troceador {
    let tr = this.troceadores.get(f.id);
    if (!tr) {
      tr = troceador(protocolo(f.protocoloId).troceo);
      this.troceadores.set(f.id, tr);
    }
    return tr;
  }

  private serie(puerto: Puerto, d: NativoSerie) {
    const bytes = deHex(d.raw);
    for (const f of this.fuentes.values()) {
      if (!f.activa || f.puerto !== puerto) continue;
      for (const trozo of this.troceadorDe(f).empujar(bytes)) this.procesar(f.id, trozo, {});
    }
  }

  private can(puerto: Puerto, d: NativoCan) {
    const bytes = deHex(d.raw);
    /* `ff` es el formato: 1 es identificador extendido de 29 bits, que es el que
       usa J1939. En estandar no hay PGN ni SA que sacar. */
    const extendido = d.ff === 1;
    const ctx: Contexto = extendido
      ? { pgn: pgnDe(d.rawId), sa: saDe(d.rawId) }
      : {};

    for (const f of this.fuentes.values()) {
      if (!f.activa || f.puerto !== puerto) continue;
      this.procesar(f.id, bytes, ctx, d.id);
    }
  }

  private procesar(fuenteId: string, trama: Uint8Array, ctx: Contexto, idCan?: string) {
    const f = this.fuentes.get(fuenteId);
    if (!f || !trama.length) return;

    let senales: Senal[] = [];
    try {
      senales = protocolo(f.protocoloId).decodificar(trama, f.config, ctx);
    } catch (e: any) {
      /* Una trama rara no puede tumbar la lectura: el cable trae lo que trae. */
      senales = [];
    }

    for (const s of senales) this.valores.set(`${f.id}.${s.clave}`, s);

    this.contador += 1;
    const vista: TramaVista = {
      n: this.contador,
      fuenteId: f.id,
      puerto: f.nombre,
      hex: aHex(trama),
      id: idCan,
      pgn: ctx.pgn,
      sa: ctx.sa,
      senales,
      at: Date.now(),
    };

    this.ultimas.push(vista);
    if (this.ultimas.length > MAX_TRAMAS) this.ultimas = this.ultimas.slice(-MAX_TRAMAS);
    this.oyentesTrama.forEach((fn) => fn(vista));
  }

  /* ── API publica ────────────────────────────────────────────────────────── */

  async arrancar(f: Fuente) {
    this.fuentes.set(f.id, f);
    this.troceadores.delete(f.id); // el protocolo pudo cambiar
    if (!f.activa || !hayHardware()) return;

    await this.enganchar();

    if (f.puerto === 'rs485') {
      await Nativo.startRs485Listener({ devicePath: f.ruta, baudrate: f.baudios });
    } else if (f.puerto === 'can1') {
      await Nativo.startCan1Listener({ baudrate: f.bitrate });
    } else {
      await Nativo.startCan2Listener({ baudrate: f.bitrate });
    }
  }

  quitar(id: string) {
    this.fuentes.delete(id);
    this.troceadores.delete(id);
  }

  /** Manda bytes por el puerto: para interrogar a un esclavo Modbus. */
  async enviarHex(ruta: string, hex: string) {
    if (!hayHardware()) throw new Error('Sin hardware: esto solo funciona en el equipo.');
    return Nativo.sendRawBytes({ devicePath: ruta, hexData: hex.replace(/\s/g, '') });
  }

  async consultarModbus(ruta: string, address: number, startRegister: number, registerCount: number, functionCode = 3) {
    if (!hayHardware()) throw new Error('Sin hardware: esto solo funciona en el equipo.');
    return Nativo.sendModbusQuery({ devicePath: ruta, address, functionCode, startRegister, registerCount });
  }

  alRecibir(fn: OyenteTramas): () => void {
    this.oyentesTrama.add(fn);
    return () => {
      this.oyentesTrama.delete(fn);
    };
  }

  alFallar(fn: OyenteProblemas): () => void {
    this.oyentesProblema.add(fn);
    return () => {
      this.oyentesProblema.delete(fn);
    };
  }

  tramas(): TramaVista[] {
    return this.ultimas;
  }

  senales(): Senal[] {
    return [...this.valores.values()];
  }

  limpiar() {
    this.ultimas = [];
    this.valores.clear();
    this.contador = 0;
    for (const tr of this.troceadores.values()) tr.reiniciar();
  }

  parar() {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }
}

export const hardware = new Hardware();
