import { registerPlugin } from '@capacitor/core';

export interface GpsLocation {
  latitude: number;
  longitude: number;
  altitude?: number;
  speed?: number;
  satellites?: number;
  fix: boolean;
  rawSentence: string;
  timestamp: number;
}

export interface CanConsoleLine {
  id: number;
  rawText: string;
  asciiText?: string;
  port: string;
  timestamp: number;
}

export interface CanRs485NativePlugin {
  setPortBaudrate(options: { devicePath: string; baudrate: number }): Promise<{ status: string; devicePath: string; baudrate: number }>;
  startGpsListener(options: { devicePath: string }): Promise<{ status: string; devicePath: string }>;
  startCan1Listener(options: { devicePath: string; baudrate?: number }): Promise<{ status: string; devicePath: string }>;
  startCan2Listener(options: { devicePath: string; baudrate?: number }): Promise<{ status: string; devicePath: string }>;
  addListener(eventName: 'onGpsData', listenerFunc: (data: { raw: string; timestamp: number; port: string }) => void): Promise<any>;
  addListener(eventName: 'onGpsLocationFix', listenerFunc: (data: { latitude: number; longitude: number; speed?: number; altitude?: number; timestamp: number }) => void): Promise<any>;
  addListener(eventName: 'onCan1Data', listenerFunc: (data: { raw: string; ascii?: string; timestamp: number; port: string }) => void): Promise<any>;
  addListener(eventName: 'onCan2Data', listenerFunc: (data: { raw: string; ascii?: string; timestamp: number; port: string }) => void): Promise<any>;
}

const CanRs485Native = registerPlugin<CanRs485NativePlugin>('CanRs485');

type GpsListener = (location: GpsLocation) => void;
type CanConsoleListener = (lines: CanConsoleLine[]) => void;

class RealHardwareService {
  private gpsListeners: Set<GpsListener> = new Set();
  private canConsoleListeners: Set<CanConsoleListener> = new Set();

  private currentGps: GpsLocation = {
    latitude: -12.046374, // Lima por defecto si no hay fix
    longitude: -77.042793,
    fix: false,
    rawSentence: 'Esperando señal NMEA de /dev/ttyHSL2...',
    timestamp: Date.now()
  };

  private consoleLog: CanConsoleLine[] = [];
  private logCounter = 0;

  constructor() {
    this.initNativeListeners();
  }

  private async initNativeListeners() {
    try {
      if ((window as any).Capacitor?.isNativePlatform()) {
        // Escuchar datos del GPS en /dev/ttyHSL2
        await CanRs485Native.startGpsListener({ devicePath: '/dev/ttyHSL2' });
        CanRs485Native.addListener('onGpsData', (data) => {
          this.parseNmeaSentence(data.raw, data.timestamp);
        });

        // Escuchar fijación directa de coordenadas de Android LocationManager
        CanRs485Native.addListener('onGpsLocationFix', (data) => {
          this.currentGps = {
            latitude: data.latitude,
            longitude: data.longitude,
            speed: data.speed,
            altitude: data.altitude,
            satellites: Math.max(this.currentGps.satellites || 4, 4),
            fix: true,
            rawSentence: `Android GPS Fix: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`,
            timestamp: data.timestamp
          };
          this.notifyGps();
        });

        // Escuchar datos de CAN1 en /dev/ttyHSL3 (Segun Manual AT-10A Pág 9 P5 CAN1)
        await CanRs485Native.startCan1Listener({ devicePath: '/dev/ttyHSL3', baudrate: 115200 });
        CanRs485Native.addListener('onCan1Data', (data) => {
          this.pushConsoleLine(data.raw, '/dev/ttyHSL3 (CAN1)', data.timestamp, data.ascii);
        });

        // Escuchar datos de CAN2 en /dev/ttyHSL1 (Segun Manual AT-10A Pág 9 P5 CAN2)
        await CanRs485Native.startCan2Listener({ devicePath: '/dev/ttyHSL1', baudrate: 115200 });
        CanRs485Native.addListener('onCan2Data', (data) => {
          this.pushConsoleLine(data.raw, '/dev/ttyHSL1 (CAN2)', data.timestamp, data.ascii);
        });
      }
    } catch (err) {
      console.error('Error iniciando listeners de hardware real:', err);
    }
  }

  // Parseador NMEA ($GNGGA / $GPRMC / $GSV) para obtener latitud/longitud real del puerto /dev/ttyHSL2
  private parseNmeaSentence(raw: string, timestamp: number) {
    if (!raw.startsWith('$')) return;

    const parts = raw.split('*')[0].split(',');
    const type = parts[0];

    // Extraer número de satélites en vista si es sentencia GSV
    if (type.endsWith('GSV')) {
      const satsInView = parseInt(parts[3] || '0', 10);
      if (!isNaN(satsInView) && satsInView > (this.currentGps.satellites || 0)) {
        this.currentGps.satellites = satsInView;
      }
    }

    if (type === '$GNGGA' || type === '$GPGGA') {
      // $GNGGA,hhmmss.ss,llll.ll,a,yyyyy.yy,a,x,xx,x.x,x.x,M,x.x,M,x.x,xxxx*hh
      const latRaw = parts[2];
      const latDir = parts[3];
      const lonRaw = parts[4];
      const lonDir = parts[5];
      const fixQuality = parseInt(parts[6] || '0', 10);
      const numSats = parseInt(parts[7] || '0', 10);

      if (!isNaN(numSats) && numSats > 0) {
        this.currentGps.satellites = numSats;
      }

      if (latRaw && lonRaw) {
        const lat = this.convertNmeaToDecimal(latRaw, latDir);
        const lon = this.convertNmeaToDecimal(lonRaw, lonDir);

        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          this.currentGps.latitude = lat;
          this.currentGps.longitude = lon;
          this.currentGps.fix = fixQuality > 0;
        }
      }
    } else if (type === '$GNRMC' || type === '$GPRMC') {
      // $GNRMC,hhmmss.ss,A,llll.ll,a,yyyyy.yy,a,x.x,x.x,ddmmyy,,,a*hh
      const status = parts[2]; // A = Valid, V = Void
      const latRaw = parts[3];
      const latDir = parts[4];
      const lonRaw = parts[5];
      const lonDir = parts[6];
      const speedKnots = parseFloat(parts[7] || '0');

      if (latRaw && lonRaw) {
        const lat = this.convertNmeaToDecimal(latRaw, latDir);
        const lon = this.convertNmeaToDecimal(lonRaw, lonDir);

        if (!isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
          this.currentGps.latitude = lat;
          this.currentGps.longitude = lon;
          this.currentGps.fix = status === 'A';
          this.currentGps.speed = +(speedKnots * 1.852).toFixed(1); // Nudos a Km/h
        }
      }
    }

    this.currentGps.rawSentence = raw;
    this.currentGps.timestamp = timestamp;
    this.notifyGps();
  }

  private convertNmeaToDecimal(nmeaPos: string, direction: string): number {
    const dotIdx = nmeaPos.indexOf('.');
    if (dotIdx === -1) return 0;
    const degLen = dotIdx - 2;
    const degrees = parseFloat(nmeaPos.substring(0, degLen));
    const minutes = parseFloat(nmeaPos.substring(degLen));
    let decimal = degrees + minutes / 60;
    if (direction === 'S' || direction === 'W') {
      decimal = -decimal;
    }
    return decimal;
  }

  private pushConsoleLine(rawText: string, port: string, timestamp: number, asciiText?: string) {
    this.logCounter++;
    const line: CanConsoleLine = {
      id: this.logCounter,
      rawText,
      asciiText,
      port,
      timestamp
    };
    this.consoleLog.unshift(line);
    if (this.consoleLog.length > 200) this.consoleLog.pop();
    this.notifyConsole();
  }

  public async setBaudrate(devicePath: string, baudrate: number) {
    try {
      if ((window as any).Capacitor?.isNativePlatform()) {
        await CanRs485Native.setPortBaudrate({ devicePath, baudrate });
      }
    } catch (e) {
      console.error('Error cambiando baudrate de ' + devicePath, e);
    }
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
