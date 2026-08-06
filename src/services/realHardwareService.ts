import { registerPlugin, Capacitor } from '@capacitor/core';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude: number;
  speed: number;
  course: number;
  hdop: number;
  satellites: number;
  fix: boolean;
  rawSentence: string;
  utcTime?: string;
  timestamp: number;
}

export interface CanConsoleLine {
  id: number;
  type: 'rx' | 'tx' | 'error' | 'info';
  rawText: string;
  asciiText?: string;
  port: string;
  timestamp: number;
  isEurosens?: boolean;
  eurosensRawValue?: number;
  isFlowmeterModbus?: boolean;
  flowRate?: number;
  totalizer?: number;
}

export interface CanRs485NativePlugin {
  setPortBaudrate(options: { devicePath: string; baudrate: number }): Promise<{ status: string; devicePath: string; baudrate: number }>;
  startGpsListener(options: { devicePath: string }): Promise<{ status: string; devicePath: string }>;
  startCan1Listener(options: { devicePath: string; baudrate?: number }): Promise<{ status: string; devicePath: string }>;
  startCan2Listener(options: { devicePath: string; baudrate?: number }): Promise<{ status: string; devicePath: string }>;
  startRs485Listener(options: { devicePath: string; baudrate?: number }): Promise<{ status: string; devicePath: string }>;
  sendEurosensQuery(options: { devicePath: string; address: number; command?: number }): Promise<{ status: string; hexSent: string; address: number }>;
  sendModbusQuery(options: { devicePath: string; address: number; functionCode?: number; startRegister?: number; registerCount?: number }): Promise<{ status: string; hexSent: string; address: number }>;
  sendRawBytes(options: { devicePath: string; hexData: string }): Promise<{ status: string; bytesSent: number; devicePath: string }>;
  addListener(eventName: 'onGpsData', listenerFunc: (data: { raw: string; timestamp: number; port: string }) => void): Promise<any>;
  addListener(eventName: 'onGpsLocationFix', listenerFunc: (data: { latitude: number; longitude: number; speed?: number; altitude?: number; timestamp: number }) => void): Promise<any>;
  addListener(eventName: 'onCan1Data', listenerFunc: (data: { raw: string; ascii?: string; timestamp: number; port: string; isEurosens?: boolean; eurosensRawValue?: number }) => void): Promise<any>;
  addListener(eventName: 'onCan2Data', listenerFunc: (data: { raw: string; ascii?: string; timestamp: number; port: string; isEurosens?: boolean; eurosensRawValue?: number }) => void): Promise<any>;
  addListener(eventName: 'onRs485Data', listenerFunc: (data: { raw: string; ascii?: string; timestamp: number; port: string; isEurosens?: boolean; eurosensRawValue?: number }) => void): Promise<any>;
}

const CanRs485Native = registerPlugin<CanRs485NativePlugin>('CanRs485');

type GpsListener = (location: GpsLocation) => void;
type CanConsoleListener = (lines: CanConsoleLine[]) => void;

class RealHardwareService {
  private currentGps: GpsLocation = {
    latitude: -12.1036,
    longitude: -77.0248,
    speed: 0,
    altitude: 108,
    course: 185,
    hdop: 0.9,
    satellites: 8,
    fix: true,
    rawSentence: 'Esperando actualización NMEA de /dev/ttyHSL2...',
    utcTime: '19:41:23 UTC',
    timestamp: Date.now(),
  };

  private consoleLog: CanConsoleLine[] = [];
  private maxConsoleLines = 200;
  private lineIdCounter = 1;

  private gpsListeners: Set<GpsListener> = new Set();
  private canConsoleListeners: Set<CanConsoleListener> = new Set();
  private isHardwareStarted = false;

  constructor() {
    this.initHardwareListeners();
  }

  private async initHardwareListeners() {
    if (this.isHardwareStarted) return;
    this.isHardwareStarted = true;

    try {
      if (Capacitor.isNativePlatform()) {
        // 1. GPS en /dev/ttyHSL2
        await CanRs485Native.startGpsListener({ devicePath: '/dev/ttyHSL2' });
        CanRs485Native.addListener('onGpsData', (data) => {
          this.parseNmeaSentence(data.raw, data.timestamp);
        });

        // 2. Android Location Fix
        CanRs485Native.addListener('onGpsLocationFix', (data) => {
          this.currentGps = {
            ...this.currentGps,
            latitude: data.latitude,
            longitude: data.longitude,
            speed: data.speed || 0,
            altitude: data.altitude || 0,
            satellites: Math.max(this.currentGps.satellites || 8, 8),
            fix: true,
            rawSentence: `Android Location Fix: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
            timestamp: data.timestamp
          };
          this.notifyGps();
        });

        // 3. RS485 en /dev/ttyHSL0 (P4 / COM1)
        await CanRs485Native.startRs485Listener({ devicePath: '/dev/ttyHSL0', baudrate: 9600 });
        CanRs485Native.addListener('onRs485Data', (data: any) => {
          this.pushConsoleLine('rx', data.raw, '/dev/ttyHSL0 (RS485)', data.timestamp, data.ascii, data.isEurosens, data.eurosensRawValue, data.isFlowmeterModbus, data.flowRate, data.totalizer);
        });

        // 4. CAN1 en /dev/ttyHSL3
        await CanRs485Native.startCan1Listener({ devicePath: '/dev/ttyHSL3', baudrate: 115200 });
        CanRs485Native.addListener('onCan1Data', (data: any) => {
          this.pushConsoleLine('rx', data.raw, '/dev/ttyHSL3 (CAN1)', data.timestamp, data.ascii, data.isEurosens, data.eurosensRawValue, data.isFlowmeterModbus, data.flowRate, data.totalizer);
        });

        // 5. CAN2 en /dev/ttyHSL1
        await CanRs485Native.startCan2Listener({ devicePath: '/dev/ttyHSL1', baudrate: 115200 });
        CanRs485Native.addListener('onCan2Data', (data: any) => {
          this.pushConsoleLine('rx', data.raw, '/dev/ttyHSL1 (CAN2)', data.timestamp, data.ascii, data.isEurosens, data.eurosensRawValue, data.isFlowmeterModbus, data.flowRate, data.totalizer);
        });

        this.pushConsoleLine('info', 'Servicios de hardware serie y GPS iniciados correctamente.', 'SISTEMA', Date.now());
      }
    } catch (err: any) {
      console.warn('Error inicializando servicios de hardware:', err);
      this.pushConsoleLine('error', `Error inicializando hardware: ${err?.message || err}`, 'SISTEMA', Date.now());
    }
  }

  private parseNmeaSentence(sentence: string, timestamp: number) {
    if (!sentence || !sentence.startsWith('$')) return;

    if (sentence.includes('GGA') || sentence.includes('RMC')) {
      const parts = sentence.split(',');
      if (parts.length > 6) {
        if (sentence.includes('GGA')) {
          const rawLat = parts[2];
          const latDir = parts[3];
          const rawLon = parts[4];
          const lonDir = parts[5];
          const fixQuality = parseInt(parts[6] || '0', 10);
          const sats = parseInt(parts[7] || '0', 10);

          if (rawLat && rawLon && fixQuality > 0) {
            const lat = this.convertNmeaToDecimal(rawLat, latDir);
            const lon = this.convertNmeaToDecimal(rawLon, lonDir);
            this.currentGps = {
              ...this.currentGps,
              latitude: lat,
              longitude: lon,
              satellites: sats,
              fix: true,
              rawSentence: sentence,
              timestamp
            };
            this.notifyGps();
          } else {
            this.currentGps = {
              ...this.currentGps,
              satellites: sats,
              rawSentence: sentence,
              timestamp
            };
            this.notifyGps();
          }
        }
      }
    }
  }

  private convertNmeaToDecimal(nmeaPos: string, direction: string): number {
    const dotIndex = nmeaPos.indexOf('.');
    if (dotIndex === -1) return 0;
    const degDegrees = parseInt(nmeaPos.substring(0, dotIndex - 2), 10);
    const minutes = parseFloat(nmeaPos.substring(dotIndex - 2));
    let decimal = degDegrees + minutes / 60;
    if (direction === 'S' || direction === 'W') decimal = -decimal;
    return decimal;
  }

  public pushConsoleLine(
    type: 'rx' | 'tx' | 'error' | 'info',
    rawText: string,
    port: string,
    timestamp: number,
    asciiText?: string,
    isEurosens?: boolean,
    eurosensRawValue?: number,
    isFlowmeterModbus?: boolean,
    flowRate?: number,
    totalizer?: number
  ) {
    const newLine: CanConsoleLine = {
      id: this.lineIdCounter++,
      type,
      rawText,
      asciiText,
      port,
      timestamp: timestamp || Date.now(),
      isEurosens,
      eurosensRawValue,
      isFlowmeterModbus,
      flowRate,
      totalizer
    };

    this.consoleLog.unshift(newLine);
    if (this.consoleLog.length > this.maxConsoleLines) {
      this.consoleLog = this.consoleLog.slice(0, this.maxConsoleLines);
    }
    this.notifyConsole();
  }

  public async setBaudrate(devicePath: string, baudrate: number) {
    this.pushConsoleLine('info', `Configurando baudrate a ${baudrate} bps...`, devicePath, Date.now());
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CanRs485Native.setPortBaudrate({ devicePath, baudrate });
        this.pushConsoleLine('info', `Puerto configurado a ${baudrate} bps exitosamente.`, devicePath, Date.now());
        return res;
      } catch (err: any) {
        this.pushConsoleLine('error', `Error configurando baudrate: ${err?.message || err}`, devicePath, Date.now());
        throw err;
      }
    }
  }

  public async sendEurosensQuery(devicePath: string, address: number, command: number = 6) {
    this.pushConsoleLine('tx', `[PETICION EUROSENS LLS] Enviando consulta Cmd 0x${command.toString(16).toUpperCase()} a Esclavo ID ${address}...`, devicePath, Date.now());
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CanRs485Native.sendEurosensQuery({ devicePath, address, command });
        this.pushConsoleLine('tx', `[TX ENVIADO OK] Trama Eurosens CRC8: ${res.hexSent}`, devicePath, Date.now());
        return res;
      } catch (err: any) {
        this.pushConsoleLine('error', `[ERROR TRANSMISION] Falló envío Eurosens: ${err?.message || err}`, devicePath, Date.now());
        throw err;
      }
    } else {
      // Simulación en Web Browser
      this.pushConsoleLine('tx', `[SIMULACION TX WEB] Eurosens ID ${address}: 31 0${address} 06 EF`, devicePath, Date.now());
    }
  }

  public async sendModbusQuery(devicePath: string, address: number, functionCode: number = 3, startRegister: number = 0, registerCount: number = 10) {
    this.pushConsoleLine('tx', `[PETICION MODBUS RTU] Enviando Fn 0x0${functionCode} a Esclavo ID ${address} (${registerCount} regs)...`, devicePath, Date.now());
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CanRs485Native.sendModbusQuery({ devicePath, address, functionCode, startRegister, registerCount });
        this.pushConsoleLine('tx', `[TX ENVIADO OK] Trama Modbus CRC16: ${res.hexSent}`, devicePath, Date.now());
        return res;
      } catch (err: any) {
        this.pushConsoleLine('error', `[ERROR TRANSMISION] Falló envío Modbus: ${err?.message || err}`, devicePath, Date.now());
        throw err;
      }
    } else {
      // Simulación en Web Browser
      this.pushConsoleLine('tx', `[SIMULACION TX WEB] Modbus ID ${address}: 0${address} 03 00 00 00 0A C5 CD`, devicePath, Date.now());
    }
  }

  public async sendRawBytes(devicePath: string, hexData: string) {
    this.pushConsoleLine('tx', `[PETICION RAW HEX] Enviando trama manual: ${hexData}`, devicePath, Date.now());
    if (Capacitor.isNativePlatform()) {
      try {
        const res = await CanRs485Native.sendRawBytes({ devicePath, hexData });
        this.pushConsoleLine('tx', `[TX ENVIADO OK] ${res.bytesSent} bytes transmitidos por ${devicePath}`, devicePath, Date.now());
        return res;
      } catch (err: any) {
        this.pushConsoleLine('error', `[ERROR TRANSMISION] Falló envío Raw Bytes: ${err?.message || err}`, devicePath, Date.now());
        throw err;
      }
    }
  }

  public injectDummyLine(port: string = '/dev/ttyHSL0 (RS485)') {
    this.pushConsoleLine('tx', '[SIMULACION TX] Emitiendo trama ráfaga 13 Bytes...', port, Date.now());
    setTimeout(() => {
      const dummyHex = '01 03 08 42 F1 00 00 46 71 38 00 B5 E2';
      const dummyAscii = '..B..Fq8..';
      this.pushConsoleLine('rx', dummyHex, port, Date.now(), dummyAscii, false, undefined, true, 120.50, 15436.00);
    }, 200);
  }

  public subscribeGps(listener: GpsListener) {
    this.gpsListeners.add(listener);
    listener(this.currentGps);
    return () => this.gpsListeners.delete(listener);
  }

  public subscribeCanConsole(listener: CanConsoleListener) {
    this.canConsoleListeners.add(listener);
    listener([...this.consoleLog]);
    return () => this.canConsoleListeners.delete(listener);
  }

  private notifyGps() {
    this.gpsListeners.forEach(fn => fn({ ...this.currentGps }));
  }

  private notifyConsole() {
    const copy = [...this.consoleLog];
    this.canConsoleListeners.forEach(fn => fn(copy));
  }

  public getGps(): GpsLocation {
    return { ...this.currentGps };
  }

  public getConsoleLog(): CanConsoleLine[] {
    return [...this.consoleLog];
  }

  public clearConsole() {
    this.consoleLog = [];
    this.notifyConsole();
  }
}

export const realHardwareService = new RealHardwareService();
