/**
 * La pantalla principal cuando el equipo es una pala.
 *
 * Tapa la columna del mapa, igual que el demo, y deja la barra y el menú donde
 * estaban: la vista de camiones no se toca, es otra pantalla elegida por
 * `modoPala`.
 *
 * Escucha solo las MAC asignadas. Con `ScanFilter` el escaneo sobrevive a la
 * pantalla apagada, que es como trabaja esto la mayor parte del turno.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Anuncio, bluetooth, hayBluetooth } from '../nucleo/bluetooth';
import { LecturaKSensor, kSensorDe } from '../nucleo/ksensor';
import {
  Muestra, NOMBRE_ESTADO, NOMBRE_PAPEL, PapelBeacon,
  anguloCalibrado, estadosPala, gradosPorSegundo, inclinacionMaquina, ventana,
} from '../nucleo/pala';
import { Config } from '../nucleo/config';
import { Senal } from '../nucleo/lecturas';
import { PalaDesdeArriba, PalaPerfil } from './PalaDibujo';
import './PalaVista.css';

/** Sobre cuánto se mide la velocidad de la pluma. */
const VENTANA_MS = 1500;
/** Si en este rato no llegó nada, se rearma el escaneo. */
const SIN_NADA_MS = 6000;
/** Pasado esto, el beacon se da por mudo. */
const MUDO_MS = 8000;

interface Oido {
  lectura: LecturaKSensor;
  rssi: number;
  at: number;
}

const PAPELES: PapelBeacon[] = ['tornamesa', 'pluma', 'brazo'];

export const PalaVista = ({
  cfg, valores, velocidadKmh,
}: {
  cfg: Config;
  valores: Map<string, Senal>;
  velocidadKmh: number;
}) => {
  const [oidos, setOidos] = useState<Map<string, Oido>>(new Map());
  const pendientes = useRef(new Map<string, Oido>());
  const historia = useRef<Muestra[]>([]);
  const [, repintar] = useState(0);

  /* Una cadena y no la lista: en el array de dependencias hay que poder
     compararla sin recrear el escaneo en cada repintado. */
  const clave = PAPELES.map((p) => cfg.pala.beacons[p]).filter(Boolean).join(',');
  const macs = useMemo(() => (clave ? clave.split(',') : []), [clave]);

  useEffect(() => {
    if (!hayBluetooth() || macs.length === 0) return;
    const quitar = bluetooth.alAnuncio((a: Anuncio) => {
      const l = kSensorDe(a);
      if (l) pendientes.current.set(a.mac, { lectura: l, rssi: a.rssi, at: Date.now() });
    });
    const arrancar = () => bluetooth.escanear(0, 200, macs).catch(() => undefined);
    arrancar();

    const t = setInterval(() => {
      setOidos(new Map(pendientes.current));
      repintar((n) => n + 1);
    }, 500);

    /* La pantalla de Ajustes escanea por su cuenta y al salir de ella llama a
       detener(), que corta el escaneo de todos. Sin esto, al volver aquí no
       llegaba nada y los tres beacons salían sin señal. Rearmar por si acaso
       cuesta poco y también cubre los cortes que mete Android. */
    const vigilante = setInterval(() => {
      let ultimo = 0;
      for (const o of pendientes.current.values()) ultimo = Math.max(ultimo, o.at);
      if (Date.now() - ultimo > SIN_NADA_MS) arrancar();
    }, SIN_NADA_MS);

    return () => {
      clearInterval(t);
      clearInterval(vigilante);
      quitar();
      bluetooth.detener().catch(() => undefined);
    };
  }, [macs]);

  const lecturaDe = (p: PapelBeacon) => {
    const o = oidos.get(cfg.pala.beacons[p]);
    return o && Date.now() - o.at < MUDO_MS ? o : null;
  };

  const anguloDe = (p: PapelBeacon): number | null => {
    const cal = cfg.pala.calibracion[p];
    const o = lecturaDe(p);
    if (!cal || !o) return null;
    return p === 'tornamesa'
      ? inclinacionMaquina(cal, o.lectura.ejes)
      : anguloCalibrado(cal, o.lectura.ejes);
  };

  const anguloPluma = anguloDe('pluma');
  const anguloBrazo = anguloDe('brazo');
  const inclinacion = anguloDe('tornamesa');

  /* La velocidad de la pluma sale del ángulo, no de las cuentas crudas: así la
     pendiente del banco se cancela sola al derivar. */
  if (anguloPluma !== null) {
    const ahora = Date.now();
    const ultima = historia.current[historia.current.length - 1];
    if (!ultima || ahora - ultima.at >= 250) {
      historia.current = ventana([...historia.current, { at: ahora, angulo: anguloPluma }], VENTANA_MS, ahora);
    }
  }
  const velocidadPluma = gradosPorSegundo(historia.current);

  const senal = (sufijo: string) => {
    for (const [clave, s] of valores) {
      if (clave.endsWith(sufijo) && typeof s.valor === 'number') return s.valor;
    }
    return 0;
  };
  const giro = senal('.giro');
  const giroVertical = senal('.giro_vertical');

  /* El giro de la tornamesa se acumula del giróscopo. Deriva con las horas,
     así que vale para ver que la máquina está girando, no para saber hacia
     dónde mira en absoluto. Por debajo del umbral se considera quieta: si no,
     el ruido del sensor la haría girar sola. */
  const giroAcum = useRef(0);
  const giroAl = useRef(Date.now());
  const ahora = Date.now();
  const dt = Math.min(2, (ahora - giroAl.current) / 1000);
  giroAl.current = ahora;
  if (Math.abs(giroVertical) > 1.5) giroAcum.current += giroVertical * dt;
  const giroAcumulado = giroAcum.current;

  const estados = estadosPala({ velocidad: velocidadKmh, giro, pluma: velocidadPluma });
  const principal = estados[0];

  const sinAsignar = macs.length === 0;
  const grados = (g: number | null) => (g === null ? '—' : `${g.toFixed(1)}°`);

  return (
    <div className="palav">
      <div className="palav-cabe">
        <span className="palav-equipo">{cfg.servidor.equipo || 'Pala'}</span>
        <span className={`palav-estado palav-${principal}`}>
          {estados.map((e) => NOMBRE_ESTADO[e]).join(' · ').toUpperCase()}
        </span>
      </div>

      {sinAsignar ? (
        <div className="palav-falta">
          <p>Todavía no hay beacons asignados.</p>
          <p className="palav-pista">Configuración → Pala, toca cada sitio de la máquina y elígele su beacon.</p>
        </div>
      ) : (
        <>
          <div className="palav-maquina-dibujo">
            <div className="palav-perfil">
              <PalaPerfil pluma={anguloPluma ?? 0} brazo={anguloBrazo ?? 0} inclinacion={inclinacion ?? 0} />
            </div>
            <div className="palav-arriba">
              <PalaDesdeArriba giro={giroAcumulado} />
              <span className="palav-rotulo">Giro</span>
            </div>
          </div>

          {/* Los números acompañan al dibujo, no compiten con él: una fila
              corta debajo, para cuando hace falta el dato exacto. */}
          <div className="palav-datos">
            <Medida
              titulo="Pluma"
              valor={grados(anguloPluma)}
              flecha={Math.abs(velocidadPluma) > 2 ? (velocidadPluma > 0 ? '▲' : '▼') : null}
              pie={anguloPluma === null ? faltaDe(cfg, 'pluma', Boolean(lecturaDe('pluma'))) : `${velocidadPluma.toFixed(1)} °/s`}
            />
            <Medida
              titulo="Brazo"
              valor={grados(anguloBrazo)}
              pie={anguloBrazo === null ? faltaDe(cfg, 'brazo', Boolean(lecturaDe('brazo'))) : ''}
            />
            <Medida titulo="Máquina" valor={grados(inclinacion)} pie="inclinación" />
          </div>
        </>
      )}

      <div className="palav-beacons">
        {PAPELES.map((p) => {
          const mac = cfg.pala.beacons[p];
          const o = lecturaDe(p);
          const tono = !mac ? 'sin' : o ? 'ok' : 'mudo';
          return (
            <div key={p} className={`palav-beacon palav-${tono}`}>
              <i className="palav-punto" />
              <span className="palav-papel">{NOMBRE_PAPEL[p]}</span>
              <span className="palav-pila">
                {!mac ? 'sin asignar' : o ? `${(o.lectura.pilaMv / 1000).toFixed(2)} V` : 'sin señal'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Por qué no hay ángulo: o no llega el beacon, o falta calibrarlo. */
const faltaDe = (cfg: Config, p: PapelBeacon, llega: boolean) => {
  if (!cfg.pala.beacons[p]) return 'sin asignar';
  if (!llega) return 'sin señal';
  const cal = cfg.pala.calibracion[p];
  if (!cal?.a) return 'sin calibrar';
  if (!cal.b) return 'falta la segunda postura';
  return 'sin calibrar';
};

const Medida = ({
  titulo, valor, pie, flecha,
}: {
  titulo: string;
  valor: string;
  pie: string;
  flecha?: string | null;
}) => (
  <div className="palav-medida">
    <span className="palav-titulo">{titulo}</span>
    <b className="palav-valor">
      {flecha && <i className="palav-flecha">{flecha}</i>}
      {valor}
    </b>
    <span className="palav-pie">{pie}</span>
  </div>
);
