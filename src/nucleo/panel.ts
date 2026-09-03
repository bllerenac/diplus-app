/**
 * Que se ve en la pantalla principal, y como.
 *
 * Antes el panel era una lista de señales: se elegian cuales salir y todas se
 * pintaban igual, un numero detras de otro. Eso no alcanza. Un caudalimetro de
 * ida y otro de retorno no interesan por separado —lo que se quiere leer es la
 * resta, que es el consumo—, y un nivel de tanque sin saber cuanto cabe es un
 * numero sin escala.
 *
 * Asi que el panel se arma con tarjetas. Cada tarjeta dice **que señales toma**
 * y **como las presenta**, y las dos cosas se eligen desde Configuracion sin
 * tocar codigo. Aqui solo esta el calculo; lo que pinta cada forma esta en la
 * pantalla.
 */
import { Senal } from './lecturas';

export type VistaTarjeta =
  | 'numero' | 'diferencia' | 'suma' | 'nivel' | 'texto'
  | 'tanque' | 'cuadrante' | 'termometro';

export interface Tarjeta {
  id: string;
  titulo: string;
  vista: VistaTarjeta;
  /** Claves `fuenteId.senal`. Una para casi todo, dos para restar o sumar. */
  claves: string[];
  /** Vacia = la que traiga la señal. Se pone a mano cuando la resta cambia de unidad. */
  unidad: string;
  decimales: number;
  /** Los extremos de la barra de nivel. */
  min: number;
  max: number;
  /** Fuera de estos limites la tarjeta avisa. `null` = sin limite. */
  bajo: number | null;
  alto: number | null;
  /** Ocupa el ancho entero del panel en vez de media columna. */
  grande: boolean;
  /** Nombre del icono en lucide. Vacío = sin icono. */
  icono: string;
  /**
   * Multiplica el valor antes de enseñarlo.
   *
   * Un caudalímetro da litros por hora y en la mina se habla en galones. La
   * conversión va aquí y no en el protocolo porque es cosa de cómo se quiere
   * leer, no de cómo llega el dato: el mismo sensor puede verse en las dos
   * unidades en dos tarjetas distintas.
   */
  factor: number;
}

/** Cada forma de presentar, con lo que necesita. La pantalla se dibuja de aqui. */
export const VISTAS: {
  id: VistaTarjeta;
  nombre: string;
  ayuda: string;
  /** Cuantas señales toma: exactamente esta cantidad. */
  senales: number;
  /** Que campos tiene sentido configurar en esta vista. */
  usa: ('unidad' | 'decimales' | 'rango' | 'umbrales')[];
}[] = [
  {
    id: 'numero',
    nombre: 'Número',
    ayuda: 'El valor tal cual, en grande. Para caudal, temperatura, revoluciones, horas.',
    senales: 1,
    usa: ['unidad', 'decimales', 'umbrales'],
  },
  {
    id: 'diferencia',
    nombre: 'Diferencia',
    ayuda: 'La primera menos la segunda. Con dos caudalímetros, ida menos retorno es el consumo.',
    senales: 2,
    usa: ['unidad', 'decimales', 'umbrales'],
  },
  {
    id: 'suma',
    nombre: 'Suma',
    ayuda: 'Las dos sumadas. Para dos tanques que se leen como uno.',
    senales: 2,
    usa: ['unidad', 'decimales', 'umbrales'],
  },
  {
    id: 'nivel',
    nombre: 'Nivel',
    ayuda: 'Número y barra entre un mínimo y un máximo. Para tanques y depósitos.',
    senales: 1,
    usa: ['unidad', 'decimales', 'rango', 'umbrales'],
  },
  {
    id: 'tanque',
    nombre: 'Tanque',
    ayuda: 'Un depósito que se ve llenarse y vaciarse. Para combustible, agua o aceite.',
    senales: 1,
    usa: ['unidad', 'decimales', 'rango', 'umbrales'],
  },
  {
    id: 'termometro',
    nombre: 'Termómetro',
    ayuda: 'Columna que sube con el calor. Para temperaturas, que es como se leen desde siempre.',
    senales: 1,
    usa: ['unidad', 'decimales', 'rango', 'umbrales'],
  },
  {
    id: 'cuadrante',
    nombre: 'Cuadrante',
    ayuda: 'Aguja sobre un arco, como el cuentarrevoluciones. Para revoluciones y presiones.',
    senales: 1,
    usa: ['unidad', 'decimales', 'rango', 'umbrales'],
  },
  {
    id: 'texto',
    nombre: 'Texto',
    ayuda: 'El valor sin tocar. Para estados, códigos y todo lo que no es un número.',
    senales: 1,
    usa: [],
  },
];

/**
 * Los iconos que puede llevar una tarjeta.
 *
 * Un tablero de camion no es una lista de numeros: se mira de reojo y lo que
 * se reconoce primero es el simbolo, no el rotulo. El nombre que hay aqui es
 * el del icono en lucide, y la pantalla lo resuelve.
 */
export const ICONOS: { id: string; nombre: string }[] = [
  { id: 'Droplet', nombre: 'Gota · caudal' },
  { id: 'Fuel', nombre: 'Surtidor · combustible' },
  { id: 'Gauge', nombre: 'Aguja · presión' },
  { id: 'Thermometer', nombre: 'Termómetro' },
  { id: 'CircleGauge', nombre: 'Cuentarrevoluciones' },
  { id: 'Battery', nombre: 'Batería · voltaje' },
  { id: 'Clock', nombre: 'Reloj · horas' },
  { id: 'Activity', nombre: 'Actividad · carga' },
  { id: 'Weight', nombre: 'Peso · tonelaje' },
  { id: 'Truck', nombre: 'Camión · estado' },
  { id: 'Zap', nombre: 'Rayo' },
  { id: 'Flame', nombre: 'Llama · motor' },
  { id: 'Waves', nombre: 'Olas · nivel' },
  /* Lucide no tiene neumatico, asi que van los tres que mas se le acercan y
     se elige. LifeBuoy es un aro con cubo y cuatro radios, que es lo mas
     parecido a una rueda; Disc3 son circulos concentricos; Torus es un aro en
     perspectiva. Gauge, mas arriba, seria lo correcto por significado —lo que
     se mide es presion— pero las revoluciones ya llevan CircleGauge y a 14
     pixeles los dos manometros se confunden. */
  { id: 'LifeBuoy', nombre: 'Rueda con radios · aire' },
  { id: 'Disc3', nombre: 'Rueda plana · aire' },
  { id: 'Torus', nombre: 'Aro en perspectiva · aire' },
  { id: 'CircleDot', nombre: 'Punto · genérico' },
  { id: 'Timer', nombre: 'Cronómetro' },
];

/**
 * El icono que le pega a una señal, por su nombre.
 *
 * Es una ayuda para no tener que elegirlos uno a uno la primera vez; siempre
 * se puede cambiar. Si no reconoce nada, no pone ninguno: un icono equivocado
 * confunde mas que la falta de icono.
 */
export const iconoSugerido = (texto: string): string => {
  const t = texto.toLowerCase();
  if (/consumo|caudal|flujo|flow/.test(t)) return 'Droplet';
  if (/nivel|tanque|tank|volumen|combustible|fuel/.test(t)) return 'Fuel';
  if (/rpm|revoluc/.test(t)) return 'CircleGauge';
  if (/temp/.test(t)) return 'Thermometer';
  if (/presi|bar/.test(t)) return 'Gauge';
  if (/volt|bater|tensi/.test(t)) return 'Battery';
  if (/hora|tiempo|horom/.test(t)) return 'Clock';
  if (/carga|load|esfuerzo/.test(t)) return 'Activity';
  if (/tonel|peso|carga util/.test(t)) return 'Weight';
  if (/aire|neumat|rueda|llanta/.test(t)) return 'LifeBuoy';
  if (/estado|status|marcha/.test(t)) return 'Truck';
  return '';
};

export const vista = (id: VistaTarjeta) => VISTAS.find((v) => v.id === id) ?? VISTAS[0];

export const nuevaTarjeta = (v: VistaTarjeta = 'numero'): Tarjeta => ({
  id: `t${Date.now().toString(36)}`,
  titulo: '',
  vista: v,
  claves: [],
  unidad: '',
  decimales: 1,
  min: 0,
  max: 100,
  bajo: null,
  alto: null,
  grande: false,
  icono: '',
  factor: 1,
});

/**
 * Un panel de camion armado de una vez.
 *
 * Montarlo tarjeta a tarjeta la primera vez es tedioso y no enseña de que es
 * capaz esto. Se le pasan las claves que ya han llegado y arma lo que puede:
 * el consumo como resta de los dos caudalimetros, el nivel con su barra, y el
 * resto en numeros. Lo que no encuentra, no lo inventa.
 */
export const panelDeCamion = (claves: string[]): Tarjeta[] => {
  const busca = (...trozos: string[]) =>
    claves.find((c) => trozos.every((t) => c.toLowerCase().includes(t)));

  const tarjetas: Tarjeta[] = [];
  const puesta = new Set<string>();

  const ida = busca('caudal', 'ida');
  const retorno = busca('caudal', 'retorno');
  if (ida && retorno) {
    tarjetas.push({
      ...nuevaTarjeta('diferencia'),
      id: 't-consumo',
      titulo: 'Consumo',
      icono: 'Droplet',
      claves: [ida, retorno],
      unidad: 'gal/h',
      /* El caudalímetro da litros; en la mina se habla en galones. */
      factor: 1 / 3.785,
      decimales: 1,
      grande: true,
    });
    puesta.add(ida).add(retorno);
  }

  const nivel = busca('nivel');
  if (nivel) {
    tarjetas.push({
      ...nuevaTarjeta('tanque'),
      id: 't-nivel',
      titulo: 'Combustible',
      icono: 'Fuel',
      claves: [nivel],
      decimales: 0,
      min: 0,
      max: 400,
      bajo: 60,
      grande: true,
    });
    puesta.add(nivel);
  }

  for (const c of claves) {
    if (puesta.has(c)) continue;
    /* Cada magnitud con la forma que le corresponde: la temperatura en
       termómetro, porque no se piensa como «cuánto de lo que cabe»; las
       revoluciones y las presiones en cuadrante, que es su instrumento de
       toda la vida. El resto, número. */
    const esTermometro = /temp/i.test(c);
    const esAguja = /rpm|revoluc|presi|aire|neumat|rueda/i.test(c);

    tarjetas.push({
      ...nuevaTarjeta(esTermometro ? 'termometro' : esAguja ? 'cuadrante' : 'numero'),
      id: `t-${c}`,
      claves: [c],
      decimales: /rpm|revoluc/i.test(c) ? 0 : 1,
      min: 0,
      max: /rpm|revoluc/i.test(c) ? 2500 : /temp/i.test(c) ? 120 : /aire|presi/i.test(c) ? 10 : 100,
      icono: iconoSugerido(c),
    });
  }

  return tarjetas;
};

/** Lo que la pantalla necesita saber para pintar una tarjeta. */
export interface ValorTarjeta {
  /** El numero ya calculado, o el texto si la vista es de texto. */
  valor: number | string | null;
  unidad: string;
  /** 0 a 1 dentro del rango, para la barra. `null` si la vista no lleva. */
  fraccion: number | null;
  estado: 'ok' | 'bajo' | 'alto' | 'sin';
  /** Cuando el aparato no distingue «cero» de «no disponible». */
  ambiguo: boolean;
  /** De donde sale el resultado. La resta enseña los dos sumandos. */
  partes: { clave: string; nombre: string; valor: number | string | null }[];
  /** Cuando llego el dato mas viejo de los que usa. 0 si nunca llego nada. */
  visto: number;
}

const numero = (s?: Senal): number | null =>
  s && typeof s.valor === 'number' && Number.isFinite(s.valor) ? s.valor : null;

/**
 * Resuelve una tarjeta contra lo ultimo que llego.
 *
 * Si a la tarjeta le falta cualquiera de sus señales, no se inventa nada: el
 * resultado queda en «sin dato». Una resta a la que le falta el sustraendo no
 * es la primera señal, es nada.
 */
export const calcular = (
  t: Tarjeta,
  valores: Map<string, Senal>,
  frescura: Map<string, number>,
): ValorTarjeta => {
  const necesita = vista(t.vista).senales;
  const claves = t.claves.slice(0, necesita);

  const partes = claves.map((c) => {
    const s = valores.get(c);
    return { clave: c, nombre: s?.nombre ?? c.split('.').pop() ?? c, valor: s?.valor ?? null };
  });

  const visto = claves.length
    ? Math.min(...claves.map((c) => frescura.get(c) ?? 0))
    : 0;
  const ambiguo = claves.some((c) => valores.get(c)?.ambiguo === true);
  const unidad = t.unidad || valores.get(claves[0])?.unidad || '';

  const nada: ValorTarjeta = {
    valor: null, unidad, fraccion: null, estado: 'sin', ambiguo, partes, visto,
  };

  if (claves.length < necesita) return nada;

  if (t.vista === 'texto') {
    const s = valores.get(claves[0]);
    if (!s || s.valor === null || s.valor === undefined) return nada;
    return { ...nada, valor: String(s.valor), estado: 'ok' };
  }

  const n = claves.map((c) => numero(valores.get(c)));
  if (n.some((x) => x === null)) return nada;

  let valor: number;
  if (t.vista === 'diferencia') valor = (n[0] as number) - (n[1] as number);
  else if (t.vista === 'suma') valor = (n[0] as number) + (n[1] as number);
  else valor = n[0] as number;

  /* Antes de los umbrales: se compara con lo que el conductor ve. */
  if (t.factor && t.factor !== 1) valor *= t.factor;

  let estado: ValorTarjeta['estado'] = 'ok';
  if (t.bajo !== null && valor < t.bajo) estado = 'bajo';
  else if (t.alto !== null && valor > t.alto) estado = 'alto';

  const fraccion =
    ['nivel', 'tanque', 'cuadrante', 'termometro'].includes(t.vista) && t.max !== t.min
      ? Math.min(1, Math.max(0, (valor - t.min) / (t.max - t.min)))
      : null;

  return { valor, unidad, fraccion, estado, ambiguo, partes, visto };
};

/** El numero ya con sus decimales, listo para pintar. */
export const texto = (v: ValorTarjeta, decimales: number): string => {
  if (v.valor === null) return v.ambiguo ? 'cero o sin dato' : 'sin dato';
  if (typeof v.valor === 'string') return v.valor;
  return v.valor.toFixed(decimales);
};

/**
 * El nombre que se enseña.
 *
 * Si no se puso ninguno se arma con las señales, que es mejor que un hueco: una
 * tarjeta sin titulo sigue diciendo que esta midiendo.
 */
export const titulo = (t: Tarjeta, v: ValorTarjeta): string => {
  if (t.titulo.trim()) return t.titulo.trim();
  if (!v.partes.length) return 'Sin señales';
  if (t.vista === 'diferencia') return `${v.partes[0].nombre} − ${v.partes[1]?.nombre ?? '?'}`;
  if (t.vista === 'suma') return `${v.partes[0].nombre} + ${v.partes[1]?.nombre ?? '?'}`;
  return v.partes[0].nombre;
};
