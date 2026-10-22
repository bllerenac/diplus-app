/**
 * La pala dibujada, moviéndose con lo que miden los beacons.
 *
 * Es un Komatsu PC8000 de frente, que es la máquina de la mina. Va dibujada y
 * no fotografiada: a tres metros y con el equipo sacudiéndose lo que se lee es
 * la silueta, y la textura de un modelo escaneado solo ensucia. Además escala
 * sin perder nitidez.
 *
 * Nada de WebGL: el WebView de estas tablets cuelga la GPU con él. Esto es
 * SVG, que se rasteriza en una sola capa y no deja costuras al girar.
 */
import './PalaDibujo.css';

/** Dónde pivota cada pieza en el dibujo de perfil. */
const PIVOTE_PLUMA = { x: 214, y: 192 };
const PIVOTE_BRAZO = { x: 84, y: 104 };

/** Tope de giro en pantalla, para que nada se salga del cuadro. */
const TOPE = 34;
const limitar = (g: number) => Math.max(-TOPE, Math.min(TOPE, g));

const giroEn = (grados: number, p: { x: number; y: number }) =>
  `rotate(${limitar(grados).toFixed(1)} ${p.x} ${p.y})`;

/** Los dientes del cucharón, repartidos por su borde. */
const DIENTES = [0, 1, 2, 3].map((i) => {
  const t = 0.14 + i * 0.24;
  return { x1: 70 + t * 52, y1: 228 - t * 6, x2: 66 + t * 52, y2: 240 - t * 6 };
});

export const PalaPerfil = ({
  pluma = 0, brazo = 0, inclinacion = 0,
}: {
  pluma?: number;
  brazo?: number;
  inclinacion?: number;
}) => (
  <svg viewBox="0 0 440 268" className="pdib-svg" role="img" aria-label="La pala vista de perfil">
    <line x1="14" y1="250" x2="426" y2="250" className="pdib-suelo" />

    <g transform={`rotate(${limitar(inclinacion).toFixed(1)} 250 244)`}>
      {/* ── Tren de rodaje ─────────────────────────────────────────── */}
      <rect x="152" y="206" width="246" height="42" rx="21" className="pdib-oruga" />
      <circle cx="178" cy="227" r="15" className="pdib-rueda" />
      <circle cx="372" cy="227" r="15" className="pdib-rueda" />
      <circle cx="178" cy="227" r="6" className="pdib-eje" />
      <circle cx="372" cy="227" r="6" className="pdib-eje" />
      {[0, 1, 2, 3, 4].map((i) => (
        <circle key={i} cx={212 + i * 32} cy={238} r="7" className="pdib-rodillo" />
      ))}

      {/* ── Superestructura ────────────────────────────────────────── */}
      <path d="M196 206 L196 148 L372 148 L396 160 L398 206 Z" className="pdib-casa" />
      {/* Franja superior, para que el volumen se lea */}
      <path d="M196 148 L372 148 L396 160 L218 160 Z" className="pdib-casa-alto" />
      {/* Contrapeso */}
      <path d="M372 160 L396 160 L398 206 L372 206 Z" className="pdib-contrapeso" />
      {/* Barandas del pasillo */}
      <line x1="232" y1="148" x2="232" y2="130" className="pdib-baranda" />
      <line x1="300" y1="148" x2="300" y2="130" className="pdib-baranda" />
      <line x1="364" y1="148" x2="364" y2="130" className="pdib-baranda" />
      <line x1="232" y1="131" x2="364" y2="131" className="pdib-baranda" />
      {/* Escape y filtros */}
      <rect x="318" y="126" width="12" height="23" rx="3" className="pdib-escape" />
      <rect x="338" y="134" width="16" height="15" rx="4" className="pdib-escape" />
      {/* Escalera */}
      <line x1="254" y1="206" x2="248" y2="248" className="pdib-escalera" />
      <line x1="268" y1="206" x2="262" y2="248" className="pdib-escalera" />

      {/* ── Cabina ─────────────────────────────────────────────────── */}
      <path d="M200 148 L200 108 L236 100 L248 112 L248 148 Z" className="pdib-cabina" />
      <path d="M206 142 L206 114 L234 107 L242 117 L242 142 Z" className="pdib-vidrio" />

      {/* ── Pluma, y dentro el brazo ───────────────────────────────── */}
      <g transform={giroEn(pluma, PIVOTE_PLUMA)}>
        {/* Cilindros de la pluma, por detrás del brazo */}
        <line x1="262" y1="184" x2="168" y2="132" className="pdib-cilindro" />
        <line x1="214" y1="158" x2="168" y2="132" className="pdib-vastago" />

        <path d="M200 204 L64 112 L82 88 L232 180 Z" className="pdib-pluma" />
        <path d="M200 204 L64 112 L72 101 L210 193 Z" className="pdib-pluma-alto" />
        <circle cx={PIVOTE_PLUMA.x} cy={PIVOTE_PLUMA.y} r="11" className="pdib-pasador" />
        <circle cx={PIVOTE_PLUMA.x} cy={PIVOTE_PLUMA.y} r="4" className="pdib-eje" />

        <g transform={giroEn(brazo, PIVOTE_BRAZO)}>
          {/* Cilindro del brazo */}
          <line x1="128" y1="134" x2="98" y2="178" className="pdib-cilindro" />

          <path d="M62 94 L100 106 L118 186 L84 196 Z" className="pdib-brazo" />
          <path d="M62 94 L100 106 L104 120 L68 108 Z" className="pdib-brazo-alto" />
          <circle cx={PIVOTE_BRAZO.x} cy={PIVOTE_BRAZO.y} r="10" className="pdib-pasador" />
          <circle cx={PIVOTE_BRAZO.x} cy={PIVOTE_BRAZO.y} r="4" className="pdib-eje" />

          {/* Cucharón de frente: cajón con dientes abajo */}
          <path d="M84 196 L118 186 L130 230 L70 244 L58 214 Z" className="pdib-cuchara" />
          <path d="M84 196 L118 186 L122 202 L88 212 Z" className="pdib-cuchara-alto" />
          {DIENTES.map((d, i) => (
            <line key={i} x1={d.x1} y1={d.y1} x2={d.x2} y2={d.y2} className="pdib-diente" />
          ))}
        </g>
      </g>
    </g>
  </svg>
);

/**
 * La misma máquina desde arriba.
 *
 * Las orugas se quedan quietas y gira la tornamesa: el tren de rodaje apunta a
 * donde se trasladó por última vez, que es como trabaja una pala.
 */
export const PalaDesdeArriba = ({ giro = 0 }: { giro?: number }) => (
  <svg viewBox="0 0 170 170" className="pdib-svg" role="img" aria-label="La pala vista desde arriba">
    <rect x="30" y="22" width="26" height="126" rx="12" className="pdib-oruga" />
    <rect x="114" y="22" width="26" height="126" rx="12" className="pdib-oruga" />
    {[0, 1, 2, 3].map((i) => (
      <g key={i}>
        <line x1="32" y1={44 + i * 28} x2="54" y2={44 + i * 28} className="pdib-huella" />
        <line x1="116" y1={44 + i * 28} x2="138" y2={44 + i * 28} className="pdib-huella" />
      </g>
    ))}

    <circle cx="85" cy="85" r="34" className="pdib-tornamesa" />

    <g transform={`rotate(${(giro % 360).toFixed(1)} 85 85)`}>
      <rect x="62" y="64" width="46" height="48" rx="7" className="pdib-casa" />
      <rect x="66" y="96" width="38" height="16" rx="4" className="pdib-contrapeso" />
      <path d="M78 64 L92 64 L90 20 L80 20 Z" className="pdib-pluma" />
      <path d="M74 26 L96 26 L99 8 L71 8 Z" className="pdib-cuchara" />
      <circle cx="85" cy="85" r="6" className="pdib-pasador" />
      <circle cx="85" cy="85" r="2.5" className="pdib-eje" />
    </g>
  </svg>
);
