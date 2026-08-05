import { registerPlugin } from '@capacitor/core';

export interface CanFrame {
  id: string; // e.g. "0x0CF00400"
  dlc: number;
  data: string; // Hex payload e.g. "41 2A 80 1F 00 00 FF FF"
  timestamp: number;
  parsedName?: string;
  parsedValue?: string | number;
  unit?: string;
}

export interface Rs485Packet {
  slaveId: number;
  functionCode: number;
  dataHex: string;
  timestamp: number;
}

export interface TelemetryState {
  engineRpm: number;
  coolantTemp: number;
  oilPressure: number;
  batteryVoltage: number;
  hydraulicTemp: number;
  vehicleSpeed: number;
  canRxCount: number;
  canTxCount: number;
  canErrors: number;
  rs485RxCount: number;
  rs485Errors: number;
  busStatus: 'OK' | 'BUS_OFF' | 'WARNING' | 'SIMULATED';
  isSimulated: boolean;
  canBaudrate: number;
  rs485Baudrate: number;
}

// Interfaz para el Plugin Nativo Capacitor
export interface CanRs485NativePlugin {
  initCan(options: { interfaceName: string; bitrate: number }): Promise<{ status: string; interface: string; bitrate: number }>;
  initRs485(options: { devicePath: string; baudrate: number }): Promise<{ status: string; devicePath: string; baudrate: number }>;
  sendCanFrame(options: { canId: string; data: string }): Promise<{ status: string }>;
  sendRs485Data(options: { dataHex: string }): Promise<{ status: string; bytes: number }>;
}

const CanRs485Native = registerPlugin<CanRs485NativePlugin>('CanRs485');

type TelemetryListener = (state: TelemetryState) => void;
type CanFrameListener = (frame: CanFrame) => void;
type Rs485Listener = (packet: Rs485Packet) => void;

class TelemetryService {
  private listeners: Set<TelemetryListener> = new Set();
  private frameListeners: Set<CanFrameListener> = new Set();
  private rs485Listeners: Set<Rs485Listener> = new Set();

  private recentFrames: CanFrame[] = [];
  private recentRs485: Rs485Packet[] = [];

  private currentState: TelemetryState = {
    engineRpm: 1850,
    coolantTemp: 84.5,
    oilPressure: 4.2,
    batteryVoltage: 24.6,
    hydraulicTemp: 62.0,
    vehicleSpeed: 34.0,
    canRxCount: 0,
    canTxCount: 0,
    canErrors: 0,
    rs485RxCount: 0,
    rs485Errors: 0,
    busStatus: 'SIMULATED',
    isSimulated: true,
    canBaudrate: 500000,
    rs485Baudrate: 9600
  };

  private simulationInterval: any = null;
  private isNativeAvailable = false;

  constructor() {
    this.checkNativeAvailability();
    this.startSimulation();
  }

  private async checkNativeAvailability() {
    try {
      if ((window as any).Capacitor?.isNativePlatform()) {
        this.isNativeAvailable = true;
        this.currentState.isSimulated = false;
        this.currentState.busStatus = 'OK';
        await this.initNativeHardware();
      }
    } catch (e) {
      console.warn('Native Capacitor CanRs485 plugin not available, using Simulator:', e);
      this.isNativeAvailable = false;
    }
  }

  public async initNativeHardware() {
    if (!this.isNativeAvailable) return;
    try {
      await CanRs485Native.initCan({
        interfaceName: 'can0',
        bitrate: this.currentState.canBaudrate
      });
      await CanRs485Native.initRs485({
        devicePath: '/dev/ttyS0',
        baudrate: this.currentState.rs485Baudrate
      });
    } catch (err) {
      console.error('Error initializing native CAN/RS485:', err);
    }
  }

  public toggleSimulation(enable: boolean) {
    this.currentState.isSimulated = enable;
    this.currentState.busStatus = enable ? 'SIMULATED' : 'OK';
    if (enable) {
      this.startSimulation();
    } else {
      if (this.simulationInterval) clearInterval(this.simulationInterval);
    }
    this.notifyState();
  }

  public setCanBaudrate(baud: number) {
    this.currentState.canBaudrate = baud;
    if (this.isNativeAvailable) {
      CanRs485Native.initCan({ interfaceName: 'can0', bitrate: baud });
    }
    this.notifyState();
  }

  public setRs485Baudrate(baud: number) {
    this.currentState.rs485Baudrate = baud;
    if (this.isNativeAvailable) {
      CanRs485Native.initRs485({ devicePath: '/dev/ttyS0', baudrate: baud });
    }
    this.notifyState();
  }

  public async sendCanFrame(canId: string, dataHex: string): Promise<boolean> {
    this.currentState.canTxCount++;
    if (this.isNativeAvailable && !this.currentState.isSimulated) {
      try {
        await CanRs485Native.sendCanFrame({ canId, data: dataHex });
      } catch (e) {
        console.error('Error sending CAN frame native:', e);
        return false;
      }
    }

    const newFrame: CanFrame = {
      id: canId.toUpperCase(),
      dlc: Math.min(8, Math.ceil(dataHex.length / 2)),
      data: dataHex.toUpperCase(),
      timestamp: Date.now(),
      parsedName: 'Custom TX Frame',
      parsedValue: 'Enviado'
    };
    this.pushFrame(newFrame);
    return true;
  }

  public subscribeTelemetry(listener: TelemetryListener) {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => this.listeners.delete(listener);
  }

  public subscribeCanFrames(listener: CanFrameListener) {
    this.frameListeners.add(listener);
    return () => this.frameListeners.delete(listener);
  }

  public subscribeRs485(listener: Rs485Listener) {
    this.rs485Listeners.add(listener);
    return () => this.rs485Listeners.delete(listener);
  }

  public getRecentFrames(): CanFrame[] {
    return [...this.recentFrames];
  }

  public getRecentRs485(): Rs485Packet[] {
    return [...this.recentRs485];
  }

  private pushFrame(frame: CanFrame) {
    this.recentFrames.unshift(frame);
    if (this.recentFrames.length > 100) this.recentFrames.pop();
    this.frameListeners.forEach(fn => fn(frame));
  }

  private pushRs485(packet: Rs485Packet) {
    this.recentRs485.unshift(packet);
    if (this.recentRs485.length > 50) this.recentRs485.pop();
    this.rs485Listeners.forEach(fn => fn(packet));
  }

  private notifyState() {
    this.listeners.forEach(fn => fn({ ...this.currentState }));
  }

  private startSimulation() {
    if (this.simulationInterval) clearInterval(this.simulationInterval);

    this.simulationInterval = setInterval(() => {
      if (!this.currentState.isSimulated) return;

      // Variaciones aleatorias realistas para la simulación
      const rpmDelta = (Math.random() - 0.5) * 40;
      this.currentState.engineRpm = Math.max(800, Math.min(3200, Math.round(this.currentState.engineRpm + rpmDelta)));

      const tempDelta = (Math.random() - 0.48) * 0.4;
      this.currentState.coolantTemp = Math.max(70, Math.min(105, +(this.currentState.coolantTemp + tempDelta).toFixed(1)));

      const pressDelta = (Math.random() - 0.5) * 0.05;
      this.currentState.oilPressure = Math.max(1.5, Math.min(6.5, +(this.currentState.oilPressure + pressDelta).toFixed(2)));

      const voltDelta = (Math.random() - 0.5) * 0.08;
      this.currentState.batteryVoltage = Math.max(21.0, Math.min(28.5, +(this.currentState.batteryVoltage + voltDelta).toFixed(2)));

      const hydDelta = (Math.random() - 0.48) * 0.3;
      this.currentState.hydraulicTemp = Math.max(40, Math.min(90, +(this.currentState.hydraulicTemp + hydDelta).toFixed(1)));

      const speedDelta = (Math.random() - 0.5) * 1.5;
      this.currentState.vehicleSpeed = Math.max(0, Math.min(80, +(this.currentState.vehicleSpeed + speedDelta).toFixed(1)));

      this.currentState.canRxCount += 3;
      this.currentState.rs485RxCount += 1;

      // Generar tramas CAN simular J1939
      const simCanFrames: CanFrame[] = [
        {
          id: '0x0CF00400',
          dlc: 8,
          data: `${Math.floor(this.currentState.engineRpm * 8).toString(16).padStart(4, '0').toUpperCase()} 7D 84 00 FF FF FF`,
          timestamp: Date.now(),
          parsedName: 'Velocidad de Motor (J1939 EEC1)',
          parsedValue: this.currentState.engineRpm,
          unit: 'RPM'
        },
        {
          id: '0x18FEEE00',
          dlc: 8,
          data: `${Math.floor(this.currentState.coolantTemp + 40).toString(16).padStart(2, '0').toUpperCase()} 85 FF FF FF FF FF FF`,
          timestamp: Date.now(),
          parsedName: 'Temperatura de Refrigerante (ET1)',
          parsedValue: this.currentState.coolantTemp,
          unit: '°C'
        },
        {
          id: '0x18FE6800',
          dlc: 8,
          data: `FF FF ${Math.floor(this.currentState.batteryVoltage * 20).toString(16).padStart(4, '0').toUpperCase()} FF FF FF FF`,
          timestamp: Date.now(),
          parsedName: 'Voltaje Eléctrico de Sistema (VEP)',
          parsedValue: this.currentState.batteryVoltage,
          unit: 'V'
        }
      ];

      simCanFrames.forEach(f => this.pushFrame(f));

      // Generar trama RS485 Modbus RTU simulada
      this.pushRs485({
        slaveId: 1,
        functionCode: 3,
        dataHex: `01 03 04 ${Math.floor(this.currentState.hydraulicTemp * 10).toString(16).padStart(4, '0').toUpperCase()} A4 B2`,
        timestamp: Date.now()
      });

      this.notifyState();
    }, 400);
  }
}

export const telemetryService = new TelemetryService();
