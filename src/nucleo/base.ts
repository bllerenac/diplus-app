/**
 * Base de datos del equipo.
 *
 * ─── Por que IndexedDB y no SQLite ────────────────────────────────────────────
 *
 * SQLite haria falta si hubiera que consultar con SQL o compartir el fichero
 * con otro programa. Aqui no: se escribe mucho y se lee por sensor y por
 * tiempo, que es justo para lo que sirve un indice de IndexedDB.
 *
 * A cambio no se añade ningun modulo nativo. Este equipo lleva Android 9 y ya
 * arrastra una libreria del fabricante que hubo que rescatar de un APK; meter
 * otra pieza nativa que compilar es exactamente el problema que no queremos
 * repetir. IndexedDB viene en el WebView y funciona desde Chrome 24.
 *
 * ─── Que se guarda ───────────────────────────────────────────────────────────
 *
 * Una fila por señal y por instante, igual que en el HelperBox: los datos de
 * cada sensor quedan separados y borrar uno se lleva los suyos. Y una cola
 * aparte de lo que esta pendiente de mandar al servidor, para que perder
 * cobertura —que en mina pasa todo el rato— no signifique perder el dato.
 */

const BASE = 'diplus';
const VERSION = 3;

export interface Lectura {
  id?: number;
  clave: string;
  valor: number | null;
  texto: string | null;
  at: number;
  /** Posicion en el momento de la lectura, si la habia. */
  lat?: number;
  lon?: number;
}

export interface Pendiente {
  id?: number;
  at: number;
  cuerpo: string;
  intentos: number;
}

let conexion: IDBDatabase | null = null;

const abrir = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    if (conexion) return resolve(conexion);

    const pet = indexedDB.open(BASE, VERSION);

    pet.onupgradeneeded = () => {
      const db = pet.result;

      if (!db.objectStoreNames.contains('lecturas')) {
        const s = db.createObjectStore('lecturas', { keyPath: 'id', autoIncrement: true });
        /* Por clave y tiempo, que es como se consulta: «el caudal de la ultima
           hora». Sin este indice habria que recorrer la tabla entera. */
        s.createIndex('clave_at', ['clave', 'at']);
        s.createIndex('at', 'at');
      }

      if (!db.objectStoreNames.contains('pendientes')) {
        db.createObjectStore('pendientes', { keyPath: 'id', autoIncrement: true });
      }

      /* Las calibraciones, con su historia. No se sobrescribe la anterior: una
         calibración se hace con el camión parado y en llano, y si alguien la
         repite mal —con el camión en una rampa, por ejemplo— hay que poder
         volver a la buena sin tener que bajar a llano otra vez. */
      if (!db.objectStoreNames.contains('calibraciones')) {
        const c = db.createObjectStore('calibraciones', { keyPath: 'id', autoIncrement: true });
        c.createIndex('que_at', ['que', 'at']);
      }

      /* Snapshots del payload Miskimayo: un registro por ciclo MQTT. Se borran
         una vez confirmado el envio por API para no crecer indefinidamente. */
      if (!db.objectStoreNames.contains('snapshots')) {
        const sn = db.createObjectStore('snapshots', { keyPath: 'id', autoIncrement: true });
        sn.createIndex('at', 'at');
        /* Indice compuesto para leer eficientemente los no enviados en orden. */
        sn.createIndex('enviado_at', ['enviado', 'at']);
      }
    };

    pet.onsuccess = () => {
      conexion = pet.result;
      resolve(conexion);
    };
    pet.onerror = () => reject(pet.error);
  });

const conTienda = async <T>(
  nombre: string,
  modo: IDBTransactionMode,
  hacer: (t: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(nombre, modo);
    const pet = hacer(tx.objectStore(nombre));
    pet.onsuccess = () => resolve(pet.result);
    pet.onerror = () => reject(pet.error);
  });
};

/* ── Lecturas ─────────────────────────────────────────────────────────────── */

/**
 * Guarda una tanda en una sola transaccion.
 *
 * Una por una serian tantas transacciones como señales, y en un bus cargado eso
 * castiga la memoria del equipo sin ganar nada: todas son del mismo instante.
 */
export const guardarLecturas = async (filas: Lectura[]): Promise<number> => {
  if (!filas.length) return 0;
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('lecturas', 'readwrite');
    const tienda = tx.objectStore('lecturas');
    for (const f of filas) tienda.add(f);
    tx.oncomplete = () => resolve(filas.length);
    tx.onerror = () => reject(tx.error);
  });
};

/** Lo guardado de una señal, de lo más reciente hacia atrás. */
export const leerDe = async (clave: string, desde: number, limite = 500): Promise<Lectura[]> => {
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('lecturas', 'readonly');
    const idx = tx.objectStore('lecturas').index('clave_at');
    const rango = IDBKeyRange.bound([clave, desde], [clave, Infinity]);
    const salida: Lectura[] = [];

    const cur = idx.openCursor(rango, 'prev');
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || salida.length >= limite) return resolve(salida);
      salida.push(c.value as Lectura);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
};

/**
 * Todo lo guardado a partir de un instante, de lo viejo a lo nuevo.
 *
 * En este orden y no al revés porque es lo que pide el envío por lotes: se
 * manda un trozo, se apunta hasta dónde se llegó y la próxima vuelta sigue por
 * ahí. Del revés no habría por dónde seguir.
 */
export const leerDesde = async (desde: number, limite = 200): Promise<Lectura[]> => {
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('lecturas', 'readonly');
    const idx = tx.objectStore('lecturas').index('at');
    const salida: Lectura[] = [];

    const cur = idx.openCursor(IDBKeyRange.lowerBound(desde), 'next');
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || salida.length >= limite) return resolve(salida);
      salida.push(c.value as Lectura);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
};

/** Cuántas filas hay y desde cuándo, para poder decidir la retención. */
export const resumen = async (): Promise<{ filas: number; desde: number | null }> => {
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('lecturas', 'readonly');
    const tienda = tx.objectStore('lecturas');
    const cuenta = tienda.count();

    cuenta.onsuccess = () => {
      const cur = tienda.index('at').openCursor(null, 'next');
      cur.onsuccess = () =>
        resolve({ filas: cuenta.result, desde: cur.result ? (cur.result.value as Lectura).at : null });
      cur.onerror = () => reject(cur.error);
    };
    cuenta.onerror = () => reject(cuenta.error);
  });
};

/**
 * Poda por antiguedad.
 *
 * El almacen del navegador no es infinito y nadie avisa cuando se llena: la
 * escritura empieza a fallar y punto. Mejor tirar lo viejo a propósito que
 * descubrirlo el día que no quepa una lectura.
 */
export const podar = async (horas: number): Promise<number> => {
  const corte = Date.now() - horas * 3600_000;
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('lecturas', 'readwrite');
    const idx = tx.objectStore('lecturas').index('at');
    let borradas = 0;

    const cur = idx.openCursor(IDBKeyRange.upperBound(corte));
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) return resolve(borradas);
      c.delete();
      borradas += 1;
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
};

export const vaciar = async (): Promise<void> => {
  await conTienda('lecturas', 'readwrite', (t) => t.clear());
};

/* ── Calibraciones ────────────────────────────────────────────────────────── */

/**
 * Una calibración guardada, con la fecha en que se hizo.
 *
 * La configuración vive en `localStorage`, que es donde tiene que estar para
 * que la lea la pantalla, pero eso se borra: basta con vaciar los datos de la
 * aplicación. Y una calibración de la inercial no se rehace en un minuto — hay
 * que llevar el camión a llano, pararlo y volver a tomarla. En la base queda a
 * salvo de eso, y además con su historia.
 */
export interface Calibracion {
  id?: number;
  /** Qué se calibró. Hoy solo `imu`; las curvas de las señales podrían ir aquí. */
  que: string;
  datos: unknown;
  at: number;
}

export const guardarCalibracion = (que: string, datos: unknown): Promise<IDBValidKey> =>
  conTienda('calibraciones', 'readwrite', (t) => t.add({ que, datos, at: Date.now() }));

/** Las calibraciones de algo, de la más reciente hacia atrás. */
export const calibraciones = async (que: string, limite = 10): Promise<Calibracion[]> => {
  const db = await abrir();

  return new Promise((resolve, reject) => {
    const tx = db.transaction('calibraciones', 'readonly');
    const idx = tx.objectStore('calibraciones').index('que_at');
    const salida: Calibracion[] = [];

    const cur = idx.openCursor(IDBKeyRange.bound([que, 0], [que, Infinity]), 'prev');
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c || salida.length >= limite) return resolve(salida);
      salida.push(c.value as Calibracion);
      c.continue();
    };
    cur.onerror = () => reject(cur.error);
  });
};

/* ── Cola de envio ────────────────────────────────────────────────────────── */

export const encolar = (cuerpo: unknown): Promise<IDBValidKey> =>
  conTienda('pendientes', 'readwrite', (t) =>
    t.add({ at: Date.now(), cuerpo: JSON.stringify(cuerpo), intentos: 0 }),
  );

export const pendientes = (limite = 50): Promise<Pendiente[]> =>
  conTienda<Pendiente[]>('pendientes', 'readonly', (t) => t.getAll(undefined, limite));

export const quitarPendiente = (id: number): Promise<undefined> =>
  conTienda('pendientes', 'readwrite', (t) => t.delete(id));

export const cuantosPendientes = (): Promise<number> =>
  conTienda<number>('pendientes', 'readonly', (t) => t.count());

/** `true` si el navegador de este equipo tiene IndexedDB. */
export const hayBase = (): boolean => typeof indexedDB !== 'undefined';

/* ── Snapshots (Miskimayo payload histórico) ──────────────────────────────── */

export interface Snapshot {
  id?: number;
  at: number;
  enviado: number; // 0 = pendiente, 1 = enviado
  datos: string;
}

export const guardarSnapshot = (datos: string): Promise<IDBValidKey> =>
  conTienda('snapshots', 'readwrite', (t) =>
    t.add({ at: Date.now(), enviado: 0, datos }),
  );

export const leerSnapshotsPendientes = async (limite = 100): Promise<Snapshot[]> => {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const store = tx.objectStore('snapshots');
    const idx = store.index('enviado_at');
    const resultados: Snapshot[] = [];

    // Busca los registros con enviado = 0 ordenados por tiempo
    const range = IDBKeyRange.bound([0, 0], [0, Infinity]);
    const req = idx.openCursor(range);

    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor && resultados.length < limite) {
        resultados.push(cursor.value as Snapshot);
        cursor.continue();
      } else {
        resolve(resultados);
      }
    };
    req.onerror = () => reject(req.error);
  });
};

export const marcarSnapshotsEnviados = async (ids: number[]): Promise<void> => {
  if (ids.length === 0) return;
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readwrite');
    const store = tx.objectStore('snapshots');

    let processed = 0;
    for (const id of ids) {
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const item = getReq.result as Snapshot;
        if (item) {
          item.enviado = 1;
          store.put(item);
        }
        processed++;
        if (processed === ids.length) resolve();
      };
      getReq.onerror = () => reject(getReq.error);
    }
  });
};

export const cuantosSnapshotsPendientes = async (): Promise<number> => {
  const db = await abrir();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('snapshots', 'readonly');
    const idx = tx.objectStore('snapshots').index('enviado_at');
    const req = idx.count(IDBKeyRange.bound([0, 0], [0, Infinity]));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
};
