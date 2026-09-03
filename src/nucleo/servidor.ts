/**
 * Lo que el equipo trae del servidor: el plano de la mina y las geocercas.
 *
 * En una cabina eso no es un adorno. Un mapa de calles no dice nada dentro de
 * una mina —no hay calles—, y sin las geocercas dibujadas el conductor no sabe
 * si esta entrando en la zona de descarga o pasando de largo. Es justo lo que
 * hace un Waze: enseñar donde estas **sobre el terreno que importa**.
 *
 * ─── Se guarda todo en el equipo ─────────────────────────────────────────────
 *
 * Una mina es el peor sitio del mundo para depender de la red. Lo que se baja
 * se queda guardado y la pantalla tira de eso: se descarga cuando hay cobertura
 * y se sigue viendo cuando no la hay. Sin esto, el mapa se quedaria en blanco
 * justo donde hace falta.
 */

/** Una geocerca ya en el vocabulario del mapa: latitud primero. */
export interface Geocerca {
  id: string;
  nombre: string;
  tipo: 'poligono' | 'circulo';
  color: string;
  /** El poligono, o el centro si es un circulo. */
  puntos: [number, number][];
  /** Solo en los circulos, en metros. */
  radio: number;
}

/** El plano de la mina, con las coordenadas de sus esquinas. */
export interface Plano {
  url: string;
  /** [[sur, oeste], [norte, este]], como los quiere Leaflet. */
  limites: [[number, number], [number, number]];
  centro: [number, number];
}

/**
 * Lo que el servidor sabe del camion y el equipo no puede medir.
 *
 * El operador, de donde viene y a donde va salen del despacho, no de un
 * sensor. Sin esto la pantalla no puede decirle al conductor nada sobre su
 * viaje, que es la mitad de lo que necesita saber.
 */
export interface Camion {
  unidad: string;
  operador: string;
  desde: string;
  hacia: string;
  /** Toneladas del turno. */
  tonelaje: number;
  /** Viajes del turno, del despacho. */
  viajes: number;
  /** Ciclos cerrados, que el equipo no puede contar por su cuenta. */
  ciclos: number;
  estado: string;
}

export interface Descargado {
  geocercas: Geocerca[];
  plano: Plano | null;
  camion: Camion | null;
  at: number;
}

const CLAVE = 'diplus.servidor.v1';

/** El servidor manda `x` como longitud y `y` como latitud; los mapas al reves. */
const aPunto = (p: { x: number; y: number }): [number, number] => [p.y, p.x];

const traerGeocercas = (crudas: any[]): Geocerca[] =>
  crudas
    .filter((g) => g && g.isActive !== false && Array.isArray(g.points) && g.points.length)
    .map((g) => ({
      id: String(g.id),
      nombre: String(g.name ?? 'Sin nombre'),
      tipo: g.type === 'circle' ? 'circulo' : 'poligono',
      color: typeof g.color === 'string' && g.color ? g.color : '#2ee6b0',
      puntos: g.points.map(aPunto),
      /* En un circulo el radio viene en el propio punto. */
      radio: Number(g.points[0]?.r) || 0,
    }));

const traerPlano = (config: any[], base: string): Plano | null => {
  const imagen = config.find((c) => c?.key === 'map_image')?.value;
  const crudo = config.find((c) => c?.key === 'map_image_bounds')?.value;
  if (!imagen || !crudo) return null;

  let b: any;
  try {
    b = typeof crudo === 'string' ? JSON.parse(crudo) : crudo;
  } catch {
    return null;
  }
  if (!Array.isArray(b?.bounds) || b.bounds.length !== 2) return null;

  /* La imagen cuelga de la raiz del servidor, no de /api. */
  const raiz = base.replace(/\/api\/?$/, '');
  return {
    url: String(imagen).startsWith('http') ? String(imagen) : raiz + imagen,
    limites: [
      [Number(b.bounds[0][0]), Number(b.bounds[0][1])],
      [Number(b.bounds[1][0]), Number(b.bounds[1][1])],
    ],
    centro: Array.isArray(b.center) ? [Number(b.center[0]), Number(b.center[1])] : [0, 0],
  };
};

/**
 * El camion de esta unidad, de la lista que devuelve el servidor.
 *
 * Se busca por el nombre de unidad que tenga configurado el equipo. Sin
 * unidad puesta no se adivina: enseñar los datos de otro camion seria peor
 * que no enseñar ninguno.
 */
const traerCamion = (lista: any[], unidad: string): Camion | null => {
  if (!unidad.trim()) return null;
  const c = lista.find((x) => String(x?.unit ?? '').toUpperCase() === unidad.trim().toUpperCase());
  if (!c) return null;

  return {
    unidad: String(c.unit ?? unidad),
    operador: String(c.currentOperator ?? ''),
    /* El servidor guarda el tramo como «Route_PB2_PB4». */
    desde: String(c.lastValidLocation ?? '').split('_')[1] ?? '',
    hacia: String(c.lastValidLocation ?? '').split('_')[2] ?? '',
    tonelaje: Number(c.currentShiftTonnage) || 0,
    viajes: Number(c.currentShiftTrips) || 0,
    ciclos: 0,
    estado: String(c.status ?? ''),
  };
};

/** Lo ultimo que se bajo. Se lee del equipo, sin tocar la red. */
export const guardado = (): Descargado | null => {
  try {
    const crudo = localStorage.getItem(CLAVE);
    return crudo ? (JSON.parse(crudo) as Descargado) : null;
  } catch {
    return null;
  }
};

const guardar = (d: Descargado) => {
  try {
    localStorage.setItem(CLAVE, JSON.stringify(d));
  } catch {
    /* Sin sitio para guardar, al menos vale en esta sesion. */
  }
};

const pedir = async (base: string, ruta: string, token?: string) => {
  const r = await fetch(base.replace(/\/$/, '') + ruta, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}`);
  return r.json();
};

/** Cambia usuario y contraseña por un token. */
export const entrar = async (base: string, email: string, clave: string): Promise<string> => {
  const r = await fetch(base.replace(/\/$/, '') + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: clave }),
  });
  if (!r.ok) {
    throw new Error(r.status === 401 ? 'Usuario o contraseña incorrectos.' : `El servidor respondió ${r.status}.`);
  }
  const d = await r.json();
  const t = d?.token ?? d?.access_token ?? d?.accessToken;
  if (!t) throw new Error('El servidor no devolvió ningún token.');
  return String(t);
};

/**
 * Baja el plano y las geocercas, y los deja guardados en el equipo.
 *
 * Las geocercas van sin token porque el servidor las pide con sesion, pero el
 * plano no: si una de las dos falla, se conserva lo que ya hubiera de esa parte
 * en vez de dejar la pantalla peor de como estaba.
 */
export const descargar = async (base: string, token: string, unidad = ''): Promise<Descargado> => {
  const antes = guardado();

  let geocercas = antes?.geocercas ?? [];
  let plano = antes?.plano ?? null;
  let camion = antes?.camion ?? null;
  const fallos: string[] = [];

  try {
    const crudas = await pedir(base, '/geofence', token);
    geocercas = traerGeocercas(Array.isArray(crudas) ? crudas : crudas?.data ?? []);
  } catch (e) {
    fallos.push(`geocercas: ${(e as Error).message}`);
  }

  try {
    const cfg = await pedir(base, '/system-config', token);
    const nuevo = traerPlano(Array.isArray(cfg) ? cfg : cfg?.data ?? [], base);
    if (nuevo) plano = nuevo;
  } catch (e) {
    fallos.push(`plano: ${(e as Error).message}`);
  }

  /* El camion es publico, sin token, asi que va aparte: que falle no debe
     llevarse por delante el plano ni las geocercas. */
  try {
    const lista = await pedir(base, '/truck');
    const c = traerCamion(Array.isArray(lista) ? lista : lista?.data ?? [], unidad);
    if (c) camion = c;
  } catch {
    /* Se conserva el ultimo que se supo. */
  }

  if (fallos.length === 2) throw new Error(fallos.join(' · '));

  const d: Descargado = { geocercas, plano, camion, at: Date.now() };
  guardar(d);
  return d;
};
