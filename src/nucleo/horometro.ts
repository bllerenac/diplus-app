/**
 * Horómetro interno de la tablet.
 *
 * Mide el tiempo de operación acumulado mientras la tablet (o motor) permanezca encendida.
 * Permite ingresar un valor inicial (ej. las horas que marcaba el tablero del camión)
 * y va sumando los segundos de encendido de forma persistente.
 *
 * Se guarda periódicamente en almacenamiento local para no perder el progreso
 * ante cualquier reinicio, corte de energía o apagado de la máquina.
 */
import { hardware } from './hardware';
import { senal } from './lecturas';

const CLAVE_STORAGE = 'diplus.horometro';

export interface AjustesHorometro {
  /** Si el horómetro está contando automáticamente mientras la tablet esté encendida */
  activo: boolean;
  /** Valor base inicial (en horas) tomado del tablero del camión */
  valorInicial: number;
  /** Segundos acumulados con la tablet encendida */
  segundosAcumulados: number;
}

export interface HorometroEstado {
  horasTotales: number;
  valorInicial: number;
  horasAcumuladas: number;
  segundosAcumulados: number;
  activo: boolean;
  tiempoTexto: string;
}

export const HOROMETRO_POR_DEFECTO: AjustesHorometro = {
  activo: true,
  valorInicial: 0,
  segundosAcumulados: 0,
};

class Horometro {
  private cfg: AjustesHorometro = { ...HOROMETRO_POR_DEFECTO };
  private timer: ReturnType<typeof setInterval> | null = null;
  private ultimoTick = Date.now();
  private oyentes = new Set<(e: HorometroEstado) => void>();
  private ciclosParaGuardar = 0;

  constructor() {
    this.recuperarDeStorage();
    this.iniciarReloj();
  }

  private recuperarDeStorage() {
    try {
      const guardado = localStorage.getItem(CLAVE_STORAGE);
      if (guardado) {
        const parsed = JSON.parse(guardado);
        if (typeof parsed.valorInicial === 'number') this.cfg.valorInicial = parsed.valorInicial;
        if (typeof parsed.segundosAcumulados === 'number') {
          this.cfg.segundosAcumulados = parsed.segundosAcumulados;
        }
        if (typeof parsed.activo === 'boolean') this.cfg.activo = parsed.activo;
      }
    } catch {
      /* Continuar con valores por defecto si el storage falla */
    }
  }

  private persistir() {
    try {
      localStorage.setItem(CLAVE_STORAGE, JSON.stringify(this.cfg));
    } catch {
      /* Continuar si storage no está disponible */
    }
  }

  private iniciarReloj() {
    if (this.timer) clearInterval(this.timer);
    this.ultimoTick = Date.now();

    this.timer = setInterval(() => {
      const ahora = Date.now();
      // Delta en segundos (con tope de seguridad de 10s para evitar saltos si el SO pausó el proceso)
      const delta = Math.min(10, Math.max(0, (ahora - this.ultimoTick) / 1000));
      this.ultimoTick = ahora;

      if (this.cfg.activo && delta > 0) {
        this.cfg.segundosAcumulados += delta;
      }

      this.inyectarSenal();

      // Guardar en almacenamiento cada 3 segundos o en cambios
      this.ciclosParaGuardar += 1;
      if (this.ciclosParaGuardar >= 3) {
        this.ciclosParaGuardar = 0;
        this.persistir();
      }

      this.notificar();
    }, 1000);

    // Inyección inicial inmediata
    this.inyectarSenal();
  }

  /**
   * Inyecta la lectura como señal de hardware para que esté disponible
   * en toda la aplicación (panel principal, MQTT, lista de señales, etc.).
   */
  private inyectarSenal() {
    const tot = this.horasTotales();
    hardware.inyectar('sistema', 'Tablet', [
      senal('horometro', 'Horómetro de motor', 'h', +tot.toFixed(2)),
    ]);
  }

  private notificar() {
    const est = this.estado();
    this.oyentes.forEach((fn) => fn(est));
  }

  alCambiar(fn: (e: HorometroEstado) => void): () => void {
    this.oyentes.add(fn);
    fn(this.estado());
    return () => {
      this.oyentes.delete(fn);
    };
  }

  aplicar(nuevosAjustes: Partial<AjustesHorometro>) {
    this.cfg = { ...this.cfg, ...nuevosAjustes };
    this.persistir();
    this.inyectarSenal();
    this.notificar();
  }

  /** Horas totales = valorInicial + (segundosAcumulados / 3600) */
  horasTotales(): number {
    return +(this.cfg.valorInicial + this.cfg.segundosAcumulados / 3600).toFixed(2);
  }

  valorInicial(): number {
    return this.cfg.valorInicial;
  }

  horasAcumuladas(): number {
    return +(this.cfg.segundosAcumulados / 3600).toFixed(2);
  }

  segundosAcumulados(): number {
    return Math.floor(this.cfg.segundosAcumulados);
  }

  estaActivo(): boolean {
    return this.cfg.activo;
  }

  setValorInicial(horas: number) {
    this.cfg.valorInicial = Math.max(0, +horas || 0);
    this.persistir();
    this.inyectarSenal();
    this.notificar();
  }

  /**
   * Calibra directamente la lectura actual total al número deseado
   * (por ejemplo, si el mecánico o conductor ajusta con el tablero físico).
   */
  setHorasTotales(horas: number) {
    this.cfg.valorInicial = Math.max(0, +horas || 0);
    this.cfg.segundosAcumulados = 0;
    this.persistir();
    this.inyectarSenal();
    this.notificar();
  }

  reiniciarAcumulado() {
    this.cfg.segundosAcumulados = 0;
    this.persistir();
    this.inyectarSenal();
    this.notificar();
  }

  setActivo(activo: boolean) {
    this.cfg.activo = activo;
    this.persistir();
    this.inyectarSenal();
    this.notificar();
  }

  tiempoFormateado(): string {
    const s = Math.floor(this.cfg.segundosAcumulados);
    const hrs = Math.floor(s / 3600);
    const mins = Math.floor((s % 3600) / 60);
    const segs = s % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${segs}s`;
    if (mins > 0) return `${mins}m ${segs}s`;
    return `${segs}s`;
  }

  estado(): HorometroEstado {
    return {
      horasTotales: this.horasTotales(),
      valorInicial: this.valorInicial(),
      horasAcumuladas: this.horasAcumuladas(),
      segundosAcumulados: this.segundosAcumulados(),
      activo: this.estaActivo(),
      tiempoTexto: this.tiempoFormateado(),
    };
  }

  ajustes(): AjustesHorometro {
    return { ...this.cfg };
  }
}

export const horometro = new Horometro();
