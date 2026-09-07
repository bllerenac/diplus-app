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
import { Lectura, encolar, leerDesde, pendientes, quitarPendiente } from './base';
import { gps } from './gps';
import { hardware } from './hardware';

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

export interface AjustesEnvio {
  socket: PorSocket;
  api: PorApi;
  /** Con qué nombre se identifica este equipo en lo que manda. */
  equipo: string;
  formato: Formato;
}

export const ENVIO_POR_DEFECTO: AjustesEnvio = {
  socket: { activo: false, url: 'ws://192.168.60.2:9977', cadaSeg: 2 },
  api: {
    activo: false, url: '', token: '', cadaSeg: 30, lote: 200, historico: true,
  },
  equipo: '',
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

/** Un lote de lo guardado. Aquí no cabe `plano`: cada fila tiene su instante. */
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

// ── El que manda ────────────────────────────────────────────────────────────

class Envio {
  private cfg: AjustesEnvio = ENVIO_POR_DEFECTO;

  private ws: WebSocket | null = null;
  private relojSocket: ReturnType<typeof setInterval> | null = null;
  private relojApi: ReturnType<typeof setInterval> | null = null;
  private reintento: ReturnType<typeof setTimeout> | null = null;

  private socket: EstadoCanal = { ...CANAL_PARADO };
  private api: EstadoCanal = { ...CANAL_PARADO };
  private enCola = 0;
  private mandando = false;

  private marca = Number(localStorage.getItem(MARCA)) || 0;

  aplicar(cfg: AjustesEnvio) {
    this.cfg = cfg;
    this.parar();

    if (cfg.socket.activo && cfg.socket.url.trim()) {
      this.socket = {
        ...CANAL_PARADO, enviados: this.socket.enviados, ultimo: this.socket.ultimo,
      };
      this.abrirSocket();
      this.relojSocket = setInterval(
        () => this.porSocket(), Math.max(500, cfg.socket.cadaSeg * 1000),
      );
    }

    if (cfg.api.activo && cfg.api.url.trim()) {
      /* `conectando` y no `parado`: la API no mantiene ninguna conexión, así
         que hasta el primer envío no se sabe nada. Decir «apagado» de algo que
         está encendido y esperando su turno es mentira. */
      this.api = {
        ...CANAL_PARADO,
        estado: 'conectando',
        enviados: this.api.enviados,
        ultimo: this.api.ultimo,
      };
      this.relojApi = setInterval(
        () => this.porApi(), Math.max(5000, cfg.api.cadaSeg * 1000),
      );
    }
  }

  parar() {
    if (this.relojSocket) clearInterval(this.relojSocket);
    if (this.relojApi) clearInterval(this.relojApi);
    if (this.reintento) clearTimeout(this.reintento);
    this.relojSocket = null;
    this.relojApi = null;
    this.reintento = null;
    this.cerrarSocket();
    /* El contador y la hora del ultimo envio sobreviven al apagado: son lo que
       dice si esto llego a funcionar alguna vez, y borrarlos al apagar deja la
       duda de si nunca mando o es que se apago. */
    this.socket = {
      ...CANAL_PARADO, enviados: this.socket.enviados, ultimo: this.socket.ultimo,
    };
  }

  estado() {
    return { socket: { ...this.socket }, api: { ...this.api }, enCola: this.enCola };
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

    try {
      const ws = new WebSocket(this.cfg.socket.url.trim());
      this.ws = ws;
      ws.onopen = () => {
        this.socket = { ...this.socket, estado: 'abierto', error: null };
      };
      ws.onerror = () => {
        /* El navegador no cuenta por qué falló un WebSocket, a propósito: solo
           dice que falló. No hay más detalle que dar. */
        this.socket = { ...this.socket, estado: 'fallo', error: 'no se pudo conectar' };
      };
      ws.onclose = () => {
        this.socket = { ...this.socket, estado: 'fallo' };
        this.ws = null;
        /* Se vuelve a intentar sin prisa. En una cabina el otro lado puede
           estar apagado horas, y machacarlo cada segundo no lo enciende. */
        if (this.relojSocket) {
          this.reintento = setTimeout(() => this.abrirSocket(), 6000);
        }
      };
    } catch (e) {
      this.socket = { ...this.socket, estado: 'fallo', error: dicho(e) };
    }
  }

  private porSocket() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const s = hardware.senalesPara('enviar');
    if (!s.length) return;

    try {
      this.ws.send(JSON.stringify(cuerpoAhora(this.cfg.equipo, this.cfg.formato, s)));
      this.socket = {
        ...this.socket,
        enviados: this.socket.enviados + 1,
        ultimo: Date.now(),
        error: null,
      };
    } catch (e) {
      this.socket = { ...this.socket, error: dicho(e) };
    }
  }

  // ── API ─────────────────────────────────────────────────────────────────

  /**
   * El POST, por el camino nativo cuando lo hay.
   *
   * Con `fetch` esto sale del WebView, y un WebView es un navegador: manda un
   * `OPTIONS` de permiso antes de cada envío y descarta la respuesta si al
   * otro lado no contestan con las cabeceras de CORS. Eso convertiría cada
   * servidor al que se quiera mandar en un servidor que además hay que
   * configurar para un navegador —cuando aquí no hay ninguno—. Se vio en el
   * equipo: dos `OPTIONS` por vuelta y ni un solo `POST`.
   *
   * Por el puente nativo la petición la hace Android y no hay permiso que
   * pedir. `fetch` se queda solo para poder probar esto en un navegador de
   * escritorio, donde no hay puente.
   */
  private async entregar(cuerpo: unknown): Promise<void> {
    const url = this.cfg.api.url.trim();
    const headers = {
      'Content-Type': 'application/json',
      ...(this.cfg.api.token ? { Authorization: `Bearer ${this.cfg.api.token}` } : {}),
    };

    if (Capacitor.isNativePlatform()) {
      const r = await CapacitorHttp.post({ url, headers, data: cuerpo });
      if (r.status < 200 || r.status >= 300) {
        throw new Error(`el servidor respondió ${r.status}`);
      }
      return;
    }

    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(cuerpo) });
    if (!r.ok) throw new Error(`el servidor respondió ${r.status}`);
  }

  /**
   * Una vuelta de la API.
   *
   * Primero lo atrasado y después lo nuevo, siempre en ese orden: al revés, un
   * equipo que estuvo sin cobertura mandaría lo de ahora y dejaría lo viejo al
   * final de una cola que no se vacía nunca, y el histórico quedaría del revés
   * en el servidor.
   */
  async porApi(): Promise<void> {
    /* Una vuelta cada vez. Con la red mala una entrega puede tardar más que el
       periodo, y dos a la vez mandarían el mismo lote dos veces. */
    if (this.mandando) return;
    this.mandando = true;

    try {
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
        /* Lo que no se pudo entregar se guarda, y la marca avanza igual: el
           dato ya no está solo en `lecturas`, está también en la cola, y no
           avanzarla lo mandaría dos veces. */
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
