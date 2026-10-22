/**
 * La pala de perfil, girando con los ángulos medidos.
 *
 * El modelo 3D se renderizó una vez fuera del equipo, una imagen por pieza.
 * Aquí no hay 3D ninguno: se dibujan las tres imágenes en un canvas y se las
 * gira. El WebView de estas tablets cuelga la GPU con WebGL, y rotando capas
 * con CSS su driver pintaba costuras blancas por toda la pantalla; en un solo
 * canvas hay una sola superficie y no hay nada que componer.
 *
 * El brazo gira dentro del giro de la pluma, como en la máquina de verdad: al
 * subir la pluma, el brazo la acompaña y además gira lo suyo.
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import base from './capa-base.webp';
import capaPluma from './capa-pluma.webp';
import capaBrazo from './capa-brazo.webp';
import './PalaDibujo.css';

/** Proporción del render, para reservar el hueco antes de dibujar. */
const ANCHO = 1500;
const ALTO = 938;

/** Dónde pivota cada pieza, en fracción de la imagen. Sale de buscar los
 *  vértices más cercanos entre una pieza y la siguiente en el modelo. */
const PIVOTE_PLUMA = { x: 0.5202, y: 0.8805 };
const PIVOTE_BRAZO = { x: 0.2996, y: 0.5296 };
/** La máquina entera se ladea sobre el suelo, entre las orugas. */
const APOYO = { x: 0.52, y: 0.95 };

/** Tope de giro en pantalla, para que ninguna pieza se salga del cuadro. */
const TOPE = 34;
const limitar = (g: number) => Math.max(-TOPE, Math.min(TOPE, g));
const aRadianes = (g: number) => (limitar(g) * Math.PI) / 180;

const cargar = (src: string) =>
  new Promise<HTMLImageElement>((ok, mal) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = mal;
    i.src = src;
  });

export const PalaDibujo = ({
  pluma = 0, brazo = 0, inclinacion = 0, children, className = '',
}: {
  /** Grados de la pluma respecto de su postura de calibración. */
  pluma?: number;
  /** Grados del brazo, los suyos propios. */
  brazo?: number;
  /** Inclinación de la máquina: ladea el conjunto. */
  inclinacion?: number;
  /** Marcadores u otra cosa que vaya encima del dibujo. */
  children?: ReactNode;
  className?: string;
}) => {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const piezas = useRef<HTMLImageElement[] | null>(null);
  const [listo, setListo] = useState(false);

  useEffect(() => {
    let vivo = true;
    Promise.all([cargar(base), cargar(capaPluma), cargar(capaBrazo)])
      .then((imgs) => { if (vivo) { piezas.current = imgs; setListo(true); } })
      .catch(() => undefined);
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    const c = lienzo.current;
    const imgs = piezas.current;
    if (!listo || !c || !imgs) return;

    /* El lienzo se dimensiona al hueco real para que no salga borroso. */
    const ancho = c.clientWidth;
    if (!ancho) return;
    const alto = Math.round((ancho * ALTO) / ANCHO);
    const escala = Math.min(2, window.devicePixelRatio || 1);
    if (c.width !== Math.round(ancho * escala)) {
      c.width = Math.round(ancho * escala);
      c.height = Math.round(alto * escala);
    }

    const g = c.getContext('2d');
    if (!g) return;
    g.setTransform(escala, 0, 0, escala, 0, 0);
    g.clearRect(0, 0, ancho, alto);

    const girar = (p: { x: number; y: number }, grados: number) => {
      g.translate(p.x * ancho, p.y * alto);
      g.rotate(aRadianes(grados));
      g.translate(-p.x * ancho, -p.y * alto);
    };

    g.save();
    girar(APOYO, inclinacion);
    g.drawImage(imgs[0], 0, 0, ancho, alto);

    g.save();
    girar(PIVOTE_PLUMA, pluma);
    g.drawImage(imgs[1], 0, 0, ancho, alto);

    g.save();
    girar(PIVOTE_BRAZO, brazo);
    g.drawImage(imgs[2], 0, 0, ancho, alto);

    g.restore();
    g.restore();
    g.restore();
  }, [listo, pluma, brazo, inclinacion]);

  return (
    <div className={`pdib ${className}`}>
      <canvas ref={lienzo} className="pdib-lienzo" />
      {children}
    </div>
  );
};
