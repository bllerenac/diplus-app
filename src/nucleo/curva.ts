/**
 * Curvas de calibracion: lo que marca el aparato contra lo que mide de verdad.
 *
 * Es la misma idea que en el HelperBox y a proposito: un equipo puede leer el
 * mismo caudalimetro por su cuenta o recibirlo ya corregido de la caja, y la
 * correccion tiene que significar lo mismo en los dos sitios. Si aqui se
 * ajustara un polinomio y alli una recta, el mismo sensor daria dos numeros
 * distintos segun por donde entrara.
 *
 * Un factor unico solo vale si el sensor es lineal, y muchos no lo son: una
 * turbina se queda corta a caudal bajo porque le cuesta arrancar, y un nivel en
 * un tanque que no es un cilindro perfecto tiene la no linealidad en la forma
 * del tanque. Corregir eso con un solo numero es elegir en que punto aciertas y
 * fallar en los demas.
 */
export interface Punto {
  /** Lo que marcaba el aparato. */
  crudo: number;
  /** Lo que medía la referencia en ese momento. */
  real: number;
}

/** Las curvas del equipo, por clave completa de señal (`fuente.senal`). */
export type Calibraciones = Record<string, Punto[]>;

/**
 * Deja los puntos usables: numeros, en orden y sin dos con el mismo crudo.
 *
 * Se ordena porque la busqueda del tramo lo da por hecho, y quien los teclea lo
 * hace en el orden en que tomo las medidas, que no tiene por que ser creciente.
 */
export const ordenar = (puntos: Punto[] | undefined): Punto[] => {
  if (!Array.isArray(puntos)) return [];

  const limpios = puntos
    .map((p) => ({ crudo: Number(p?.crudo), real: Number(p?.real) }))
    .filter((p) => Number.isFinite(p.crudo) && Number.isFinite(p.real))
    .sort((a, b) => a.crudo - b.crudo);

  /* Dos puntos con el mismo crudo dejarian el tramo con pendiente infinita. Se
     queda el ultimo, que es lo que hace cualquiera al recalibrar un punto sin
     borrar antes el viejo. */
  return limpios.filter((p, i) => i === limpios.length - 1 || p.crudo !== limpios[i + 1].crudo);
};

/**
 * El valor corregido.
 *
 * Con menos de dos puntos no hay curva y se devuelve lo que entro: media
 * calibracion es peor que ninguna, porque parece que esta calibrado.
 *
 * Fuera del rango medido no se extrapola, se sigue con el valor del extremo. Es
 * mas honesto: si el sensor se sale de lo que alguien comprobo, lo que se lee se
 * queda clavado y eso se nota. Una extrapolacion daria un numero plausible que
 * nadie ha verificado nunca.
 */
export const aplicar = (puntos: Punto[] | undefined, valor: number): number => {
  if (!Number.isFinite(valor)) return valor;

  const p = ordenar(puntos);
  if (p.length < 2) return valor;

  if (valor <= p[0].crudo) return p[0].real;
  if (valor >= p[p.length - 1].crudo) return p[p.length - 1].real;

  for (let i = 0; i < p.length - 1; i += 1) {
    const a = p[i];
    const b = p[i + 1];
    if (valor <= b.crudo) {
      const t = (valor - a.crudo) / (b.crudo - a.crudo);
      return a.real + t * (b.real - a.real);
    }
  }

  return valor;
};

/** Que le pasa a una curva, para poder avisarlo en la pantalla. */
export const revisar = (puntos: Punto[] | undefined): string | null => {
  if (!puntos?.length) return null;

  const p = ordenar(puntos);
  if (p.length < 2) return 'Hacen falta al menos dos puntos para que la curva haga algo.';

  /* Una curva que baja deja de ser util: dos lecturas distintas darian el mismo
     valor real, o al reves. Casi siempre es un punto mal tecleado. */
  for (let i = 0; i < p.length - 1; i += 1) {
    if (p[i + 1].real < p[i].real) {
      return `Entre ${p[i].crudo} y ${p[i + 1].crudo} el valor real baja. Revisa esos dos puntos.`;
    }
  }
  return null;
};
