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
  IonInput,
  IonButton,
  IonBadge,
  IonSearchbar,
  IonToggle
} from '@ionic/react';
import { Send, Filter, Radio, Pause, Play, Trash2 } from 'lucide-react';
import { telemetryService, CanFrame } from '../services/telemetryService';
import './CanInspector.css';

export const CanInspector: React.FC = () => {
  const [frames, setFrames] = useState<CanFrame[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Formulario para transmisión de tramas CAN de prueba
  const [txId, setTxId] = useState('18FE6800');
  const [txData, setTxData] = useState('11 22 33 44 55 66 77 88');
  const [txStatus, setTxStatus] = useState<string | null>(null);

  useEffect(() => {
    setFrames(telemetryService.getRecentFrames());
    const unsub = telemetryService.subscribeCanFrames(newFrame => {
      if (!isPaused) {
        setFrames(telemetryService.getRecentFrames());
      }
    });
    return () => {
      unsub();
    };
  }, [isPaused]);

  const handleSendFrame = async () => {
    const cleanId = txId.replace(/\s+/g, '');
    const cleanData = txData.replace(/\s+/g, '');
    
    if (!cleanId) return;

    setTxStatus('Enviando...');
    const success = await telemetryService.sendCanFrame(cleanId, cleanData);
    if (success) {
      setTxStatus('¡Trama enviada correctamente al puerto CAN!');
      setTimeout(() => setTxStatus(null), 3000);
    } else {
      setTxStatus('Error al transmitir en el bus CAN.');
    }
  };

  const filteredFrames = frames.filter(f =>
    f.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.data.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (f.parsedName && f.parsedName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar color="dark">
          <IonTitle>Inspección & Log de Tramas CANBus</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent fullscreen className="can-inspector-content">
        <IonGrid className="ion-padding">
          {/* Panel de Transmisión TX */}
          <IonRow>
            <IonCol size="12">
              <IonCard className="inspector-card">
                <IonCardHeader>
                  <IonCardTitle className="tx-header">
                    <Radio className="card-icon" /> Transmitir Trama CAN (TX)
                  </IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div className="tx-form">
                    <div className="tx-input-group">
                      <label>CAN ID (Hex)</label>
                      <input
                        type="text"
                        className="custom-input"
                        placeholder="Ej: 0CF00400"
                        value={txId}
                        onChange={e => setTxId(e.target.value)}
                      />
                    </div>
                    <div className="tx-input-group data-group">
                      <label>Payload Data Hex (Max 8 Bytes)</label>
                      <input
                        type="text"
                        className="custom-input"
                        placeholder="Ej: 00 11 22 33 44 55 66 77"
                        value={txData}
                        onChange={e => setTxData(e.target.value)}
                      />
                    </div>
                    <IonButton color="primary" onClick={handleSendFrame} className="tx-btn">
                      <Send size={16} style={{ marginRight: '6px' }} /> Transmitir
                    </IonButton>
                  </div>
                  {txStatus && <div className="tx-status-msg">{txStatus}</div>}
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>

          {/* Buscador y Controles del Sniffer */}
          <IonRow>
            <IonCol size="12">
              <IonCard className="inspector-card">
                <IonCardHeader>
                  <div className="sniffer-controls-header">
                    <IonCardTitle>Monitoreo en Tiempo Real (RX Log)</IonCardTitle>
                    <div className="controls-right">
                      <IonButton
                        fill="outline"
                        color={isPaused ? 'warning' : 'medium'}
                        size="small"
                        onClick={() => setIsPaused(!isPaused)}
                      >
                        {isPaused ? <Play size={14} /> : <Pause size={14} />}
                        <span style={{ marginLeft: '4px' }}>{isPaused ? 'Reanudar' : 'Pausar'}</span>
                      </IonButton>
                      <IonButton
                        fill="outline"
                        color="danger"
                        size="small"
                        onClick={() => setFrames([])}
                      >
                        <Trash2 size={14} />
                      </IonButton>
                    </div>
                  </div>
                </IonCardHeader>
                <IonCardContent>
                  <IonSearchbar
                    value={searchQuery}
                    onIonInput={e => setSearchQuery(e.detail.value!)}
                    placeholder="Filtrar por CAN ID, Datos o Nombre de Señal..."
                    className="custom-searchbar"
                  />

                  {/* Tabla de Logs CAN */}
                  <div className="table-responsive">
                    <table className="can-log-table">
                      <thead>
                        <tr>
                          <th>Hora</th>
                          <th>CAN ID</th>
                          <th>DLC</th>
                          <th>Data Payload (Hex)</th>
                          <th>Señal Interpretada</th>
                          <th>Valor</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredFrames.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="no-data">
                              No hay tramas registradas
                            </td>
                          </tr>
                        ) : (
                          filteredFrames.map((f, idx) => (
                            <tr key={idx}>
                              <td className="time-col">{new Date(f.timestamp).toLocaleTimeString()}</td>
                              <td className="id-col">
                                <IonBadge color="primary">{f.id}</IonBadge>
                              </td>
                              <td className="dlc-col">{f.dlc}</td>
                              <td className="data-col">
                                <code>{f.data}</code>
                              </td>
                              <td className="name-col">{f.parsedName || '-'}</td>
                              <td className="val-col">
                                {f.parsedValue !== undefined ? `${f.parsedValue} ${f.unit || ''}` : '-'}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
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
