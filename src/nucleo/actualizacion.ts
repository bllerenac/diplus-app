/**
 * Actualizar la aplicacion desde una direccion propia.
 *
 * Sin Google Play y sin cable: el equipo sale a buscar el APK a donde se le
 * diga. La direccion la escribe quien configura, y aqui se le ayuda a acertar
 * porque es facilisimo pegar la que no es.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

export interface VersionInstalada {
  versionName: string;
  versionCode: number;
  packageName: string;
  /** Android 8 en adelante pide permiso aparte para instalar. */
  puedeInstalar: boolean;
}

export interface Descarga {
  ruta: string;
  versionName: string;
  versionCode: number;
  bytes: number;
}

interface PluginActualizador {
  version(): Promise<VersionInstalada>;
  descargar(o: { url: string }): Promise<Descarga>;
  instalar(o: { ruta: string }): Promise<void>;
  addListener(evento: 'onDescarga', fn: (d: { bytes: number; total: number }) => void): Promise<{ remove: () => void }>;
}

const Nativo = registerPlugin<PluginActualizador>('Actualizador');

export const hayActualizador = () => Capacitor.isNativePlatform();

/**
 * Arregla las direcciones de Google Drive.
 *
 * El enlace que da Drive al compartir apunta a una **pagina web** que enseña el
 * archivo, no al archivo. Pegarlo es el error que va a cometer todo el mundo,
 * asi que en vez de fallar con un mensaje raro se traduce solo.
 *
 *   https://drive.google.com/file/d/ID/view?usp=sharing
 *   https://drive.google.com/open?id=ID
 *        ambos pasan a ser
 *   https://drive.google.com/uc?export=download&id=ID
 *
 * Vale para archivos por debajo de unos 100 MB. Por encima Drive mete una
 * pantalla de aviso del antivirus y devuelve eso en vez del archivo; el APK de
 * DiPlus anda por 5 MB, asi que no llega.
 */
export const arreglarDireccion = (url: string): string => {
  const u = url.trim();

  const porRuta = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/);
  if (porRuta) return `https://drive.google.com/uc?export=download&id=${porRuta[1]}`;

  const porParametro = u.match(/drive\.google\.com\/(?:open|uc)\?(?:[^#]*&)?id=([\w-]+)/);
  if (porParametro) return `https://drive.google.com/uc?export=download&id=${porParametro[1]}`;

  return u;
};

/** Si la direccion tiene una pinta que no va a funcionar, decirlo antes de bajar 5 MB. */
export const reparo = (url: string): string | null => {
  const u = url.trim();
  if (!u) return 'Falta la dirección.';
  if (!/^https?:\/\//i.test(u)) return 'La dirección tiene que empezar por http:// o https://';

  if (/dropbox\.com/.test(u) && !/[?&]dl=1/.test(u)) {
    return 'En Dropbox hay que cambiar el final del enlace a dl=1, si no devuelve una página.';
  }
  if (/github\.com\/.+\/blob\//.test(u)) {
    return 'Ese enlace de GitHub es la página del archivo. Hace falta el de «Raw» o el de la publicación.';
  }
  return null;
};

/** Solo se llama «nueva» si sube el número. Android no deja instalar hacia atrás. */
export const esMasNueva = (traida: number, instalada: number) => traida > instalada;

export const actualizador = {
  version: () => Nativo.version(),

  async descargar(url: string, alAvanzar?: (bytes: number, total: number) => void): Promise<Descarga> {
    let quitar: { remove: () => void } | null = null;
    if (alAvanzar) {
      quitar = await Nativo.addListener('onDescarga', (d) => alAvanzar(d.bytes, d.total));
    }
    try {
      return await Nativo.descargar({ url: arreglarDireccion(url) });
    } finally {
      quitar?.remove?.();
    }
  },

  instalar: (ruta: string) => Nativo.instalar({ ruta }),
};

/**
 * Mira si hay versión nueva por su cuenta.
 *
 * Es lo que hace que una flota se mantenga sola: se publica una versión y los
 * equipos se ponen al día sin que nadie vaya camión por camión.
 *
 * **Baja y avisa, pero no instala.** El último paso lo da una persona, porque
 * en Android 9 sin ser device owner no hay otra. Lo que se gana es que el APK
 * ya esté en el equipo y aparezca el aviso: quien se suba a la cabina solo
 * tiene que aceptar.
 */
const CLAVE_REVISION = 'diplus.revision.at';

export const revisarSola = async (
  cfg: { url: string; automatica: boolean; cadaHoras: number },
  ahoraMismo = false,
): Promise<Descarga | null> => {
  if (!hayActualizador() || !cfg.url.trim()) return null;
  if (!ahoraMismo && !cfg.automatica) return null;

  if (!ahoraMismo) {
    /* No en cada arranque: un equipo que se reinicia varias veces al día se
       pasaría el turno bajando el mismo APK. */
    const antes = Number(localStorage.getItem(CLAVE_REVISION)) || 0;
    const cada = Math.max(1, cfg.cadaHoras) * 3600000;
    if (Date.now() - antes < cada) return null;
  }
  localStorage.setItem(CLAVE_REVISION, String(Date.now()));

  try {
    const yo = await actualizador.version();
    const d = await actualizador.descargar(cfg.url);

    if (!esMasNueva(d.versionCode, yo.versionCode)) return null;

    /* Se abre el instalador: en la cabina saldrá el aviso de Android y quien
       esté delante lo acepta. Si no hay nadie, queda bajado para la próxima. */
    await actualizador.instalar(d.ruta).catch(() => undefined);
    return d;
  } catch {
    /* Sin red o con la dirección mal: se reintenta en la siguiente vuelta. */
    return null;
  }
};
