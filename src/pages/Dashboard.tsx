import React, { useEffect, useState, useRef } from 'react';
import {
  IonContent,
  IonHeader,
  IonPage,
  IonTitle,
  IonToolbar,
  IonGrid,
  IonRow,
  IonCol,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonBadge,
  IonButton,
  IonSearchbar
} from '@ionic/react';
import { MapPin, Navigation, Cpu, Terminal, Trash2, Pause, Play, RefreshCw } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { realHardwareService, GpsLocation, CanConsoleLine } from '../services/realHardwareService';
import './Dashboard.css';

// Configurar íconos de Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png'
});

export const Dashboard: React.FC = () => {
  const [gps, setGps] = useState<GpsLocation>(realHardwareService.getGps());
  const [consoleLog, setConsoleLog] = useState<CanConsoleLine[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  // Suscripción a GPS real NMEA
  useEffect(() => {
    const unsubGps = realHardwareService.subscribeGps(newGps => {
      setGps(newGps);
    });

    const unsubConsole = realHardwareService.subscribeCanConsole(logs => {
      if (!isPaused) {
        setConsoleLog(logs);
      }
    });

    return () => {
      unsubGps();
      unsubConsole();
    };
  }, [isPaused]);

  // Inicializar Leaflet Map
  useEffect(() => {
    if (mapContainerRef.current && !mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        zoomControl: true,
        fadeAnimation: true,
        markerZoomAnimation: true
      }).setView([gps.latitude, gps.longitude], 15);

      // Usar capa de tiles rápida de CartoDB Voyager (optimizado para móvil/webview)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19
      }).addTo(map);

      const marker = L.marker([gps.latitude, gps.longitude]).addTo(map);
      marker.bindPopup('<b>Dispositivo DIPLUS</b><br/>Puerto: /dev/ttyHSL2');

      mapInstanceRef.current = map;
      markerRef.current = marker;

      // SOLUCIÓN ZONAS GRISES: Forzar a Leaflet a recalar el tamaño del contenedor tras renderizar Ionic
      const timer1 = setTimeout(() => map.invalidateSize(), 200);
      const timer2 = setTimeout(() => map.invalidateSize(), 600);
      const timer3 = setTimeout(() => map.invalidateSize(), 1200);

      return () => {
        clearTimeout(timer1);
        clearTimeout(timer2);
        clearTimeout(timer3);
      };
    }
  }, []);

  // Actualizar posición del mapa y revalidar tamaño al cambiar coordenadas GPS
  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current && gps.latitude && gps.longitude) {
      const newLatLng: [number, number] = [gps.latitude, gps.longitude];
      markerRef.current.setLatLng(newLatLng);
      mapInstanceRef.current.panTo(newLatLng);
      mapInstanceRef.current.invalidateSize();
    }
  }, [gps.latitude, gps.longitude]);

  const filteredConsole = consoleLog.filter(line =>
    line.rawText.toLowerCase().includes(searchQuery.toLowerCase()) ||
    line.port.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="dark">
          <div className="dashboard-header-container">
            <div className="brand-logo">
              <Cpu className="brand-icon" />
              <IonTitle>DIPLUS-APP | Telemetría & GPS Real</IonTitle>
            </div>
            <div className="status-badges">
              <IonBadge color={gps.fix ? 'success' : 'warning'}>
                GPS /dev/ttyHSL2: {gps.fix ? 'CON FIX' : 'SIN FIX SATÉLITE'}
              </IonBadge>
              <IonBadge color="tertiary">
                CAN1: /dev/ttyHSL3 | CAN2: /dev/ttyHSL1
              </IonBadge>
            </div>
          </div>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="dashboard-content">
        <IonGrid className="ion-no-padding">
          <IonRow className="main-layout-row">
            {/* LADO IZQUIERDO: MAPA DE UBICACIÓN REAL (GPS NMEA) */}
            <IonCol size="12" sizeLg="7" className="map-col">
              <div className="map-card-wrapper">
                <div className="map-info-header">
                  <div className="map-title">
                    <MapPin className="map-title-icon" /> Ubicación GPS en Tiempo Real
                  </div>
                  <div className="gps-details">
                    <span>Lat: {gps.latitude.toFixed(6)}</span>
                    <span>Lon: {gps.longitude.toFixed(6)}</span>
                    <span>Satélites: {gps.satellites || 0}</span>
                  </div>
                </div>

                {/* Contenedor del Mapa Leaflet */}
                <div ref={mapContainerRef} className="leaflet-map-container" />

                <div className="nmea-raw-bar">
                  <span className="raw-label">Última trama GPS NMEA (/dev/ttyHSL2):</span>
                  <code>{gps.rawSentence}</code>
                </div>
              </div>
            </IonCol>

            {/* LADO DERECHO: CONSOLA DE DATOS CAN / RS485 EN TIEMPO REAL */}
            <IonCol size="12" sizeLg="5" className="console-col">
              <div className="console-card-wrapper">
                <div className="console-header">
                  <div className="console-title">
                    <Terminal className="console-icon" /> Consola CANBUS (AT-10A Manual)
                  </div>
                  <div className="console-actions">
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

                <div className="console-search">
                  <div className="console-baud-row">
                    <span className="baud-label">Baudrate CAN1 (/dev/ttyHSL3):</span>
                    <select
                      className="baud-select"
                      onChange={e => realHardwareService.setBaudrate('/dev/ttyHSL3', parseInt(e.target.value, 10))}
                      defaultValue={115200}
                    >
                      <option value={9600}>9600</option>
                      <option value={19200}>19200</option>
                      <option value={38400}>38400</option>
                      <option value={57600}>57600</option>
                      <option value={115200}>115200 (Estándar AT-10A)</option>
                      <option value={230400}>230400</option>
                      <option value={460800}>460800</option>
                      <option value={921600}>921600</option>
                    </select>
                  </div>
                  <IonSearchbar
                    value={searchQuery}
                    onIonInput={e => setSearchQuery(e.detail.value!)}
                    placeholder="Filtrar consola por texto o puerto..."
                    className="custom-console-search"
                  />
                </div>

                {/* Log de consola en tiempo real */}
                <div className="console-body">
                  {filteredConsole.length === 0 ? (
                    <div className="console-empty">
                      <span>Escuchando datos binarios/RAW en /dev/ttyHSL1 y /dev/ttyHSL0...</span>
                      <small>Asegúrate de que la velocidad Baudrate coincida con tu transmisor CAN/Serial.</small>
                    </div>
                  ) : (
                    filteredConsole.map(line => (
                      <div key={line.id} className="console-line">
                        <div className="console-line-header">
                          <span className="line-time">
                            {new Date(line.timestamp).toLocaleTimeString()}
                          </span>
                          <span className="line-port">{line.port}</span>
                        </div>
                        <code className="line-text">HEX: {line.rawText}</code>
                        {line.asciiText && <div className="line-ascii">ASCII: {line.asciiText}</div>}
                      </div>
                    ))
                  )}
                </div>
              </div>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};
