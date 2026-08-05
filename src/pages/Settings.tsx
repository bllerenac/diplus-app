import React, { useEffect, useState } from 'react';
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
  IonList,
  IonItem,
  IonLabel,
  IonSelect,
  IonSelectOption,
  IonToggle,
  IonButton,
  IonBadge
} from '@ionic/react';
import { Settings as SettingsIcon, Cpu, Radio, ShieldCheck, RefreshCw, Terminal } from 'lucide-react';
import { telemetryService, TelemetryState } from '../services/telemetryService';
import './Settings.css';

export const SettingsPage: React.FC = () => {
  const [telemetry, setTelemetry] = useState<TelemetryState>({
    engineRpm: 0,
    coolantTemp: 0,
    oilPressure: 0,
    batteryVoltage: 0,
    hydraulicTemp: 0,
    vehicleSpeed: 0,
    canRxCount: 0,
    canTxCount: 0,
    canErrors: 0,
    rs485RxCount: 0,
    rs485Errors: 0,
    busStatus: 'SIMULATED',
    isSimulated: true,
    canBaudrate: 500000,
    rs485Baudrate: 9600
  });

  const [selectedCanBaud, setSelectedCanBaud] = useState(500000);
  const [selectedRs485Baud, setSelectedRs485Baud] = useState(9600);
  const [canInterface, setCanInterface] = useState('can0');
  const [serialPath, setSerialPath] = useState('/dev/ttyS0');

  useEffect(() => {
    const unsub = telemetryService.subscribeTelemetry(state => {
      setTelemetry(state);
      setSelectedCanBaud(state.canBaudrate);
      setSelectedRs485Baud(state.rs485Baudrate);
    });
    return () => {
      unsub();
    };
  }, []);

  const handleApplyConfig = () => {
    telemetryService.setCanBaudrate(selectedCanBaud);
    telemetryService.setRs485Baudrate(selectedRs485Baud);
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="dark">
          <IonTitle>Configuración de Hardware & Bus</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="settings-content">
        <IonGrid className="ion-padding">
          <IonRow>
            {/* Configuración de Puerto CAN */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="settings-card">
                <IonCardHeader>
                  <IonCardTitle className="card-title-flex">
                    <Cpu className="icon-blue" /> Parámetros CANBus (Android 9)
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonList lines="none" className="custom-list">
                    <IonItem className="custom-item">
                      <IonLabel>Interfaz CAN Hardware (Android 9)</IonLabel>
                      <IonSelect
                        value={canInterface}
                        onIonChange={e => setCanInterface(e.detail.value)}
                        className="custom-select"
                      >
                        <IonSelectOption value="/dev/ttyHSL1">CAN 1 (/dev/ttyHSL1)</IonSelectOption>
                        <IonSelectOption value="/dev/ttyHSL2">CAN 2 (/dev/ttyHSL2)</IonSelectOption>
                        <IonSelectOption value="can0">SocketCAN can0</IonSelectOption>
                      </IonSelect>
                    </IonItem>

                    <IonItem className="custom-item">
                      <IonLabel>Velocidad de Bus (Bitrate)</IonLabel>
                      <IonSelect
                        value={selectedCanBaud}
                        onIonChange={e => setSelectedCanBaud(e.detail.value)}
                        className="custom-select"
                      >
                        <IonSelectOption value={125000}>125 Kbps</IonSelectOption>
                        <IonSelectOption value={250000}>250 Kbps (Estándar Maquinaria)</IonSelectOption>
                        <IonSelectOption value={500000}>500 Kbps (Estándar Automoción)</IonSelectOption>
                        <IonSelectOption value={1000000}>1 Mbps (High-Speed)</IonSelectOption>
                      </IonSelect>
                    </IonItem>
                  </IonList>
                </IonCardContent>
              </IonCard>
            </IonCol>

            {/* Configuración de Puerto RS485 */}
            <IonCol size="12" sizeMd="6">
              <IonCard className="settings-card">
                <IonCardHeader>
                  <IonCardTitle className="card-title-flex">
                    <Radio className="icon-green" /> Parámetros RS485 / Serial
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <IonList lines="none" className="custom-list">
                    <IonItem className="custom-item">
                      <IonLabel>Nodo Dispositivo Serial</IonLabel>
                      <IonSelect
                        value={serialPath}
                        onIonChange={e => setSerialPath(e.detail.value)}
                        className="custom-select"
                      >
                        <IonSelectOption value="/dev/ttyHSL3">/dev/ttyHSL3 (RS485 Interno)</IonSelectOption>
                        <IonSelectOption value="/dev/ttyHSL0">/dev/ttyHSL0</IonSelectOption>
                        <IonSelectOption value="/dev/ttyUSB0">/dev/ttyUSB0 (Adaptador USB)</IonSelectOption>
                      </IonSelect>
                    </IonItem>

                    <IonItem className="custom-item">
                      <IonLabel>Baud Rate RS485</IonLabel>
                      <IonSelect
                        value={selectedRs485Baud}
                        onIonChange={e => setSelectedRs485Baud(e.detail.value)}
                        className="custom-select"
                      >
                        <IonSelectOption value={4800}>4800 bps</IonSelectOption>
                        <IonSelectOption value={9600}>9600 bps (Modbus Estándar)</IonSelectOption>
                        <IonSelectOption value={19200}>19200 bps</IonSelectOption>
                        <IonSelectOption value={115200}>115200 bps</IonSelectOption>
                      </IonSelect>
                    </IonItem>
                  </IonList>
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>

          {/* Modo Simulación y Diagnóstico */}
          <IonRow>
            <IonCol size="12">
              <IonCard className="settings-card">
                <IonCardHeader>
                  <IonCardTitle className="card-title-flex">
                    <ShieldCheck className="icon-yellow" /> Modo de Operación y Diagnóstico
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div className="sim-mode-row">
                    <div>
                      <div className="setting-title">Modo Simulación de Telemetría</div>
                      <div className="setting-desc">
                        Genera datos dinámicos simulados para pruebas de interfaz gráfica sin necesidad de conectar el puerto CAN físico.
                      </div>
                    </div>
                    <IonToggle
                      checked={telemetry.isSimulated}
                      onIonChange={e => telemetryService.toggleSimulation(e.detail.checked)}
                      color="warning"
                    />
                  </div>

                  <div className="action-row">
                    <IonButton color="primary" onClick={handleApplyConfig}>
                      <RefreshCw size={16} style={{ marginRight: '6px' }} /> Aplicar Cambios de Bus
                    </IonButton>
                  </div>
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>
        </IonGrid>
      </IonContent>
    </IonPage>
  );
};
