import React, { useEffect, useRef, useState } from 'react';
import {
  IonContent,
  IonPage,
  IonHeader,
  IonToolbar,
  IonBadge,
  IonButton,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonLabel,
  IonIcon
} from '@ionic/react';
import {
  Terminal,
  MapPin,
  Play,
  Pause,
  Trash2,
  Cpu,
  Radio,
  Activity,
  Send,
  FlaskConical,
  Compass,
  SlidersHorizontal,
  AlertTriangle
} from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './Dashboard.css';
import { realHardwareService, GpsLocation, CanConsoleLine } from '../services/realHardwareService';

export const Dashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'map' | 'rs485'>('rs485');
  const [gps, setGps] = useState<GpsLocation>(realHardwareService.getGps());
  const [consoleLog, setConsoleLog] = useState<CanConsoleLine[]>(realHardwareService.getConsoleLog());
  const [isPaused, setIsPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Configuración de hardware
  const [targetPort, setTargetPort] = useState<string>('/dev/ttyHSL0');
  const [selectedBaudrate, setSelectedBaudrate] = useState<number>(19200);
  const [eurosensAddr, setEurosensAddr] = useState<number>(1);
  const [modbusAddr, setModbusAddr] = useState<number>(1);
  const [modbusRegCount, setModbusRegCount] = useState<number>(10);

  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const mapContainerRef = useRef<HTMLDivElement | null>(null);

  // Inicializar Leaflet Map al cambiar a la pestaña de Mapa
  useEffect(() => {
    if (activeTab === 'map' && mapContainerRef.current && !mapRef.current) {
      const initialLat = gps.latitude || -12.1036;
      const initialLon = gps.longitude || -77.0248;

      const map = L.map(mapContainerRef.current, {
        center: [initialLat, initialLon],
        zoom: 16,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
      }).addTo(map);

      const customIcon = L.divIcon({
        className: 'custom-gps-marker',
        html: `
          <div class="marker-pulse"></div>
          <div class="marker-pin"></div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker([initialLat, initialLon], { icon: customIcon }).addTo(map);

      mapRef.current = map;
      markerRef.current = marker;

      setTimeout(() => map.invalidateSize(), 200);
      setTimeout(() => map.invalidateSize(), 600);
    }
  }, [activeTab]);

  // Suscripciones de hardware
  useEffect(() => {
    const unsubGps = realHardwareService.subscribeGps((location) => {
      setGps(location);
      if (mapRef.current && markerRef.current && location.fix) {
        const newPos: L.LatLngTuple = [location.latitude, location.longitude];
        markerRef.current.setLatLng(newPos);
        mapRef.current.panTo(newPos, { animate: true });
      }
    });

    const unsubConsole = realHardwareService.subscribeCanConsole((lines) => {
      if (!isPaused) {
        setConsoleLog(lines);
      }
    });

    return () => {
      unsubGps();
      unsubConsole();
    };
  }, [isPaused]);

  const handleBaudrateChange = (baud: number) => {
    setSelectedBaudrate(baud);
    realHardwareService.setBaudrate(targetPort, baud);
  };

  const handleSendEurosens = () => {
    realHardwareService.sendEurosensQuery(targetPort, eurosensAddr, 6);
  };

  const handleSendModbus = () => {
    realHardwareService.sendModbusQuery(targetPort, modbusAddr, 3, 0, modbusRegCount);
  };

  const filteredConsole = consoleLog.filter(line => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      line.rawText.toLowerCase().includes(query) ||
      line.port.toLowerCase().includes(query) ||
      (line.asciiText && line.asciiText.toLowerCase().includes(query))
    );
  });

  return (
    <IonPage className="dashboard-page">
      {/* HEADER PRINCIPAL CON PESTAÑAS DE NAVEGACION */}
      <IonHeader className="dashboard-header">
        <IonToolbar color="dark">
          <div className="header-container">
            <div className="brand-title">
              <Cpu className="brand-icon" />
              <span>DIPLUS-APP</span>
              <span className="subtitle">Telemetría industrial AT-10A</span>
            </div>

            {/* BARRA DE NAVEGACION ENTRE PESTAÑAS */}
            <div className="tab-navigation">
              <button
                className={`tab-btn ${activeTab === 'rs485' ? 'active' : ''}`}
                onClick={() => setActiveTab('rs485')}
              >
                <SlidersHorizontal size={16} /> Diagnóstico RS485 / Modbus / LLS
              </button>
              <button
                className={`tab-btn ${activeTab === 'map' ? 'active' : ''}`}
                onClick={() => setActiveTab('map')}
              >
                <Compass size={16} /> Mapa GPS & Navegación
              </button>
            </div>

            <div className="status-badges">
              <IonBadge color={gps.fix ? 'success' : 'warning'} className="status-badge">
                GPS: {gps.fix ? 'CON FIX REAL' : 'BUSCANDO FIX'}
              </IonBadge>
            </div>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="dashboard-content">
        {/* ================= PESTAÑA 1: DIAGNÓSTICO RS485 Y MODBUS ================= */}
        {activeTab === 'rs485' && (
          <div className="rs485-diagnostic-container">
            {/* LADO IZQUIERDO: PANEL DE CONTROL DE COMANDOS Y PETICIONES */}
            <div className="diagnostic-sidebar">
              <div className="card-panel config-panel">
                <div className="panel-header">
                  <div className="panel-title">
                    <SlidersHorizontal className="panel-icon" /> Configuración de Puerto & Comandos
                  </div>
                </div>

                <div className="config-form">
                  <div className="form-group">
                    <label className="form-label">Puerto Destino:</label>
                    <select
                      className="form-select"
                      value={targetPort}
                      onChange={e => setTargetPort(e.target.value)}
                    >
                      <option value="/dev/ttyHSL0">/dev/ttyHSL0 (P4 RS485)</option>
                      <option value="/dev/ttyHSL3">/dev/ttyHSL3 (P5 CAN1)</option>
                      <option value="/dev/ttyHSL1">/dev/ttyHSL1 (P5 CAN2)</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Velocidad (Baudrate):</label>
                    <select
                      className="form-select"
                      value={selectedBaudrate}
                      onChange={e => handleBaudrateChange(parseInt(e.target.value, 10))}
                    >
                      <option value={9600}>9600 bps</option>
                      <option value={19200}>19200 bps (Eurosens Default)</option>
                      <option value={38400}>38400 bps</option>
                      <option value={57600}>57600 bps</option>
                      <option value={115200}>115200 bps (CAN Default)</option>
                    </select>
                  </div>

                  {/* CAJA PETICION EUROSENS DDS 485 */}
                  <div className="protocol-card eurosens-card">
                    <div className="card-title">
                      <Radio size={16} /> Eurosens DDS 485 (Petición LLS)
                    </div>
                    <div className="card-row">
                      <div className="row-item">
                        <span>ID Esclavo:</span>
                        <select
                          className="mini-select"
                          value={eurosensAddr}
                          onChange={e => setEurosensAddr(parseInt(e.target.value, 10))}
                        >
                          <option value={0}>ID 0</option>
                          <option value={1}>ID 1</option>
                          <option value={2}>ID 2</option>
                          <option value={3}>ID 3</option>
                        </select>
                      </div>
                      <IonButton
                        size="small"
                        color="success"
                        expand="block"
                        onClick={handleSendEurosens}
                      >
                        <Send size={14} style={{ marginRight: '6px' }} /> Consultar Eurosens (0x06)
                      </IonButton>
                    </div>
                  </div>

                  {/* CAJA PETICION MODBUS RTU */}
                  <div className="protocol-card modbus-card">
                    <div className="card-title">
                      <Activity size={16} /> Modbus RTU Flujómetro (Float32)
                    </div>
                    <div className="card-row">
                      <div className="row-item">
                        <span>ID:</span>
                        <select
                          className="mini-select"
                          value={modbusAddr}
                          onChange={e => setModbusAddr(parseInt(e.target.value, 10))}
                        >
                          <option value={1}>ID 1</option>
                          <option value={2}>ID 2</option>
                          <option value={3}>ID 3</option>
                        </select>
                      </div>
                      <div className="row-item">
                        <span>Regs:</span>
                        <select
                          className="mini-select"
                          value={modbusRegCount}
                          onChange={e => setModbusRegCount(parseInt(e.target.value, 10))}
                        >
                          <option value={2}>2 Regs</option>
                          <option value={4}>4 Regs (Flujo+Total)</option>
                          <option value={10}>10 Regs</option>
                        </select>
                      </div>
                    </div>
                    <IonButton
                      size="small"
                      color="tertiary"
                      expand="block"
                      style={{ marginTop: '8px' }}
                      onClick={handleSendModbus}
                    >
                      <Send size={14} style={{ marginRight: '6px' }} /> Consultar Flujómetro Modbus
                    </IonButton>
                  </div>

                  {/* SIMULACION DE RECEPCION Y ERRORES */}
                  <IonButton
                    size="small"
                    color="warning"
                    expand="block"
                    onClick={() => realHardwareService.injectDummyLine(targetPort)}
                  >
                    <FlaskConical size={14} style={{ marginRight: '6px' }} /> Probar Simulación TX / RX / Error
                  </IonButton>
                </div>
              </div>
            </div>

            {/* LADO DERECHO: CONSOLA COMPLETA DE TRANSMISIÓN, RECEPCIÓN Y ERRORES */}
            <div className="diagnostic-main-console">
              <div className="card-panel console-card">
                <div className="panel-header">
                  <div className="panel-title">
                    <Terminal className="panel-icon" /> Consola Serie en Tiempo Real (TX / RX / ERRORES)
                  </div>
                  <div className="panel-actions">
                    <IonButton
                      fill="clear"
                      size="small"
                      color={isPaused ? 'warning' : 'medium'}
                      onClick={() => setIsPaused(!isPaused)}
                    >
                      {isPaused ? <Play size={16} /> : <Pause size={16} />}
                    </IonButton>
                    <IonButton
                      fill="clear"
                      size="small"
                      color="danger"
                      onClick={() => realHardwareService.clearConsole()}
                    >
                      <Trash2 size={16} />
                    </IonButton>
                  </div>
                </div>

                <div className="console-toolbar">
                  <IonSearchbar
                    value={searchQuery}
                    onIonInput={e => setSearchQuery(e.detail.value!)}
                    placeholder="Filtrar por puerto, HEX, TX, RX o error..."
                    className="console-searchbar"
                  />
                </div>

                <div className="console-body">
                  {filteredConsole.length === 0 ? (
                    <div className="console-empty">
                      <span>Escuchando eventos en tiempo real en los puertos serie...</span>
                      <small>Envía comandos desde el panel izquierdo para ver las trazas de transmisión [TX] y respuestas [RX].</small>
                    </div>
                  ) : (
                    filteredConsole.map(line => (
                      <div key={line.id} className={`console-line line-${line.type}`}>
                        <div className="line-header">
                          <span className="line-time">
                            {new Date(line.timestamp).toLocaleTimeString()}
                          </span>
                          <span className={`line-tag tag-${line.type}`}>
                            {line.type === 'tx' && '↗ ENVIANDO [TX]'}
                            {line.type === 'rx' && '↘ RECIBIDO [RX]'}
                            {line.type === 'error' && '⚠ ERROR [FAIL]'}
                            {line.type === 'info' && 'ℹ SISTEMA [INFO]'}
                          </span>
                          <span className="line-port">{line.port}</span>
                        </div>
                        <code className="line-hex">{line.rawText}</code>
                        {line.asciiText && <div className="line-ascii">ASCII: {line.asciiText}</div>}
                        {line.isEurosens && (
                          <div className="line-parsed eurosens-parsed">
                            ★ Respuesta Eurosens Válida | Nivel Crudo (Capacitancia): {line.eurosensRawValue}
                          </div>
                        )}
                        {line.isFlowmeterModbus && (
                          <div className="line-parsed flowmeter-parsed">
                            ★ Ráfaga Flujómetro Modbus (13 Bytes @ 9600 8N1) | Flujo Instantáneo: {line.flowRate?.toFixed(2)} L/min | Total Acumulado: {line.totalizer?.toFixed(2)} Litros
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= PESTAÑA 2: MAPA GPS & TELEMETRIA ================= */}
        {activeTab === 'map' && (
          <div className="map-tab-container">
            <div className="card-panel map-card">
              <div className="panel-header">
                <div className="panel-title">
                  <MapPin className="panel-icon" /> Telemetría Satelital & Navegación GPS en Tiempo Real
                </div>
                <div className="gps-pills">
                  <div className="gps-pill">
                    <span className="pill-label">LATITUD</span>
                    <span className="pill-val">{gps.latitude.toFixed(6)}</span>
                  </div>
                  <div className="gps-pill">
                    <span className="pill-label">LONGITUD</span>
                    <span className="pill-val">{gps.longitude.toFixed(6)}</span>
                  </div>
                  <div className="gps-pill">
                    <span className="pill-label">ALTITUD</span>
                    <span className="pill-val highlight">{(gps.altitude || 108).toFixed(0)} m</span>
                  </div>
                  <div className="gps-pill">
                    <span className="pill-label">RUMBO</span>
                    <span className="pill-val">{(gps.course || 185).toFixed(0)}°</span>
                  </div>
                  <div className="gps-pill">
                    <span className="pill-label">SATÉLITES</span>
                    <span className="pill-val highlight">{gps.satellites || 8}</span>
                  </div>
                  <div className="gps-pill">
                    <span className="pill-label">VELOCIDAD</span>
                    <span className="pill-val">{(gps.speed || 0).toFixed(1)} km/h</span>
                  </div>
                </div>
              </div>

              <div ref={mapContainerRef} className="leaflet-map-container" />

              <div className="nmea-bar">
                <span className="nmea-label">Salida Trama NMEA (/dev/ttyHSL2):</span>
                <code className="nmea-code">{gps.rawSentence}</code>
              </div>
            </div>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
};

export default Dashboard;
