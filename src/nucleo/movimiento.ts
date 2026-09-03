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

export interface AjustesMovimiento {
  activo: boolean;
  /** Cada cuánto se publica una lectura. Más rápido ve golpes más cortos. */
  cadaMs: number;
  /** Cuál de los tres ejes apunta hacia adelante, y en qué sentido. */
  ejeAvance: Eje;
  avanceInvertido: boolean;
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
  ejeAvance: 'y',
  avanceInvertido: false,
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

    /* La componente en el eje de marcha, quitándole lo que de la gravedad cae
       sobre ese eje: si no, una cuesta parecería una aceleración constante. */
    const idx = c.ejeAvance === 'x' ? 0 : c.ejeAvance === 'y' ? 1 : 2;
    const refEje = c.ref ? [c.ref.x, c.ref.y, c.ref.z][idx] : 0;
    let avance = ahora[idx] - refEje;
    if (c.avanceInvertido) avance = -avance;

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
