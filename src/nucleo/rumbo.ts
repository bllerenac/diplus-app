/**
 * Hacia dónde mira el mapa, y cuándo tiene derecho a moverse.
 *
 * El rumbo del receptor es **rumbo sobre el terreno**: la dirección entre dos
 * posiciones seguidas. Eso tiene dos consecuencias que se ven en cabina y que
 * este módulo existe para tapar.
 *
 * **Parado no significa nada.** Sin movimiento no hay dos posiciones que
 * comparar: el receptor devuelve cero, o el último valor, o ruido. Antes el
 * mapa giraba solo con el camión detenido en la cola de la pala, que es de las
 * cosas que más desconfianza dan en un aparato. Por eso hay un mínimo de
 * velocidad, y con **dos umbrales y no uno**: con uno solo, un camión que
 * oscila alrededor del límite engancha y suelta el giro sin parar, que es peor
 * que cualquiera de las dos cosas por separado.
 *
 * **Y da tirones.** Aun en marcha el rumbo llega con ruido, y el mapa lo
 * perseguía entero. Se promedia con lo anterior para que los tirones se queden
 * en el filtro y las curvas de verdad pasen.
 *
 * Lo que **no** hay aquí es un tope de grados por segundo. La animación ya la
 * hace el navegador —medio segundo de transición sobre el lienzo— y ponerle
 * ademas un tope propio serían dos frenos peleándose, con el mapa llegando
 * tarde a las curvas sin que se sepa cuál de los dos lo retrasa.
 *
 * Lo que sigue sin tener solución desde el GPS es la marcha atrás: el rumbo
 * apunta a donde se va, así que retrocediendo el mapa se da la vuelta. No hay
 * forma de distinguirlo de haberse dado la vuelta de verdad. Con el mínimo
 * apenas se nota, porque retroceder a la descarga se hace despacio.
 */

export interface AjustesRumbo {
  /** Por debajo de esto el mapa se queda quieto, en m/s. */
  minima: number;
  /** Y no vuelve a girar hasta pasar de esta, en m/s. */
  suelta: number;
  /** Cuánto pesa lo anterior, de 0 —nada— a 0,9 —mucho—. */
  suavizado: number;
}

export const RUMBO_POR_DEFECTO: AjustesRumbo = {
  /* 1,5 m/s son 5,4 km/h: por debajo de eso un volquete está maniobrando o
     parado, y su rumbo no dice nada. Suelta a 2,5 —9 km/h— para que haya un
     margen ancho entre los dos y no se encienda y apague solo. */
  minima: 1.5,
  suelta: 2.5,
  suavizado: 0.55,
};

/** La vuelta corta entre dos rumbos: de 350 a 10 son 20 grados, no −340. */
export const corto = (grados: number): number => {
  let d = grados % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
};

const enVuelta = (grados: number): number => ((grados % 360) + 360) % 360;

export class Rumbo {
  private cfg: AjustesRumbo = RUMBO_POR_DEFECTO;
  private mostrado: number | null = null;
  private girando = false;

  aplicar(cfg: AjustesRumbo) {
    this.cfg = cfg;
  }

  /** Como si el equipo acabara de encenderse. Para las pruebas y la maqueta. */
  reiniciar() {
    this.mostrado = null;
    this.girando = false;
  }

  /** Si el mapa está girando con la marcha o congelado por ir despacio. */
  vivo(): boolean {
    return this.girando;
  }

  /**
   * El rumbo que debe enseñar el mapa, o `null` si no hay que tocarlo.
   *
   * Devolver `null` y no el valor de antes es a propósito: quien llama no tiene
   * que saber si el mapa se quedó quieto porque no hay dato o porque no toca, y
   * escribir el mismo ángulo otra vez reinicia la transición del navegador cada
   * segundo para nada.
   */
  siguiente(rumbo: number, velocidad: number): number | null {
    const c = this.cfg;

    if (this.girando) {
      if (velocidad < c.minima) this.girando = false;
    } else if (velocidad > c.suelta) {
      this.girando = true;
    }

    if (!this.girando) return null;

    /* La primera vez se adopta tal cual. Suavizarla haría que el mapa llegara
       arrastrándose desde el norte hasta el rumbo bueno, y eso al arrancar se
       lee como que el aparato no sabe dónde está. */
    if (this.mostrado === null) {
      this.mostrado = enVuelta(rumbo);
      return this.mostrado;
    }

    const peso = Math.min(0.9, Math.max(0, c.suavizado));
    this.mostrado = enVuelta(this.mostrado + corto(rumbo - this.mostrado) * (1 - peso));
    return this.mostrado;
  }
}

export const rumbo = new Rumbo();
