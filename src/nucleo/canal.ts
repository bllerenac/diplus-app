/**
 * El canal remoto, visto desde la aplicacion.
 *
 * El servicio de Java abre el puerto y contesta, pero no sabe nada de sensores
 * ni de configuracion. Asi que la aplicacion le va dejando un resumen de como
 * esta, y el servicio lo sirve tal cual; y lo que se pide de fuera queda en una
 * cola que se recoge aqui.
 *
 * ─── Lo que se publica, y lo que no ──────────────────────────────────────────
 *
 * Va lo que sirve para saber si el equipo trabaja: version, tiempo encendido,
 * fuentes con su estado, ultimas lecturas y posicion. **No van las
 * credenciales del servidor ni el token del propio canal**, aunque esten en la
 * misma configuracion: quien mire por la puerta no tiene por que llevarse las
 * llaves de lo demas.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { Config } from './config';
import { hardware } from './hardware';
import { gps } from './gps';

interface PluginCanal {
  arrancar(o: { puerto: number; token: string }): Promise<{ puerto: number }>;
  parar(): Promise<void>;
  publicar(o: { estado: string }): Promise<void>;
  ordenes(): Promise<{ ordenes: string }>;
}

const Nativo = registerPlugin<PluginCanal>('Canal');

/** Cada cuanto se refresca el resumen y se miran las ordenes. */
const LATIDO_MS = 4000;

/** Cuanto lleva encendida la aplicacion. */
const ARRANQUE = Date.now();

export const hayCanal = () => Capacitor.isNativePlatform();

const resumen = (cfg: Config) => {
  const p = gps.posicion();

  return {
    aplicacion: 'DiPlus',
    encendidaDesdeMin: Math.round((Date.now() - ARRANQUE) / 60000),
    at: new Date().toISOString(),

    fuentes: cfg.fuentes.map((f) => ({
      nombre: f.nombre,
      puerto: f.puerto,
      ruta: f.ruta,
      baudios: f.baudios,
      protocolo: f.protocoloId,
      activa: f.activa,
    })),

    /* Cuantas tramas van y cuando llego la ultima: con eso se sabe de lejos si
       el cable esta dando algo, que es la pregunta de siempre. */
    tramas: hardware.tramas().length,
    ultimaTrama: hardware.tramas().slice(-1)[0]?.at ?? null,

    lecturas: hardware.senales().map((s) => ({
      clave: s.clave,
      nombre: s.nombre,
      unidad: s.unidad,
      valor: s.valor,
    })),

    posicion: p
      ? { lat: p.lat, lon: p.lon, velocidadKmh: Math.round(p.velocidad * 3.6),
          calidad: p.calidad, satelites: p.satelites, origen: p.origen }
      : null,

    /* Se dice si estan puestos, no cuales son. */
    servidor: { direccion: cfg.servidor.url, conCredenciales: Boolean(cfg.servidor.usuario) },
    maqueta: cfg.maqueta,
  };
};

type AlPedir = (orden: string) => void;

class Canal {
  private reloj: ReturnType<typeof setInterval> | null = null;
  private cfg: Config | null = null;
  private alPedir: AlPedir | null = null;

  /**
   * Enciende o apaga el canal segun la configuracion.
   *
   * Sin token no se arranca: una puerta sin cerradura en un equipo que va a
   * estar en una mina no se abre, por mucho que Tailscale limite quien llama.
   */
  async aplicar(cfg: Config, alPedir?: AlPedir) {
    this.cfg = cfg;
    if (alPedir) this.alPedir = alPedir;
    if (!hayCanal()) return;

    const quiere = cfg.canal.activo && cfg.canal.token.trim().length > 0;

    if (!quiere) {
      if (this.reloj) {
        clearInterval(this.reloj);
        this.reloj = null;
      }
      await Nativo.parar().catch(() => undefined);
      return;
    }

    await Nativo.arrancar({ puerto: cfg.canal.puerto, token: cfg.canal.token.trim() })
      .catch(() => undefined);

    if (!this.reloj) this.reloj = setInterval(() => this.latir(), LATIDO_MS);
    this.latir();
  }

  private async latir() {
    if (!this.cfg) return;

    await Nativo.publicar({ estado: JSON.stringify(resumen(this.cfg)) }).catch(() => undefined);

    try {
      const { ordenes } = await Nativo.ordenes();
      if (ordenes && this.alPedir) this.alPedir(ordenes);
    } catch {
      /* Sin canal, no hay ordenes que recoger. */
    }
  }
}

export const canal = new Canal();
