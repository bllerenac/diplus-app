/**
 * Lo que sale del equipo hacia fuera, y por dónde.
 *
 * Son dos caminos distintos y no uno con dos ajustes, porque sirven para dos
 * cosas que no se parecen:
 *
 * **Por socket** va lo de ahora mismo, sin memoria. Es para quien está mirando
 * en directo —un tablero, otro equipo en la cabina, una prueba— y para eso lo
 * que importa es que llegue pronto, no que llegue todo: si se pierde una
 * lectura, la siguiente viene en unos segundos y la vieja ya no le interesaba
 * a nadie.
 *
 * **Por API** va el histórico, y ahí la regla es la contraria: no se puede
 * perder nada. En mina la cobertura va y viene, así que se manda lo que hay
 * guardado en el equipo, por lotes, con una marca de por dónde iba; lo que no
 * se pudo entregar se queda en la cola y se reintenta. Perder cobertura media
 * hora no puede costar media hora de datos.
 *
 * Qué señales salen no se decide aquí: se decide señal por señal, en su
 * detalle, con «Mandar hacia fuera». Aquí solo se dice a dónde van, cada
 * cuánto y con qué forma.
 */
import { CapacitorHttp, Capacitor } from '@capacitor/core';
import {
  Lectura,
  encolar,
  leerDesde,
  pendientes,
  quitarPendiente,
  guardarSnapshot,
  leerSnapshotsPendientes,
  marcarSnapshotsEnviados,
} from './base';
import { gps } from './gps';
import { hardware } from './hardware';
import { mqtt, hayMqtt } from './mqtt';

export interface LogEnvio {
  id: number;
  at: number;
  canal: 'mqtt' | 'api' | 'socket';
  tipo: 'ok' | 'error' | 'info';
  mensaje: string;
  detalles?: string;
}

const MAX_LOGS = 100;
let logsContador = 0;
const logsMemoria: LogEnvio[] = [];
type LogListener = (logs: LogEnvio[]) => void;
const logListeners = new Set<LogListener>();

export const agregarLogEnvio = (
  canal: LogEnvio['canal'],
  tipo: LogEnvio['tipo'],
  mensaje: string,
  detalles?: string,
) => {
  const item: LogEnvio = {
    id: ++logsContador,
    at: Date.now(),
    canal,
    tipo,
    mensaje,
    detalles,
  };
  logsMemoria.unshift(item);
  if (logsMemoria.length > MAX_LOGS) logsMemoria.pop();
  logListeners.forEach((fn) => fn([...logsMemoria]));
};

export const obtenerLogsEnvio = (): LogEnvio[] => [...logsMemoria];

export const alLogsEnvio = (fn: LogListener): (() => void) => {
  logListeners.add(fn);
  return () => {
    logListeners.delete(fn);
  };
};

export const limpiarLogsEnvio = () => {
  logsMemoria.length = 0;
  logListeners.forEach((fn) => fn([]));
};

/** Cómo se arma el JSON. Ninguno es mejor: depende de quién lo reciba. */
export type Formato = 'plano' | 'lista';

export interface PorSocket {
  activo: boolean;
  /** `ws://maquina:puerto`. Con `wss://` si el otro lado lleva certificado. */
  url: string;
  cadaSeg: number;
}

export interface PorApi {
  activo: boolean;
  url: string;
  token: string;
  cadaSeg: number;
  /** Cuántas lecturas van como mucho en cada envío. */
  lote: number;
  /**
   * Manda lo guardado desde la última vez, no solo el valor del momento.
   *
   * Apagado, la API se comporta como el socket y solo manda la foto de ahora.
   * Tiene sentido si al otro lado solo quieren el último valor y no un
   * historial, pero entonces un corte de red sí pierde datos.
   */
  historico: boolean;
}

export interface PorMqtt {
  activo: boolean;
  /** Solo el hostname o IP, sin tcp://. Ej: paranoid.lat */
  broker: string;
  puerto: number;
  usuario: string;
  contrasena: string;
  /** Topic donde publica. {{unit_id}} se reemplaza por el nombre del equipo. */
  topic: string;
  cadaSeg: number;
  /** Mapeo explícito de señales Ethernet (RJ45/TCP) para el payload Miskimayo */
  claveInputFlow?: string;
  claveOutputFlow?: string;
  claveSensorNivel?: string;
  claveTotalizadorInput?: string;
  claveTotalizadorOutput?: string;
}

export interface AjustesEnvio {
  socket: PorSocket;
  api: PorApi;
  mqtt: PorMqtt;
  /** Con qué nombre se identifica este equipo en lo que manda. */
  equipo: string;
  formato: Formato;
}

export const ENVIO_POR_DEFECTO: AjustesEnvio = {
  socket: { activo: false, url: 'ws://192.168.60.2:9977', cadaSeg: 2 },
  api: {
    activo: true,
    url: 'https://miskimayo-back.wapsi.io/api/tracing/{{unit_id}}',
    token: '', cadaSeg: 10, lote: 100, historico: true,
  },
  mqtt: {
    activo: true,
    broker: 'paranoid.lat',
    puerto: 1883,
    usuario: 'test',
    contrasena: 'test1234',
    topic: '/miskimayo/diplus/{{unit_id}}',
    cadaSeg: 5,
  },
  equipo: 'SC-03',
  formato: 'lista',
};

/** Hasta dónde se mandó ya del histórico. Sobrevive a un reinicio a propósito. */
const MARCA = 'diplus.envio.marca';

/* Reintentos de la cola por vuelta. Pocos: si hay mil pendientes y se sueltan
   todos de golpe, la primera vez que vuelve la cobertura se atraganta la red
   del camión justo cuando hace falta para otras cosas. */
const POR_VUELTA = 5;

export interface EstadoCanal {
  /** `abierto` solo lo usa el socket; la API va y viene en cada envío. */
  estado: 'parado' | 'conectando' | 'abierto' | 'fallo';
  enviados: number;
  ultimo: number | null;
  error: string | null;
}

const CANAL_PARADO: EstadoCanal = { estado: 'parado', enviados: 0, ultimo: null, error: null };

const dicho = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ── La forma del JSON ───────────────────────────────────────────────────────

/**
 * La foto de ahora.
 *
 * `plano` es un objeto de clave a valor, que es lo cómodo si al otro lado
 * hay una base con una columna por señal. `lista` lleva además el nombre y la
 * unidad de cada una, que es lo que hace falta si quien recibe no sabe de
 * antemano qué señales existen —el caso normal cuando se enchufa un sensor
 * nuevo y nadie ha tocado el servidor—.
 */
export const cuerpoAhora = (
  equipo: string,
  formato: Formato,
  senales: { clave: string; senal: { nombre: string; unidad: string; valor: unknown } }[],
): Record<string, unknown> => {
  const p = gps.posicion();
  const cabecera = {
    equipo,
    at: Date.now(),
    ...(p ? { lat: p.lat, lon: p.lon } : {}),
  };

  if (formato === 'plano') {
    const valores: Record<string, unknown> = {};
    for (const { clave, senal } of senales) valores[clave] = senal.valor;
    return { ...cabecera, valores };
  }

  return {
    ...cabecera,
    lecturas: senales.map(({ clave, senal }) => ({
      clave,
      nombre: senal.nombre,
      unidad: senal.unidad,
      valor: senal.valor,
    })),
  };
};

export const cuerpoHistorico = (equipo: string, filas: Lectura[]): Record<string, unknown> => ({
  equipo,
  at: Date.now(),
  desde: filas.length ? filas[0].at : null,
  hasta: filas.length ? filas[filas.length - 1].at : null,
  lecturas: filas.map((f) => ({
    clave: f.clave,
    valor: f.valor,
    texto: f.texto,
    at: f.at,
    ...(f.lat === undefined ? {} : { lat: f.lat, lon: f.lon }),
  })),
});

/**
 * Payload MQTT con el modelo especifico de Miskimayo.
 *
 * Busca los sensores por nombre (no por clave) para ser robusto frente a
 * cambios de configuracion: si se recablea el sensor a otro puerto, el nombre
 * sigue siendo el mismo y el campo sigue llegando con el valor correcto.
 *
 * Los campos calculados:
 *   caudalFlow = max(inputFlow - outputFlow, 0)
 *   netTotalized = max(totalizedInput - totalizedOutput, 0)
 *
 * Los campos de IMU vienen del modulo de movimiento del propio equipo.
 */
export const cuerpoMqtt = (
  equipo: string,
  topic: string,
  cfgMqtt?: PorMqtt,
): { topic: string; payload: string } => {
  const pos = gps.posicion();
  const senales = hardware.senalesPorClave();

  /* Busca por clave exacta si fue seleccionada, o por terminos de nombre/clave como fallback. */
  const porClaveONombre = (claveDeseada?: string, ...terminos: string[]): number | null => {
    if (claveDeseada) {
      const match = senales.find(([k]) => k === claveDeseada);
      if (match && typeof match[1].valor === 'number') return match[1].valor;
    }
    if (terminos.length > 0) {
      for (const [k, s] of senales) {
        const texto = `${k} ${s.nombre}`.toLowerCase();
        if (terminos.every((t) => texto.includes(t.toLowerCase())) && typeof s.valor === 'number') {
          return s.valor as number;
        }
      }
    }
    return null;
  };

  const inputFlow = porClaveONombre(cfgMqtt?.claveInputFlow, 'ingreso')
    ?? (typeof hardware.senalesPara('enviar')[0]?.senal?.valor === 'number' ? hardware.senalesPara('enviar')[0].senal.valor as number : null);

  const outputFlow = porClaveONombre(cfgMqtt?.claveOutputFlow, 'retorno');

  const caudalFlow = inputFlow !== null && outputFlow !== null
    ? Math.max(0, inputFlow - outputFlow)
    : (inputFlow !== null ? inputFlow : null);

  const sensorVol = porClaveONombre(cfgMqtt?.claveSensorNivel, 'nivel');

  /* Totalizadores */
  const totInput  = porClaveONombre(cfgMqtt?.claveTotalizadorInput, 'totaliz', 'ingreso')
    ?? porClaveONombre(undefined, 'totaliz');
  const totOutput = porClaveONombre(cfgMqtt?.claveTotalizadorOutput, 'totaliz', 'retorno')
    ?? porClaveONombre(undefined, 'tot_retorno');

  const netTotalizedNum = totInput !== null && totOutput !== null
    ? Math.max(0, totInput - totOutput)
    : (totInput !== null ? totInput : null);

  /* IMU: el hardware las inyecta como señales con clave 'imu.*'. */
  const imuPitch   = porClaveONombre(undefined, 'inclinaci');
  const imuRoll    = porClaveONombre(undefined, 'giro');
  const imuHeading = null;  /* No disponible en este hardware */

  const unitId = equipo || 'SC-03';
  const topicReal = topic.replace('{{unit_id}}', unitId);

  const payload = {
    unit:            unitId,
    speed:           pos?.velocidad ?? 0,
    lat:             pos?.lat       ?? 0,
    lon:             pos?.lon       ?? 0,
    timestamp:       new Date().toISOString(),
    caudalFlow:      caudalFlow     ?? 0,
    inputFlow:       inputFlow      ?? 0,
    outputFlow:      outputFlow     ?? 0,
    sensorVolume:    sensorVol      ?? 0,
    sensorLevel:     sensorVol      ?? 0,
    fuelMotor:       netTotalizedNum ?? 0,
    rawValue:        inputFlow      ?? 0,
    totalized:       netTotalizedNum ?? 0,
    totalizedInput:  totInput       ?? 0,
    totalizedOutput: totOutput      ?? 0,
    gpsAlt:          pos?.alt       ?? 0,
    pitch:           imuPitch       ?? 0,
    roll:            imuRoll        ?? 0,
    heading:         imuHeading     ?? 0,
  };

  return { topic: topicReal, payload: JSON.stringify(payload) };
};


// ── El que manda ────────────────────────────────────────────────────────────

class Envio {
  private cfg: AjustesEnvio = ENVIO_POR_DEFECTO;

  private ws: WebSocket | null = null;
  private relojSocket: ReturnType<typeof setInterval> | null = null;
  private relojApi: ReturnType<typeof setInterval> | null = null;
  private relojMqtt: ReturnType<typeof setInterval> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;

  private socket: EstadoCanal = { ...CANAL_PARADO };
  private api: EstadoCanal = { ...CANAL_PARADO };
  private mqttCh: EstadoCanal = { ...CANAL_PARADO };
  private enCola = 0;
  private mandando = false;

  private marca = Number(localStorage.getItem(MARCA)) || 0;

  aplicar(cfg: AjustesEnvio) {
    const socketCambio = JSON.stringify(cfg.socket) !== JSON.stringify(this.cfg.socket);
    const apiCambio = JSON.stringify(cfg.api) !== JSON.stringify(this.cfg.api);
    const mqttCambio =
      JSON.stringify(cfg.mqtt) !== JSON.stringify(this.cfg.mqtt) || cfg.equipo !== this.cfg.equipo;

    const primeraVez = !this.relojMqtt && !this.relojApi && !this.relojSocket;

    this.cfg = cfg;

    // 1. Socket
    if (socketCambio || primeraVez) {
      if (this.relojSocket) clearInterval(this.relojSocket);
      this.relojSocket = null;
      this.cerrarSocket();
      if (cfg.socket.activo && cfg.socket.url.trim()) {
        this.socket = {
          ...CANAL_PARADO, enviados: this.socket.enviados, ultimo: this.socket.ultimo,
        };
        this.abrirSocket();
        this.relojSocket = setInterval(
          () => this.porSocket(), Math.max(500, cfg.socket.cadaSeg * 1000),
        );
      } else {
        this.socket = { ...CANAL_PARADO };
      }
    }

    // 2. API
    if (apiCambio || primeraVez) {
      if (this.relojApi) clearInterval(this.relojApi);
      this.relojApi = null;
      if (cfg.api.activo && cfg.api.url.trim()) {
        this.api = {
          ...CANAL_PARADO,
          estado: 'conectando',
          enviados: this.api.enviados,
          ultimo: this.api.ultimo,
        };
        this.relojApi = setInterval(
          () => this.porApi(), Math.max(2000, cfg.api.cadaSeg * 1000),
        );
      } else {
        this.api = { ...CANAL_PARADO };
      }
    }

    // 3. MQTT
    if (mqttCambio || primeraVez) {
      if (this.relojMqtt) clearInterval(this.relojMqtt);
      this.relojMqtt = null;

      if (cfg.mqtt.activo && cfg.mqtt.broker.trim() && hayMqtt()) {
        this.mqttCh = { ...CANAL_PARADO, estado: 'conectando' };
        mqtt.conectar({
          broker: cfg.mqtt.broker.trim(),
          puerto: cfg.mqtt.puerto,
          usuario: cfg.mqtt.usuario,
          clave: cfg.mqtt.contrasena,
          clientId: `diplus-${cfg.equipo || 'tablet'}`,
        }).then(() => {
          this.mqttCh = { ...this.mqttCh, estado: 'abierto', error: null };
        }).catch((e: Error) => {
          this.mqttCh = { ...this.mqttCh, estado: 'fallo', error: e.message };
        });
        this.relojMqtt = setInterval(
          () => this.porMqtt(), Math.max(1000, cfg.mqtt.cadaSeg * 1000),
        );
      } else {
        if (hayMqtt()) mqtt.desconectar().catch(() => undefined);
        this.mqttCh = { ...CANAL_PARADO };
      }
    }
  }

  parar() {
    if (this.relojSocket) clearInterval(this.relojSocket);
    if (this.relojApi)    clearInterval(this.relojApi);
    if (this.relojMqtt)   clearInterval(this.relojMqtt);
    if (this.reintento)  clearTimeout(this.reintento);
    this.relojSocket = null;
    this.relojApi    = null;
    this.relojMqtt   = null;
    this.reintento   = null;
    this.cerrarSocket();
    if (hayMqtt()) mqtt.desconectar().catch(() => undefined);
    this.socket  = { ...CANAL_PARADO, enviados: this.socket.enviados,  ultimo: this.socket.ultimo };
    this.mqttCh  = { ...CANAL_PARADO, enviados: this.mqttCh.enviados,  ultimo: this.mqttCh.ultimo };
  }

  estado() {
    return {
      socket:  { ...this.socket },
      api:     { ...this.api },
      mqtt:    { ...this.mqttCh },
      enCola:  this.enCola,
    };
  }

  /** El JSON tal y como saldría ahora mismo, para poder verlo antes de mandarlo. */
  vistaPrevia(): string {
    const s = hardware.senalesPara('enviar');
    if (!s.length) return '';
    return JSON.stringify(cuerpoAhora(this.cfg.equipo, this.cfg.formato, s), null, 2);
  }

  // ── Socket ──────────────────────────────────────────────────────────────

  private cerrarSocket() {
    if (!this.ws) return;
    /* Se le quita el `onclose` antes de cerrar: si no, el cierre a propósito
       dispara la reconexión y el socket vuelve solo después de apagarlo. */
    this.ws.onclose = null;
    this.ws.onerror = null;
    try {
      this.ws.close();
    } catch {
      /* Ya estaba cerrado o a medio abrir: da igual, se suelta igual. */
    }
    this.ws = null;
  }

  private abrirSocket() {
    this.cerrarSocket();
    this.socket = { ...this.socket, estado: 'conectando', error: null };
    agregarLogEnvio('socket', 'info', `Conectando WebSocket a ${this.cfg.socket.url.trim()}`);

    try {
      const ws = new WebSocket(this.cfg.socket.url.trim());
      this.ws = ws;
      ws.onopen = () => {
        this.socket = { ...this.socket, estado: 'abierto', error: null };
        agregarLogEnvio('socket', 'ok', `WebSocket conectado exitosamente a ${this.cfg.socket.url.trim()}`);
      };
      ws.onerror = () => {
        /* El navegador no cuenta por qué falló un WebSocket, a propósito: solo
           dice que falló. No hay más detalle que dar. */
        this.socket = { ...this.socket, estado: 'fallo', error: 'no se pudo conectar' };
        agregarLogEnvio('socket', 'error', `Fallo de conexión WebSocket con ${this.cfg.socket.url.trim()}`);
      };
      ws.onclose = () => {
        this.socket = { ...this.socket, estado: 'fallo' };
        this.ws = null;
        agregarLogEnvio('socket', 'info', `WebSocket desconectado`);
        /* Se vuelve a intentar sin prisa. En una cabina el otro lado puede
           estar apagado horas, y machacarlo cada segundo no lo enciende. */
        if (this.relojSocket) {
          this.reintento = setTimeout(() => this.abrirSocket(), 6000);
        }
      };
    } catch (e) {
      this.socket = { ...this.socket, estado: 'fallo', error: dicho(e) };
      agregarLogEnvio('socket', 'error', `Excepción al abrir WebSocket: ${dicho(e)}`);
    }
  }

  private porSocket() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const s = hardware.senalesPara('enviar');
    if (!s.length) return;

    try {
      const payloadStr = JSON.stringify(cuerpoAhora(this.cfg.equipo, this.cfg.formato, s));
      this.ws.send(payloadStr);
      this.socket = {
        ...this.socket,
        enviados: this.socket.enviados + 1,
        ultimo: Date.now(),
        error: null,
      };
      agregarLogEnvio('socket', 'ok', `Trama enviada por WebSocket`, payloadStr);
    } catch (e) {
      this.socket = { ...this.socket, error: dicho(e) };
      agregarLogEnvio('socket', 'error', `Error al enviar trama WebSocket: ${dicho(e)}`);
    }
  }

  // ── API ─────────────────────────────────────────────────────────────────

  /**
   * El POST, por el camino nativo cuando lo hay.
   */
  private async entregar(cuerpo: unknown): Promise<void> {
    const unitId = this.cfg.equipo || 'SC-03';
    const url = this.cfg.api.url.replace('{{unit_id}}', unitId).trim();
    const headers = {
      'Content-Type': 'application/json',
      ...(this.cfg.api.token ? { Authorization: `Bearer ${this.cfg.api.token}` } : {}),
    };
    const cant = Array.isArray(cuerpo) ? `${cuerpo.length} registros` : '1 registro';
    const strPayload = JSON.stringify(cuerpo, null, 2);
    const snippetPayload = strPayload.length > 800 ? strPayload.substring(0, 800) + '\n...' : strPayload;

    agregarLogEnvio('api', 'info', `POST -> ${url} (${cant})`, snippetPayload);

    if (Capacitor.isNativePlatform()) {
      try {
        const r = await CapacitorHttp.post({ url, headers, data: cuerpo });
        const respDetalle = typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2);
        if (r.status < 200 || r.status >= 300) {
          agregarLogEnvio('api', 'error', `HTTP ${r.status}: Servidor rechazó la petición`, respDetalle || `Status ${r.status}`);
          throw new Error(`el servidor respondió ${r.status}`);
        }
        agregarLogEnvio('api', 'ok', `HTTP ${r.status} OK - Respuesta del Servidor (${cant})`, respDetalle || 'HTTP 200 OK');
        return;
      } catch (e) {
        if ((e as Error).message?.includes('servidor respondió')) throw e;
        agregarLogEnvio('api', 'error', `Error de red POST nativo: ${dicho(e)}`, snippetPayload);
        throw e;
      }
    }

    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
      const textResp = await r.text().catch(() => '');
      if (!r.ok) {
        agregarLogEnvio('api', 'error', `HTTP ${r.status}: ${r.statusText || 'Error'}`, textResp || `Status ${r.status}`);
        throw new Error(`el servidor respondió ${r.status}`);
      }
      agregarLogEnvio('api', 'ok', `HTTP ${r.status} OK - Respuesta del Servidor (${cant})`, textResp || 'HTTP 200 OK');
    } catch (e) {
      if ((e as Error).message?.includes('servidor respondió')) throw e;
      agregarLogEnvio('api', 'error', `Error de red POST fetch: ${dicho(e)}`, snippetPayload);
      throw e;
    }
  }

  /**
   * Una vuelta de la API.
   *
   * 1. Revisa si hay snapshots del formato Miskimayo pendientes en IndexedDB.
   *    Si los hay, manda hasta 100 por POST (un array JSON) a la API.
   * 2. Si no hay snapshots o falla, ejecuta la lógica estándar de envío histórico.
   */
  async porApi(): Promise<void> {
    if (this.mandando) return;
    this.mandando = true;

    try {
      // Intentar primero enviar snapshots históricos de Miskimayo
      const snaps = await leerSnapshotsPendientes(100).catch(() => []);
      if (snaps.length > 0) {
        const ids = snaps.map((s) => s.id!).filter((id) => id !== undefined);
        const loteObjetos = snaps
          .map((s) => {
            try { return JSON.parse(s.datos); } catch { return null; }
          })
          .filter(Boolean);

        if (loteObjetos.length > 0) {
          try {
            await this.entregar(loteObjetos);
            await marcarSnapshotsEnviados(ids);
            this.api = {
              estado: 'abierto',
              enviados: this.api.enviados + loteObjetos.length,
              ultimo: Date.now(),
              error: null,
            };
            return;
          } catch (e) {
            this.api = { ...this.api, estado: 'fallo', error: dicho(e) };
            return;
          }
        }
      }

      await this.soltarCola();

      const filas = this.cfg.api.historico
        ? await leerDesde(this.marca + 1, Math.max(1, this.cfg.api.lote))
        : [];

      if (this.cfg.api.historico && !filas.length) {
        this.api = { ...this.api, error: null };
        return;
      }

      const cuerpo = this.cfg.api.historico
        ? cuerpoHistorico(this.cfg.equipo, filas)
        : cuerpoAhora(this.cfg.equipo, this.cfg.formato, hardware.senalesPara('enviar'));

      try {
        await this.entregar(cuerpo);
        this.api = {
          estado: 'abierto',
          enviados: this.api.enviados + (this.cfg.api.historico ? filas.length : 1),
          ultimo: Date.now(),
          error: null,
        };
        if (filas.length) this.recordar(filas[filas.length - 1].at);
      } catch (e) {
        this.api = { ...this.api, estado: 'fallo', error: dicho(e) };
        await encolar(cuerpo).catch(() => undefined);
        if (filas.length) this.recordar(filas[filas.length - 1].at);
        this.enCola += 1;
      }
    } finally {
      this.mandando = false;
    }
  }

  private recordar(at: number) {
    this.marca = at;
    try {
      localStorage.setItem(MARCA, String(at));
    } catch {
      /* Sin sitio donde apuntarlo se reenviará algo tras un reinicio. Mejor
         repetido que perdido. */
    }
  }

  private async soltarCola(): Promise<void> {
    const cola = await pendientes(POR_VUELTA).catch(() => []);
    this.enCola = cola.length;
    if (!cola.length) return;

    for (const p of cola) {
      try {
        await this.entregar(JSON.parse(p.cuerpo));
        if (p.id !== undefined) await quitarPendiente(p.id);
        this.enCola = Math.max(0, this.enCola - 1);
      } catch {
        /* Sigue sin haber red: se deja la cola como está y se prueba luego. */
        return;
      }
    }
  }

  // ── MQTT ────────────────────────────────────────────────────────────────

  private porMqtt() {
    const { topic } = this.cfg.mqtt;

    const { topic: topicReal, payload } = cuerpoMqtt(this.cfg.equipo, topic, this.cfg.mqtt);

    // Guardar snapshot en BD local para el envío histórico por API
    guardarSnapshot(payload).catch(() => undefined);

    if (!hayMqtt()) {
      agregarLogEnvio('mqtt', 'info', `Snapshot local guardado en BD. MQTT omitido (solo funciona en Android nativo).`, payload);
      return;
    }

    mqtt.publicar(topicReal, payload).then(() => {
      this.mqttCh = {
        ...this.mqttCh,
        estado: 'abierto',
        enviados: this.mqttCh.enviados + 1,
        ultimo: Date.now(),
        error: null,
      };
      agregarLogEnvio('mqtt', 'ok', `Publicado exitosamente en '${topicReal}'`, payload);
    }).catch((e: Error) => {
      this.mqttCh = { ...this.mqttCh, estado: 'fallo', error: e.message };
      agregarLogEnvio('mqtt', 'error', `Fallo al publicar MQTT en '${topicReal}': ${e.message}`, payload);
    });
  }

  /** Prueba el canal MQTT publicando un mensaje ahora mismo. */
  async probarMqtt(): Promise<string> {
    if (!hayMqtt()) return 'MQTT solo funciona en la tablet (no en el navegador).';
    if (!this.cfg.mqtt.broker.trim()) return 'Falta el broker MQTT.';
    const { topic } = this.cfg.mqtt;
    const { topic: topicReal, payload } = cuerpoMqtt(this.cfg.equipo, topic, this.cfg.mqtt);
    try {
      await mqtt.publicar(topicReal, payload);
      this.mqttCh = { ...this.mqttCh, estado: 'abierto', ultimo: Date.now(), error: null };
      agregarLogEnvio('mqtt', 'ok', `Prueba manual publicada en '${topicReal}'`, payload);
      return `Publicado en ${topicReal}.`;
    } catch (e) {
      const msj = `No se pudo publicar: ${e instanceof Error ? e.message : String(e)}`;
      agregarLogEnvio('mqtt', 'error', `Prueba manual MQTT falló en '${topicReal}'`, payload);
      return msj;
    }
  }

  /** Manda una vez, ahora, sin esperar al reloj. Para el botón de probar. */
  async probar(): Promise<string> {
    if (!this.cfg.api.url.trim()) return 'Falta la dirección de la API.';
    try {
      const s = hardware.senalesPara('enviar');
      if (!s.length) return 'No hay ninguna señal marcada para salir.';
      await this.entregar(cuerpoAhora(this.cfg.equipo, this.cfg.formato, s));
      this.api = { ...this.api, estado: 'abierto', ultimo: Date.now(), error: null };
      return 'Entregado. El servidor lo aceptó.';
    } catch (e) {
      this.api = { ...this.api, estado: 'fallo', error: dicho(e) };
      return `No se pudo entregar: ${dicho(e)}`;
    }
  }

  /** Vuelve a mandar todo el histórico guardado desde el principio. */
  reenviarTodo() {
    this.recordar(0);
  }
}

export const envio = new Envio();
