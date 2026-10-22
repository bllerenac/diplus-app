/**
 * La pala dibujada, moviéndose con lo que miden los beacons.
 *
 * Es un dibujo vectorial, no una foto: a esta distancia y con la máquina
 * sacudiéndose, una silueta limpia se lee de un vistazo y la textura de un
 * modelo escaneado solo ensucia. Además escala sin perder nitidez y toma los
 * colores del tema.
 *
 * Nada de WebGL: el WebView de estas tablets cuelga la GPU con él. Esto es
 * SVG, que se rasteriza en una sola capa y no deja costuras al girar.
 *
 * De perfil se ven la pluma y el brazo; desde arriba, el giro de la tornamesa.
 */
import './PalaDibujo.css';

/** Dónde pivota cada pieza en el dibujo de perfil. */
const PIVOTE_PLUMA = { x: 218, y: 186 };
const PIVOTE_BRAZO = { x: 95, y: 98 };

/** Tope de giro en pantalla, para que nada se salga del cuadro. */
const TOPE = 38;
const limitar = (g: number) => Math.max(-TOPE, Math.min(TOPE, g));

const giroEn = (grados: number, p: { x: number; y: number }) =>
  `rotate(${limitar(grados).toFixed(1)} ${p.x} ${p.y})`;

export const PalaPerfil = ({
  pluma = 0, brazo = 0, inclinacion = 0,
}: {
  pluma?: number;
  brazo?: number;
  inclinacion?: number;
}) => (
  <svg viewBox="0 0 430 250" className="pdib-svg" role="img" aria-label="La pala vista de perfil">
    {/* Suelo */}
    <line x1="18" y1="232" x2="412" y2="232" className="pdib-suelo" />

    <g transform={`rotate(${limitar(inclinacion).toFixed(1)} 250 228)`}>
      {/* Orugas */}
      <rect x="175" y="196" width="195" height="34" rx="17" className="pdib-oruga" />
      <circle cx="200" cy="213" r="7" className="pdib-rueda" />
      <circle cx="345" cy="213" r="7" className="pdib-rueda" />
      <line x1="216" y1="213" x2="329" y2="213" className="pdib-riel" />

      {/* Superestructura y contrapeso */}
      <path d="M205 196 L205 141 L330 141 L368 153 L372 196 Z" className="pdib-casa" />
      {/* Cabina */}
      <path d="M213 141 L213 100 L251 100 L259 113 L259 141 Z" className="pdib-cabina" />
      <path d="M219 137 L219 106 L245 106 L251 118 L251 137 Z" className="pdib-vidrio" />
      {/* Escape */}
      <rect x="300" y="128" width="9" height="14" rx="2" className="pdib-detalle" />

      {/* Pluma, y dentro de ella el brazo: al subir la pluma, el brazo la acompaña */}
      <g transform={giroEn(pluma, PIVOTE_PLUMA)}>
        <path d="M206 198 L86 106 L100 86 L234 174 Z" className="pdib-pluma" />
        <circle cx={PIVOTE_PLUMA.x} cy={PIVOTE_PLUMA.y} r="9" className="pdib-pasador" />
        {/* Cilindro de la pluma */}
        <line x1="262" y1="176" x2="186" y2="130" className="pdib-cilindro" />
        <line x1="224" y1="153" x2="186" y2="130" className="pdib-vastago" />

        <g transform={giroEn(brazo, PIVOTE_BRAZO)}>
          <path d="M82 90 L110 98 L126 172 L98 180 Z" className="pdib-brazo" />
          <circle cx={PIVOTE_BRAZO.x} cy={PIVOTE_BRAZO.y} r="8" className="pdib-pasador" />
          {/* Cucharón de frente, como una pala de empuje */}
          <path d="M98 180 L126 172 L136 210 L92 218 L80 198 Z" className="pdib-cuchara" />
          <path d="M92 218 L136 210" className="pdib-dientes" />
        </g>
      </g>
    </g>
  </svg>
);

/**
 * La misma máquina desde arriba.
 *
 * Las orugas se quedan quietas y gira la tornamesa, que es lo que hace la
 * pala de verdad: el tren de rodaje apunta a donde se trasladó por última vez.
 */
export const PalaDesdeArriba = ({ giro = 0 }: { giro?: number }) => (
  <svg viewBox="0 0 160 160" className="pdib-svg" role="img" aria-label="La pala vista desde arriba">
    {/* Orugas, fijas */}
    <rect x="36" y="26" width="24" height="108" rx="11" className="pdib-oruga" />
    <rect x="100" y="26" width="24" height="108" rx="11" className="pdib-oruga" />

    <g transform={`rotate(${(giro % 360).toFixed(1)} 80 80)`}>
      {/* Tornamesa */}
      <circle cx="80" cy="80" r="30" className="pdib-tornamesa" />
      <rect x="62" y="62" width="48" height="36" rx="6" className="pdib-casa" />
      {/* Pluma, que marca hacia dónde mira */}
      <path d="M74 62 L86 62 L84 14 L76 14 Z" className="pdib-pluma" />
      <path d="M70 20 L90 20 L92 6 L68 6 Z" className="pdib-cuchara" />
      <circle cx="80" cy="80" r="5" className="pdib-pasador" />
    </g>
  </svg>
);
