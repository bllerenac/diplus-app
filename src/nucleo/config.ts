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
import { Tarjeta, nuevaTarjeta } from './panel';
import { Recomendacion, RECOMENDACION_POR_DEFECTO } from './geo';

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

/** De donde se baja la aplicacion cuando se pulsa actualizar. */
export interface Actualizacion {
  url: string;
}

export interface Config {
  /** Que se guarda en la base del equipo y durante cuanto. */
  registro: AjustesRegistro;
  fuentes: Fuente[];
  /** Las tarjetas del panel de la pantalla principal, en el orden en que se ven. */
  panel: Tarjeta[];
  gps: { ruta: string; baudios: number; activo: boolean };
  servidor: Servidor;
  actualizacion: Actualizacion;
  /** Genera un camión de mentira para poder ver la pantalla sin hardware. */
  maqueta: boolean;
  /** Velocidad y consumo que hay que mantener en cada geocerca, por su id. */
  recomendaciones: Record<string, Recomendacion>;
  /** Lo que se aplica donde no haya nada puesto. */
  recomendacionGeneral: Recomendacion;
}

const POR_DEFECTO: Config = {
  fuentes: [],
  panel: [],
  /* 921600 no es un capricho: es la velocidad a la que esta el puerto del
     receptor en este equipo, medida con stty. A 9600 no se leeria nada. */
  gps: { ruta: '/dev/ttyHSL2', baudios: 921600, activo: true },
  registro: { activo: true, cadaMs: 5000, retencionHoras: 72, claves: [] },
  servidor: {
    activo: false, url: 'https://miskimayo-back.wapsi.io/api', token: '',
    cadaSeg: 30, equipo: '', usuario: '', clave: '',
  },
  actualizacion: { url: '' },
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
  const panel = (c.panel as unknown[]) ?? [];
  if (panel.every((x) => typeof x === 'string')) {
    return {
      ...c,
      panel: (panel as string[]).map((clave) => ({ ...nuevaTarjeta('numero'), id: `t${clave}`, claves: [clave] })),
    };
  }
  return c;
};

export const guardar = (c: Config): Config => {
  memoria = c;
  try {
    localStorage.setItem(CLAVE, JSON.stringify(c));
  } catch {
    /* Sin sitio para guardar, al menos queda aplicada en esta sesion. */
  }
  return memoria;
};

export const nuevaFuente = (puerto: Fuente['puerto'] = 'rs485'): Fuente => {
  const protoId = puerto === 'rs485' ? 'helperbox-json' : 'dfm-j1939';
  return {
    id: `f${Date.now().toString(36)}`,
    nombre: puerto === 'rs485' ? 'HelperBox por RS485' : 'Bus CAN',
    puerto,
    /* Cual es el puerto del RS485 esta sin resolver, y las dos fuentes que hay
       no coinciden. Por eso se elige desde un selector en Configuracion.

       El SDK de la AT-10A dice que el RS485 es el conversor USB de la rama
       1-1.2 del bus —hoy ttyUSB0— y que ttyHSL0 es COM1, RS232:

         ComC.setPort(serial2);   // RS485 = 1-1.2
         ComA.setPort(serial0);   // COM1  = /dev/ttyHSL0

       Pero el codigo original de esta unidad, escrito cuando leia, usaba
       ttyHSL0 y lo etiquetaba «P4 RS485». Y la AT-10L no es la AT-10A.

       Se deja ttyUSB0 porque es lo unico documentado, pero no esta comprobado:
       ninguno de los dos ha entregado una sola trama todavia. Ver NOTAS-RS485.md. */
    ruta: puerto === 'rs485' ? '/dev/ttyUSB0' : '/dev/ttyHSL0',
    baudios: 9600,
    bitrate: 250000,
    protocoloId: protoId,
    config: defectosDe(protocolo(protoId)),
    activa: true,
  };
};
