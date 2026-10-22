/**
 * Dónde va cada beacon y cómo se calibra.
 *
 * El dibujo manda: arriba de una pala los tres beacons son idénticos y con
 * polvo encima no hay forma de distinguirlos, así que se toca el sitio en la
 * máquina y se elige de la lista de los que están emitiendo. Para saber cuál
 * se tiene en la mano, se agita: los ejes de ese saltan y los otros no.
 *
 * Nada de 3D: el WebView de estas tablets cuelga la GPU con WebGL. Esto es un
 * SVG plano y se dibuja igual de bien.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Anuncio, bluetooth, hayBluetooth } from '../nucleo/bluetooth';
import { LecturaKSensor, Vector3, kSensorDe } from '../nucleo/ksensor';
import {
  Calibracion, NOMBRE_PAPEL, POSTURAS, PapelBeacon, Postura, anguloCalibrado, inclinacionMaquina,
} from '../nucleo/pala';
import { Config } from '../nucleo/config';
import { Aviso, Bloque, Boton, Nota, Vacio } from './piezas';
import retrato from './pala-lateral.webp';

/** Lo último que se oyó de un beacon. */
interface Visto {
  mac: string;
  nombre: string | null;
  rssi: number;
  at: number;
  lectura: LecturaKSensor;
  /** Para el truco de agitarlo: cuánto se movió desde la muestra anterior. */
  meneo: number;
}

/** En porcentaje sobre la foto, que es lo que aguanta cualquier tamaño. */
const SITIOS: Record<PapelBeacon, {
  x: number; y: number; lado: 'arriba' | 'abajo' | 'derecha'; etiqueta: string; donde: string;
}> = {
  tornamesa: {
    x: 70, y: 46, lado: 'abajo', etiqueta: 'Tornamesa',
    donde: 'En el bastidor de la superestructura, cerca de la cabina. Es la referencia: no mide la pluma, mide cómo está parada la máquina.',
  },
  pluma: {
    x: 44, y: 27, lado: 'arriba', etiqueta: 'Pluma',
    donde: 'En el alma de la pluma, cerca de su base y en la cara que mira a la cabina. El ángulo es el mismo en toda la pieza, así que abajo mide igual pero con el radio más cerca y menos golpes.',
  },
  brazo: {
    x: 6, y: 28, lado: 'derecha', etiqueta: 'Brazo',
    donde: 'En la parte alta del brazo, cerca de su pivote y mirando a la cabina. Lo más lejos posible del cucharón.',
  },
};

const distancia = (p: Vector3, q: Vector3) =>
  Math.sqrt((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2);

export const PalaBeacons = ({ cfg, aplicar }: { cfg: Config; aplicar: (c: Config) => void }) => {
  const [vistos, setVistos] = useState<Visto[]>([]);
  const [sitio, setSitio] = useState<PapelBeacon>('tornamesa');
  const [eco, setEco] = useState<string | null>(null);
  const pendientes = useRef(new Map<string, Visto>());

  useEffect(() => {
    if (!hayBluetooth()) return;
    const quitar = bluetooth.alAnuncio((a: Anuncio) => {
      const l = kSensorDe(a);
      if (!l) return; /* solo interesan los que mandan lecturas */
      const antes = pendientes.current.get(a.mac);
      pendientes.current.set(a.mac, {
        mac: a.mac,
        nombre: a.nombre,
        rssi: a.rssi,
        at: Date.now(),
        lectura: l,
        meneo: antes ? distancia(antes.lectura.ejes, l.ejes) : 0,
      });
    });
    bluetooth.escanear(0, 200).catch((e) => setEco(String(e)));
    const t = setInterval(() => setVistos([...pendientes.current.values()]), 500);
    return () => {
      clearInterval(t);
      quitar();
      bluetooth.detener().catch(() => undefined);
    };
  }, []);

  const porMac = useMemo(() => new Map(vistos.map((v) => [v.mac, v])), [vistos]);
  const asignadas = cfg.pala.beacons;
  const elDelSitio = porMac.get(asignadas[sitio]);

  const asignar = (mac: string) => {
    /* Un mismo beacon no puede estar en dos sitios: se lo quitamos al anterior. */
    const beacons = { ...asignadas };
    for (const p of Object.keys(beacons) as PapelBeacon[]) if (beacons[p] === mac) beacons[p] = '';
    beacons[sitio] = mac;
    aplicar({ ...cfg, pala: { ...cfg.pala, beacons } });
    setEco(null);
  };

  const capturar = (p: Postura) => {
    const v = porMac.get(asignadas[p.papel]);
    if (!v) { setEco(`No está llegando nada del beacon de ${NOMBRE_PAPEL[p.papel].toLowerCase()}.`); return; }
    const previa: Calibracion = cfg.pala.calibracion[p.papel] ?? { a: v.lectura.ejes };
    const nueva: Calibracion = { ...previa, [p.ranura]: v.lectura.ejes };
    aplicar({ ...cfg, pala: { ...cfg.pala, calibracion: { ...cfg.pala.calibracion, [p.papel]: nueva } } });
    setEco(`Capturada: ${p.titulo}.`);
  };

  const hecha = (p: Postura) => Boolean(cfg.pala.calibracion[p.papel]?.[p.ranura]);

  if (!hayBluetooth()) return <Vacio>El Bluetooth solo funciona en el equipo, no en el navegador.</Vacio>;

  return (
    <>
      <Bloque titulo="Dónde va cada beacon">
        <Nota>
          Toca un sitio de la máquina y elígele un beacon de los que están emitiendo. Para saber
          cuál tienes en la mano, agítalo: su fila se marca sola.
        </Nota>

        {/* La foto sale del modelo 3D, renderizado una vez fuera del equipo: la
            tablet solo pinta un mapa de bits, que es lo único que su WebView
            aguanta sin colgar la GPU. */}
        <div className="relative mx-auto mt-3 w-full max-w-[600px]">
          <img src={retrato} alt="Pala de perfil con los sitios de cada beacon" className="block w-full" />

          {(Object.keys(SITIOS) as PapelBeacon[]).map((p) => {
            const s = SITIOS[p];
            const activo = p === sitio;
            const puesto = Boolean(asignadas[p]);
            const sitioEtiqueta = {
              arriba: 'bottom-full left-1/2 mb-1 -translate-x-1/2',
              abajo: 'top-full left-1/2 mt-1 -translate-x-1/2',
              derecha: 'left-full top-1/2 ml-1.5 -translate-y-1/2',
            }[s.lado];
            return (
              <button
                key={p}
                onClick={() => setSitio(p)}
                aria-label={`Beacon de ${s.etiqueta}`}
                className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                style={{ left: `${s.x}%`, top: `${s.y}%` }}
              >
                <span
                  className={`flex items-center justify-center rounded-full border-2 font-mono text-[11px] shadow-lg transition ${
                    activo ? 'h-8 w-8 border-acc bg-acc text-[#06231a]'
                      : puesto ? 'h-7 w-7 border-ok bg-bg1/90 text-ok'
                      : 'h-7 w-7 border-bad bg-bg1/90 text-bad'
                  }`}
                >
                  {puesto ? '✓' : '?'}
                </span>
                <span
                  className={`absolute whitespace-nowrap rounded-md bg-bg1/85 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
                    activo ? 'text-acc' : 'text-ink2'
                  } ${sitioEtiqueta}`}
                >
                  {s.etiqueta}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-2 rounded-xl border border-line bg-bg2 px-3.5 py-3">
          <p className="m-0 font-mono text-[11px] uppercase tracking-wider text-acc">{SITIOS[sitio].etiqueta}</p>
          <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink2">{SITIOS[sitio].donde}</p>
          <p className="mt-2 mb-0 font-mono text-[11px] text-ink3">
            {asignadas[sitio] ? `Asignado: ${asignadas[sitio]}` : 'Sin asignar todavía.'}
          </p>
          {elDelSitio && (
            <p className="mt-1 mb-0 font-mono text-[11px] text-ink2">
              {`X ${elDelSitio.lectura.ejes.x}  Y ${elDelSitio.lectura.ejes.y}  Z ${elDelSitio.lectura.ejes.z}`}
              {`  ·  ${(elDelSitio.lectura.pilaMv / 1000).toFixed(2)} V  ·  ${elDelSitio.lectura.temperatura.toFixed(1)} °C`}
            </p>
          )}
        </div>
      </Bloque>

      <Bloque titulo={`Beacons emitiendo (${vistos.length})`}>
        {vistos.length === 0 ? (
          <Vacio>
            Ninguno está mandando lecturas. En la app de KKM cada beacon necesita un slot con
            Adv Type en KSensor y Sensor Axis encendido.
          </Vacio>
        ) : (
          <div className="flex flex-col gap-2">
            {[...vistos].sort((a, b) => b.meneo - a.meneo || b.rssi - a.rssi).map((v) => {
              const puesto = (Object.keys(asignadas) as PapelBeacon[]).find((p) => asignadas[p] === v.mac);
              const agitado = v.meneo > 60;
              return (
                <button
                  key={v.mac}
                  onClick={() => asignar(v.mac)}
                  className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-left transition ${
                    agitado ? 'border-acc bg-acc/10' : 'border-line bg-bg2'
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-[12px] text-ink1">{v.nombre ?? '(sin nombre)'}</span>
                    <span className="font-mono text-[11px] text-ink3">{v.rssi} dBm</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] text-ink3">{v.mac}</div>
                  <div className="mt-1 font-mono text-[11px] text-ink2">
                    {`X ${v.lectura.ejes.x}  Y ${v.lectura.ejes.y}  Z ${v.lectura.ejes.z}`}
                    {`  ·  ${(v.lectura.pilaMv / 1000).toFixed(2)} V`}
                  </div>
                  <div className="mt-1 font-mono text-[10px] uppercase tracking-wider">
                    {agitado && <span className="text-acc">se está moviendo · </span>}
                    <span className={puesto ? 'text-ok' : 'text-ink3'}>
                      {puesto ? NOMBRE_PAPEL[puesto] : `tocar para poner en ${SITIOS[sitio].etiqueta.toLowerCase()}`}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Bloque>

      <Bloque titulo="Calibración">
        <Nota>
          Pon la máquina en cada postura, espera a que quede quieta y captura. Un acelerómetro en
          movimiento mide la sacudida además de la gravedad, así que capturar en marcha estropea
          la medida.
        </Nota>
        <div className="mt-3 flex flex-col gap-2">
          {POSTURAS.map((p, i) => (
            <div key={p.id} className="rounded-xl border border-line bg-bg2 px-3.5 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="m-0 font-mono text-[11px] uppercase tracking-wider text-ink3">
                    {`${i + 1} · ${NOMBRE_PAPEL[p.papel]}`}
                  </p>
                  <p className="mt-0.5 mb-0 text-[12.5px] text-ink1">{p.titulo}</p>
                  <p className="mt-1 mb-0 text-[12px] leading-relaxed text-ink2">{p.detalle}</p>
                </div>
                <Boton
                  variante={hecha(p) ? 'normal' : 'fuerte'}
                  disabled={!asignadas[p.papel]}
                  onClick={() => capturar(p)}
                >
                  {hecha(p) ? 'Rehacer' : 'Capturar'}
                </Boton>
              </div>
              {!asignadas[p.papel] && (
                <p className="mt-2 mb-0 font-mono text-[10.5px] uppercase tracking-wider text-bad">
                  Falta asignar el beacon de {NOMBRE_PAPEL[p.papel].toLowerCase()}
                </p>
              )}
            </div>
          ))}
        </div>
        {eco && <div className="mt-3"><Aviso tono="ok">{eco}</Aviso></div>}
        <Resultado cfg={cfg} porMac={porMac} />
      </Bloque>
    </>
  );
};

/** Lo que se está midiendo ahora mismo con lo ya calibrado. */
const Resultado = ({ cfg, porMac }: { cfg: Config; porMac: Map<string, Visto> }) => {
  const filas = (Object.keys(NOMBRE_PAPEL) as PapelBeacon[]).map((p) => {
    const cal = cfg.pala.calibracion[p];
    const v = porMac.get(cfg.pala.beacons[p]);
    if (!cal || !v) return { p, texto: cal ? 'sin señal' : 'sin calibrar' };
    const g = p === 'tornamesa' ? inclinacionMaquina(cal, v.lectura.ejes) : anguloCalibrado(cal, v.lectura.ejes);
    if (g === null) return { p, texto: p === 'tornamesa' ? 'sin señal' : 'falta la segunda postura' };
    return { p, texto: `${g.toFixed(1)}°` };
  });

  return (
    <div className="mt-3 rounded-xl border border-line bg-bg2 px-3.5 py-3">
      <p className="m-0 font-mono text-[11px] uppercase tracking-wider text-ink3">Midiendo ahora</p>
      <div className="mt-2 flex flex-col gap-1">
        {filas.map((f) => (
          <div key={f.p} className="flex items-baseline justify-between gap-3">
            <span className="text-[12.5px] text-ink2">
              {f.p === 'tornamesa' ? 'Inclinación de la máquina' : `Ángulo de ${NOMBRE_PAPEL[f.p].toLowerCase()}`}
            </span>
            <span className="font-mono text-[13px] text-ink1">{f.texto}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
