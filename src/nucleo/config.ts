/**
 * Configuracion del equipo, guardada en el propio aparato.
 *
 * Todo lo que decide que se lee, como se interpreta y que se enseña vive aqui.
 * Nada de esto esta en el codigo: un equipo nuevo se configura desde la pantalla
 * de ajustes, sin recompilar.
 */
import { Fuente } from './hardware';
import { AjustesRegistro } from './registro';
import { defectosDe, protocolo } from './protocolos';
import { Tarjeta, nuevaTarjeta, panelFijo } from './panel';
import { Recomendacion, RECOMENDACION_POR_DEFECTO } from './geo';
import { AjustesMovimiento, MOVIMIENTO_POR_DEFECTO } from './movimiento';
import { AjustesPorSenal } from './senales';
import { AjustesEnvio, ENVIO_POR_DEFECTO } from './envio';
import { AjustesRumbo, RUMBO_POR_DEFECTO } from './rumbo';

const CLAVE = 'diplus.config.v1';

export interface Servidor {
  activo: boolean;
  url: string;
  token: string;
  /** Cada cuanto se manda lo leido, en segundos. */
  cadaSeg: number;
  /** Identificador de este equipo en el servidor. */
  equipo: string;
  /** Para pedir el token cuando caduca. Se guarda en el equipo, en claro. */
  usuario: string;
  clave: string;
}

/** De dónde se baja la aplicación, y si se mira sola. */
export interface Actualizacion {
  url: string;
  /** URL del APK de Tailscale alojado en el servidor propio. */
  urlTailscale: string;
  /** Mira si hay versión nueva por su cuenta, sin que nadie pulse. */
  automatica: boolean;
  /** Cada cuántas horas mira. */
  cadaHoras: number;
}

/**
 * La puerta para mirar el equipo de lejos.
 *
 * No depende del ADB, que muere en cada reinicio y en este aparato no se puede
 * dejar permanente. Sin token no se abre.
 */
export interface Canal {
  activo: boolean;
  puerto: number;
  token: string;
}

export interface Config {
  /** Que se guarda en la base del equipo y durante cuanto. */
  registro: AjustesRegistro;
  fuentes: Fuente[];
  /** Las tarjetas del panel de la pantalla principal, en el orden en que se ven. */
  panel: Tarjeta[];
  gps: { ruta: string; baudios: number; activo: boolean };
  /** Cuando el mapa gira con la marcha y cuanto se suaviza. */
  rumbo: AjustesRumbo;
  servidor: Servidor;
  /** A dónde salen las lecturas: en directo por socket y por lotes a una API. */
  envio: AjustesEnvio;
  actualizacion: Actualizacion;
  canal: Canal;
  /** La unidad inercial del propio equipo: inclinacion, conduccion y via. */
  movimiento: AjustesMovimiento;
  /**
   * Lo que se decide de cada señal, por su clave completa.
   *
   * Va aparte de las fuentes porque no es del cable sino de la señal: el
   * mismo caudalimetro puede llegar hoy por RS485 y mañana por red, y su
   * nombre, su unidad y su curva siguen siendo los suyos.
   */
  senales: AjustesPorSenal;
  /** Genera un camión de mentira para poder ver la pantalla sin hardware. */
  maqueta: boolean;
  /** Velocidad y consumo que hay que mantener en cada geocerca, por su id. */
  recomendaciones: Record<string, Recomendacion>;
  /** Lo que se aplica donde no haya nada puesto. */
  recomendacionGeneral: Recomendacion;
}

const POR_DEFECTO: Config = {
  fuentes: [],
  panel: panelFijo(),
  /* 921600 no es un capricho: es la velocidad a la que esta el puerto del
     receptor en este equipo, medida con stty. A 9600 no se leeria nada. */
  gps: { ruta: '/dev/ttyHSL2', baudios: 921600, activo: true },
  rumbo: RUMBO_POR_DEFECTO,
  registro: { activo: true, cadaMs: 5000, retencionHoras: 72, claves: [] },
  servidor: {
    activo: false, url: 'https://miskimayo-back.wapsi.io/api', token: '',
    cadaSeg: 30, equipo: 'SC-03', usuario: '', clave: '',
  },
  envio: ENVIO_POR_DEFECTO,
  actualizacion: {
    url: 'https://miskimayo.wapsi.io/apks/diplus.apk',
    urlTailscale: 'https://miskimayo.wapsi.io/apks/tailscale.apk',
    automatica: true,
    cadaHoras: 6,
  },
  canal: { activo: false, puerto: 8787, token: '' },
  movimiento: MOVIMIENTO_POR_DEFECTO,
  senales: {},
  maqueta: false,
  recomendaciones: {},
  recomendacionGeneral: RECOMENDACION_POR_DEFECTO,
};

let memoria: Config = POR_DEFECTO;
let cargada = false;

export const cargar = (): Config => {
  if (cargada) return memoria;
  cargada = true;
  try {
    const crudo = localStorage.getItem(CLAVE);
    if (crudo) memoria = alDia({ ...POR_DEFECTO, ...JSON.parse(crudo) });
  } catch {
    /* Configuracion ilegible: se sigue con la de fabrica en vez de no arrancar. */
  }
  return memoria;
};

/**
 * Sube la configuracion vieja a la de ahora.
 *
 * El panel era una lista de claves y paso a ser una lista de tarjetas. Un
 * equipo que ya estaba configurado no puede quedarse con la pantalla en blanco
 * por eso: cada clave que hubiera se convierte en una tarjeta de numero, que es
 * exactamente como se veia antes.
 */
const alDia = (c: Config): Config => {
  let res = c;
  const panel = (c.panel as unknown[]) ?? [];

  if (panel.length && panel.every((x) => typeof x === 'string')) {
    res = {
      ...res,
      panel: (panel as string[]).map((clave) => ({ ...nuevaTarjeta('numero'), id: `t${clave}`, claves: [clave] })),
    };
  } else if (!panel.length) {
    res = { ...res, panel: panelFijo() };
  }

  const act = res.actualizacion || {};
  res = {
    ...res,
    actualizacion: {
      url: act.url && act.url.trim() ? act.url : 'https://miskimayo.wapsi.io/apks/diplus.apk',
      urlTailscale: act.urlTailscale && act.urlTailscale.trim() ? act.urlTailscale : 'https://miskimayo.wapsi.io/apks/tailscale.apk',
      automatica: act.automatica ?? true,
      cadaHoras: act.cadaHoras || 6,
    },
  };

  if (Array.isArray(res.fuentes)) {
    res.fuentes = res.fuentes.map((f) => {
      if (f.puerto === 'rs485' && (!f.ruta || f.ruta === '/dev/ttyUSB0')) {
        return { ...f, ruta: '/dev/ttyHSL0' };
      }
      return f;
    });
  }

  if (!res.envio?.equipo || !res.envio.equipo.trim()) {
    res = { ...res, envio: { ...res.envio, equipo: 'SC-03' } };
  }
  if (!res.servidor?.equipo || !res.servidor.equipo.trim()) {
    res = { ...res, servidor: { ...res.servidor, equipo: 'SC-03' } };
  }

  return res;
};

/**
 * Quien quiere enterarse cuando la configuración cambia.
 *
 * Sin esto la pantalla principal se quedaba con la que leyó al abrirse: se
 * tocaba un ajuste, se volvía, y seguía con la vieja. Una fuente recién dada de
 * alta no se leía nunca, y la maqueta apagada seguía enseñando su franja, hasta
 * que alguien cerraba y volvía a abrir la aplicación. Se vio en el equipo.
 */
type Oyente = (c: Config) => void;
const oyentes = new Set<Oyente>();

export const alCambiar = (fn: Oyente): (() => void) => {
  oyentes.add(fn);
  return () => {
    oyentes.delete(fn);
  };
};

export const guardar = (c: Config): Config => {
  memoria = c;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {
    /* Sin sitio para guardar, al menos queda aplicada en esta sesión. */
  }
  oyentes.forEach((fn) => fn(memoria));
  return memoria;
};

export const nuevaFuenteCaudalimetro = (tipo: 'ingreso' | 'retorno'): Fuente => {
  const esclavo = tipo === 'ingreso' ? 2 : 3;
  const tag = tipo === 'ingreso' ? 'Ingreso' : 'Retorno';
  const clavePrefix = tipo === 'ingreso' ? 'ingreso' : 'retorno';

  const proto = protocolo('modbus-rtu');
  const cfgDefectos = defectosDe(proto);

  return {
    id: `f${Date.now().toString(36)}`,
    nombre: `Caudalímetro ${tag}`,
    puerto: 'rs485',
    ruta: '/dev/ttyHSL0',
    baudios: 9600,
    bitrate: 0,
    protocoloId: 'modbus-rtu',
    config: {
      ...cfgDefectos,
      esclavo,
      funcion: '3',
      registro: 0,
      cantidad: 3,
      preguntar_cada_ms: 1000,
      exigir_crc: 'si',
      registros_modbus: [
        {
          registro: 0,
          clave: `totalizador_${clavePrefix}`,
          nombre: 'Totalizador',
          tipo: 'u32be',
          escala: 1,
          unidad: 'L',
        },
        {
          registro: 2,
          clave: `caudal_${clavePrefix}`,
          nombre: 'Caudal',
          tipo: 'u16be',
          escala: 1,
          unidad: 'L/h',
        },
      ],
    },
    activa: true,
  };
};

export const nuevaFuente = (puerto: Fuente['puerto'] = 'rs485'): Fuente => {
  /* Por red llegan las mismas lineas de JSON que manda el puente del HelperBox
     por el cable serie, asi que se reaprovecha el protocolo tal cual. */
  const protoId =
    puerto === 'red' || puerto === 'rs485' ? 'helperbox-json' : 'dfm-j1939';

  if (puerto === 'red') {
    return {
      id: `f${Date.now().toString(36)}`,
      nombre: 'HelperBox por red',
      puerto,
      ruta: '',
      /* Aqui `baudios` es el puerto UDP en el que se escucha. */
      baudios: 9977,
      bitrate: 0,
      protocoloId: protoId,
      config: defectosDe(protocolo(protoId)),
      activa: true,
    };
  }

  return {
    id: `f${Date.now().toString(36)}`,
    nombre: puerto === 'rs485' ? 'HelperBox por RS485' : 'Bus CAN',
    puerto,
    ruta: '/dev/ttyHSL0',
    baudios: 9600,
    bitrate: 250000,
    protocoloId: protoId,
    config: defectosDe(protocolo(protoId)),
    activa: true,
  };
};

