/**
 * Qué hace el camión, leído de la unidad inercial que el equipo ya lleva dentro.
 *
 * Esto no depende de ningún cable ni de que el camión hable ningún protocolo:
 * el MPU6500 está dentro del aparato y funciona siempre. Da tres cosas que hoy
 * no se saben de otra forma:
 *
 * **Cómo está inclinado.** El ángulo real del chasis, que en una rampa de mina
 * es seguridad y además explica el consumo: los mismos galones por hora en una
 * subida del 10 % y en llano no significan lo mismo.
 *
 * **Cómo se conduce.** Frenazos y acelerones se ven directamente en el eje de
 * avance, sin necesidad del bus del vehículo.
 *
 * **Cómo está la vía.** La vibración vertical acumulada es una medida del
 * estado del camino. Eso es lo que luego permite cruzar baches con consumo y
 * decir si una rampa mal mantenida está costando combustible.
 *
 * ─── Por qué hay que calibrar ────────────────────────────────────────────────
 *
 * El acelerómetro no sabe cómo está montado el aparato. Según la posición, la
 * gravedad cae sobre un eje o sobre otro, y «hacia adelante» puede ser la X en
 * un camión y la Y en el siguiente. Sin decirle cuál es el suelo y cuál es la
 * marcha, los números no significan nada. Por eso se calibra con el camión
 * parado y en llano: eso fija la referencia, y todo lo demás se mide contra
 * ella.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';
import { Senal, senal } from './lecturas';
import { hardware } from './hardware';

interface Crudo {
  ax: number; ay: number; az: number;
  gx: number; gy: number; gz: number;
  at: number;
}

interface PluginMovimiento {
  arrancar(o: { cadaMs: number }): Promise<void>;
  parar(): Promise<void>;
  queHay(): Promise<{
    acelerometro: boolean; nombre: string; maxHz: number;
    giroscopo: boolean; brujula: boolean; barometro: boolean;
  }>;
  addListener(e: 'onMovimiento', fn: (d: Crudo) => void): Promise<{ remove: () => void }>;
}

const Nativo = registerPlugin<PluginMovimiento>('Movimiento');

export type Eje = 'x' | 'y' | 'z';

/** En ejes del equipo: X derecha, Y arriba de la pantalla, Z sale de la pantalla. */
export type V3 = [number, number, number];

export interface Postura {
  /** Hacia dónde queda el morro del camión. */
  frente: V3;
  /** Hacia dónde queda su techo. */
  techo: V3;
}

export interface AjustesMovimiento {
  activo: boolean;
  /** Cada cuánto se publica una lectura. Más rápido ve golpes más cortos. */
  cadaMs: number;
  frente?: V3;
  techo?: V3;
  /** De antes, cuando solo había seis posturas; se leen si falta frente. */
  ejeAvance?: Eje;
  avanceInvertido?: boolean;
  /** La gravedad medida con el camión parado y en llano. Es la referencia. */
  ref: { x: number; y: number; z: number } | null;
  /** A partir de cuánto se considera una frenada brusca, en m/s². */
  umbralFrenada: number;
  /** A partir de cuánto se cuenta un bache, en m/s². */
  umbralBache: number;
  /** Vibración por encima de la cual se da el motor por encendido, en m/s². */
  umbralMotor: number;
}

export const MOVIMIENTO_POR_DEFECTO: AjustesMovimiento = {
  activo: false,
  cadaMs: 100,
  frente: [0, 1, 0],
  techo: [0, 0, 1],
  ref: null,
  /* 3 m/s² son unos 0,3 g: una frenada que se nota pero no es de emergencia.
     Se deja bajo a propósito, que subirlo es fácil y bajarlo nadie lo hace. */
  umbralFrenada: 3,
  umbralBache: 4,
  umbralMotor: 0.15,
};

const G = 9.80665;

/** Cuántas muestras entran en la ventana de vibración. */
const VENTANA = 50;

const modulo = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

const punto = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unidad = (v: V3): V3 => {
  const m = modulo(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
};
/** `v` sin su parte a lo largo de `u`, que tiene que ser unitario. */
const sinParte = (v: V3, u: V3): V3 => {
  const d = punto(v, u);
  return [v[0] - u[0] * d, v[1] - u[1] * d, v[2] - u[2] * d];
};
export const cruz = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Giro de `v` alrededor del eje unitario `k` (Rodrigues). */
const rotar = (v: V3, k: V3, rad: number): V3 => {
  const c = Math.cos(rad), s = Math.sin(rad), kv = cruz(k, v), d = punto(k, v) * (1 - c);
  return [
    v[0] * c + kv[0] * s + k[0] * d,
    v[1] * c + kv[1] * s + k[1] * d,
    v[2] * c + kv[2] * s + k[2] * d,
  ];
};

/** Que sigan siendo perpendiculares y de largo uno tras muchos giros. */
const ortonormal = (frente: V3, techo: V3): Postura => {
  const t = unidad(techo);
  return { frente: unidad(sinParte(frente, t)), techo: t };
};

/** La postura guardada. Las configuraciones viejas solo traen eje y signo. */
export const posturaDe = (c: AjustesMovimiento): Postura => {
  if (c.frente && c.techo) return { frente: c.frente, techo: c.techo };
  const e = c.ejeAvance ?? 'y';
  const s = c.avanceInvertido ? -1 : 1;
  return {
    frente: [e === 'x' ? s : 0, e === 'y' ? s : 0, e === 'z' ? s : 0],
    techo: e === 'z' ? [0, 1, 0] : [0, 0, 1],
  };
};

/**
 * Gira el equipo sobre la vertical del camión; positivo es contra el reloj
 * visto desde arriba. El frente va en ejes del equipo, así que gira al revés.
 */
export const girarPostura = (p: Postura, grados: number): Postura =>
  ortonormal(rotar(p.frente, p.techo, (-grados * Math.PI) / 180), p.techo);

/** Para el equipo sobre su borde de abajo: positivo levanta el de arriba. */
export const pararPostura = (p: Postura, grados: number): Postura => {
  const x: V3 = [1, 0, 0], rad = (-grados * Math.PI) / 180;
  return ortonormal(rotar(p.frente, x, rad), rotar(p.techo, x, rad));
};

/** La misma postura con el techo donde dice la gravedad; el frente gira con él. */
export const conTecho = (p: Postura, gravedad: V3): Postura => {
  const t = unidad(gravedad);
  const eje = cruz(p.techo, t);
  const s = modulo(eje[0], eje[1], eje[2]);
  const c = punto(p.techo, t);
  /* Mismo techo o volteado del todo: el frente no se mueve. */
  if (s < 1e-6) return { frente: p.frente, techo: t };
  return ortonormal(rotar(p.frente, unidad(eje), Math.atan2(s, c)), t);
};

/**
 * El frente medido acelerando: lo que se apartó de la referencia, en el plano
 * del piso. Null si fue tan poco que es ruido.
 */
export const frenteMedido = (media: V3, ref: V3): Postura | null => {
  const t = unidad(ref);
  const f = sinParte(media, t);
  return modulo(f[0], f[1], f[2]) < 0.6 ? null : { frente: unidad(f), techo: t };
};

/**
 * La aceleración en la marcha. El frente se aplana sobre el piso de la
 * referencia, así una cuesta o un bache no se cuelan aunque el equipo vaya
 * inclinado.
 */
export const avanceDe = (a: V3, ref: V3 | null, frente: V3): number => {
  if (!ref) return punto(a, frente);
  const plano = sinParte(frente, unidad(ref));
  const f = modulo(plano[0], plano[1], plano[2]) < 0.2 ? frente : unidad(plano);
  return punto([a[0] - ref[0], a[1] - ref[1], a[2] - ref[2]], f);
};

/** Cómo queda el equipo, en palabras, y a cuántos grados del piso va la pantalla. */
export const comoEsta = (p: Postura): { nombre: string; grados: number } => {
  const a = (Math.acos(Math.min(1, Math.max(-1, p.techo[2]))) * 180) / Math.PI;
  const grados = Math.round(Math.min(a, 180 - a));
  const [x, y] = p.techo;
  const nombre =
    a <= 15 ? 'Tumbada'
      : a >= 165 ? 'Boca abajo'
        : Math.abs(a - 90) > 15 ? 'Inclinada'
          : Math.abs(y) < Math.abs(x) ? 'De lado'
            : y > 0 ? 'De pie' : 'De pie, al revés';
  return { nombre, grados };
};

/**
 * El ángulo entre cómo está ahora y cómo estaba al calibrar.
 *
 * Se saca del vector gravedad y no del giróscopo: el giróscopo deriva con el
 * tiempo y en un turno de doce horas acaba mintiendo, mientras que la gravedad
 * siempre apunta al mismo sitio.
 */
const anguloEntre = (a: number[], b: number[]): number => {
  const ma = modulo(a[0], a[1], a[2]);
  const mb = modulo(b[0], b[1], b[2]);
  if (ma < 0.001 || mb < 0.001) return 0;
  const cos = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (ma * mb);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
};

/**
 * La vibración, dicha en palabras.
 *
 * Un número en m/s² no le dice nada a quien conduce ni a quien lee el informe.
 * Los cortes son gruesos a propósito: hasta que no se contrasten con vías
 * reales, afinar los límites sería darles una precisión que no tienen.
 */
export const estadoDeVia = (vibracion: number): string => {
  if (vibracion < 0.4) return 'Buena';
  if (vibracion < 1.2) return 'Regular';
  if (vibracion < 2.5) return 'Mala';
  return 'Muy mala';
};

class Movimiento {
  private quitar: { remove: () => void } | null = null;
  private cfg: AjustesMovimiento = MOVIMIENTO_POR_DEFECTO;

  private ventana: number[] = [];
  private ultimo: Crudo | null = null;
  private baches = 0;
  private frenadas = 0;
  private picoFrenada = 0;

  hay = () => Capacitor.isNativePlatform();

  /** Lo último medido en crudo, para la pantalla de calibración. */
  crudo(): Crudo | null {
    return this.ultimo;
  }

  queHay() {
    return Nativo.queHay();
  }

  /** La gravedad de ahora, para guardarla como referencia al calibrar. */
  referenciaDeAhora(): { x: number; y: number; z: number } | null {
    const u = this.ultimo;
    return u ? { x: u.ax, y: u.ay, z: u.az } : null;
  }

  reiniciarCuentas() {
    this.baches = 0;
    this.frenadas = 0;
    this.picoFrenada = 0;
  }

  async aplicar(cfg: AjustesMovimiento, alLeer?: (s: Senal[]) => void) {
    this.cfg = cfg;
    if (!this.hay()) return;

    if (!cfg.activo) {
      this.quitar?.remove();
      this.quitar = null;
      await Nativo.parar().catch(() => undefined);
      return;
    }

    if (!this.quitar) {
      this.quitar = await Nativo.addListener('onMovimiento', (d) => {
        this.ultimo = d;
        const s = this.calcular(d);

        /* Se inyecta aquí y no en la pantalla principal. Estaba allí y solo
           funcionaba con esa pantalla abierta: al entrar en Configuración se
           dejaban de publicar las señales, y desde fuera el equipo parecía no
           estar midiendo nada. Lo que mide el equipo no puede depender de lo
           que esté mirando quien lo lleva. */
        hardware.inyectar('imu', 'Movimiento', s);
        alLeer?.(s);
      });
    }
    await Nativo.arrancar({ cadaMs: cfg.cadaMs }).catch(() => undefined);
  }

  private calcular(d: Crudo): Senal[] {
    const c = this.cfg;
    const ahora = [d.ax, d.ay, d.az];

    /* Sin referencia no se puede decir qué es estar derecho, así que la
       inclinación se da como desconocida en vez de inventarse un cero. */
    const inclinacion = c.ref ? anguloEntre(ahora, [c.ref.x, c.ref.y, c.ref.z]) : null;

    const avance = avanceDe(
      [d.ax, d.ay, d.az], c.ref ? [c.ref.x, c.ref.y, c.ref.z] : null, posturaDe(c).frente,
    );

    /* La vibración es cuánto se aparta el módulo de la gravedad: da igual cómo
       esté montado el aparato y da igual la cuesta, solo mide sacudidas. */
    const desvio = Math.abs(modulo(d.ax, d.ay, d.az) - G);
    this.ventana.push(desvio);
    if (this.ventana.length > VENTANA) this.ventana.shift();

    const vibracion = Math.sqrt(
      this.ventana.reduce((s, v) => s + v * v, 0) / Math.max(1, this.ventana.length),
    );

    if (desvio > c.umbralBache) this.baches += 1;
    if (avance < -c.umbralFrenada) {
      this.frenadas += 1;
      this.picoFrenada = Math.max(this.picoFrenada, -avance);
    }

    /* El giróscopo sí vale para el balanceo instantáneo: no se acumula, se lee
       la velocidad de giro del momento. */
    const giro = (modulo(d.gx, d.gy, d.gz) * 180) / Math.PI;

    return [
      senal('inclinacion', 'Inclinación', '°',
        inclinacion === null ? null : Number(inclinacion.toFixed(1))),
      senal('aceleracion', 'Aceleración', 'm/s²', Number(avance.toFixed(2))),
      senal('vibracion', 'Vibración', 'm/s²', Number(vibracion.toFixed(2))),
      senal('via', 'Estado de la vía', '', estadoDeVia(vibracion)),
      senal('baches', 'Baches', '', this.baches),
      senal('frenadas', 'Frenadas bruscas', '', this.frenadas),
      senal('pico_frenada', 'Frenada más fuerte', 'm/s²', Number(this.picoFrenada.toFixed(2))),
      senal('giro', 'Giro', '°/s', Number(giro.toFixed(1))),
      senal('motor', 'Motor', '', vibracion > c.umbralMotor ? 'Encendido' : 'Parado'),
    ];
  }
}

export const movimiento = new Movimiento();
