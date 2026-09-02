/**
 * Lo que baja a la base, y cada cuanto.
 *
 * El reloj manda sobre el guardado, no el bus. Una trama solo refresca el valor
 * en memoria; es este temporizador el que decide cuando se escribe. Es la misma
 * regla que en el HelperBox y por el mismo motivo: un caudalimetro manda varias
 * tramas por segundo y guardarlas todas llena el almacen sin aportar nada.
 *
 * Cada muestra se guarda con la posicion del momento. Un consumo sin saber
 * donde se produjo sirve para la mitad de las preguntas.
 */
import { podar, guardarLecturas } from './base';
import { gps } from './gps';
import { hardware } from './hardware';

export interface AjustesRegistro {
  activo: boolean;
  cadaMs: number;
  retencionHoras: number;
  /** Claves a guardar. Vacio = todo lo que llegue. */
  claves: string[];
}

class Registro {
  private timer: ReturnType<typeof setInterval> | null = null;
  private podador: ReturnType<typeof setInterval> | null = null;
  private ajustes: AjustesRegistro = {
    activo: false,
    cadaMs: 5000,
    retencionHoras: 72,
    claves: [],
  };
  private guardadas = 0;
  private ultimoError: string | null = null;

  aplicar(a: AjustesRegistro) {
    this.ajustes = a;
    this.parar();
    if (!a.activo) return;

    this.timer = setInterval(() => this.tomarMuestra(), Math.max(500, a.cadaMs));
    /* La poda cada media hora: con hacerlo de vez en cuando basta, y no vale la
       pena mirar el reloj mas a menudo para borrar lo de hace tres dias. */
    this.podador = setInterval(() => this.podarAhora(), 30 * 60_000);
  }

  private async tomarMuestra() {
    const senales = hardware.senales();
    if (!senales.length) return;

    const elegidas = this.ajustes.claves.length
      ? senales.filter((s) => this.ajustes.claves.includes(s.clave))
      : senales;
    if (!elegidas.length) return;

    const at = Date.now();
    const p = gps.posicion();

    const filas = elegidas.map((s) => ({
      clave: s.clave,
      valor: typeof s.valor === 'number' ? s.valor : null,
      texto: typeof s.valor === 'string' ? s.valor : null,
      at,
      ...(p ? { lat: p.lat, lon: p.lon } : {}),
    }));

    try {
      this.guardadas += await guardarLecturas(filas);
      this.ultimoError = null;
    } catch (e: unknown) {
      /* Si el almacen se lleno o el navegador lo bloqueo, se anota y se sigue:
         perder una muestra no puede tumbar la lectura del bus. */
      this.ultimoError = e instanceof Error ? e.message : 'no se pudo guardar';
    }
  }

  async podarAhora(): Promise<number> {
    try {
      return await podar(this.ajustes.retencionHoras);
    } catch {
      return 0;
    }
  }

  estado() {
    return {
      activo: this.timer !== null,
      guardadas: this.guardadas,
      error: this.ultimoError,
    };
  }

  parar() {
    if (this.timer) clearInterval(this.timer);
    if (this.podador) clearInterval(this.podador);
    this.timer = null;
    this.podador = null;
  }
}

export const registro = new Registro();
