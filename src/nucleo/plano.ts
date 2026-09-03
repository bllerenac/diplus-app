/**
 * El plano de la mina, guardado de verdad en el equipo.
 *
 * Antes solo se guardaba la direccion y la imagen se pedia al servidor cada vez
 * que se abria la pantalla. Con un plano de 34 MB eso significa que unas veces
 * aparece y otras no —el mapa se dibuja antes de que llegue— y que sin
 * cobertura no aparece nunca. En una mina eso es justo cuando hace falta.
 *
 * Aqui se baja una sola vez, se reduce y se guarda en el propio aparato.
 *
 * ─── Por que se reduce ───────────────────────────────────────────────────────
 *
 * 34 MB es un disparate para una pantalla de 806 pixeles de ancho: ese detalle
 * no se ve ni haciendo zoom. Pasado a JPEG de 2560 px de lado queda en uno o
 * dos megas, entra al instante y se ve igual. Se hace en el equipo y no en el
 * servidor porque el servidor no es nuestro.
 */

const BASE = 'diplus-plano';
const TIENDA = 'imagen';
const CLAVE = 'actual';

/** Mas de esto no aporta nada en una pantalla de menos de mil pixeles. */
const LADO_MAXIMO = 2560;
const CALIDAD = 0.85;

const abrir = (): Promise<IDBDatabase> =>
  new Promise((ok, mal) => {
    const p = indexedDB.open(BASE, 1);
    p.onupgradeneeded = () => {
      if (!p.result.objectStoreNames.contains(TIENDA)) p.result.createObjectStore(TIENDA);
    };
    p.onsuccess = () => ok(p.result);
    p.onerror = () => mal(p.error);
  });

const conTienda = <T>(modo: IDBTransactionMode, fn: (t: IDBObjectStore) => IDBRequest): Promise<T> =>
  abrir().then(
    (db) =>
      new Promise<T>((ok, mal) => {
        const r = fn(db.transaction(TIENDA, modo).objectStore(TIENDA));
        r.onsuccess = () => ok(r.result as T);
        r.onerror = () => mal(r.error);
      }),
  );

/**
 * Reduce la imagen a algo que quepa y se vea igual.
 *
 * Si el navegador no puede con ella —una imagen de 34 MB puede quedarse sin
 * memoria en un equipo modesto— se guarda tal cual: mejor pesada que ninguna.
 */
const reducir = (bytes: Blob): Promise<Blob> =>
  new Promise((ok) => {
    const url = URL.createObjectURL(bytes);
    const img = new Image();

    img.onload = () => {
      try {
        const escala = Math.min(1, LADO_MAXIMO / Math.max(img.width, img.height));
        if (escala >= 1) {
          URL.revokeObjectURL(url);
          ok(bytes);
          return;
        }

        const lienzo = document.createElement('canvas');
        lienzo.width = Math.round(img.width * escala);
        lienzo.height = Math.round(img.height * escala);
        lienzo.getContext('2d')?.drawImage(img, 0, 0, lienzo.width, lienzo.height);

        lienzo.toBlob(
          (b) => {
            URL.revokeObjectURL(url);
            ok(b ?? bytes);
          },
          'image/jpeg',
          CALIDAD,
        );
      } catch {
        URL.revokeObjectURL(url);
        ok(bytes);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      ok(bytes);
    };
    img.src = url;
  });

/** Baja el plano, lo reduce y lo deja guardado. Devuelve lo que ocupa. */
export const guardarPlano = async (url: string): Promise<number> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`el plano respondió ${r.status}`);

  const chico = await reducir(await r.blob());
  await conTienda('readwrite', (t) => t.put(chico, CLAVE));
  return chico.size;
};

/**
 * La direccion local del plano guardado, o `null` si no hay ninguno.
 *
 * Devuelve una direccion de objeto, que vive mientras viva la pagina. Quien la
 * use tiene que soltarla al terminar o se queda la memoria retenida.
 */
export const planoGuardado = async (): Promise<string | null> => {
  try {
    const b = await conTienda<Blob | undefined>('readonly', (t) => t.get(CLAVE));
    return b ? URL.createObjectURL(b) : null;
  } catch {
    return null;
  }
};

export const olvidarPlano = () =>
  conTienda('readwrite', (t) => t.delete(CLAVE)).catch(() => undefined);
