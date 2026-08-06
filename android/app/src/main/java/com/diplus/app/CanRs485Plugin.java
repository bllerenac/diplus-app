package com.diplus.app;

import android.content.Context;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.concurrent.atomic.AtomicBoolean;

import com.android.canbus.CanBusHelper;
import com.android.canbus.CanBusHelper.CanBusCallback;

@CapacitorPlugin(name = "CanRs485")
public class CanRs485Plugin extends Plugin {

    private static final String TAG = "CanRs485Plugin";
    private final AtomicBoolean isGpsListening = new AtomicBoolean(false);
    private final AtomicBoolean isCan1Listening = new AtomicBoolean(false);
    private final AtomicBoolean isCan2Listening = new AtomicBoolean(false);
    private final AtomicBoolean isRs485Listening = new AtomicBoolean(false);

    private Thread gpsThread;
    private Thread can1Thread;
    private Thread can2Thread;
    private Thread rs485Thread;
    private LocationManager locationManager;

    private final CanBusHelper canBusHelper0 = new CanBusHelper();
    private final CanBusHelper canBusHelper1 = new CanBusHelper();

    // CRC8 para Protocolo Eurosens DDS 485 (del repositorio edge-computer)
    public static int calculateEurosensCrc8(byte[] data, int length) {
        int crc = 0;
        for (int b = 0; b < length; b++) {
            int i = (data[b] ^ crc) & 0xff;
            crc = 0;
            if ((i & 0x01) != 0) crc ^= 0x5e;
            if ((i & 0x02) != 0) crc ^= 0xbc;
            if ((i & 0x04) != 0) crc ^= 0x61;
            if ((i & 0x08) != 0) crc ^= 0xc2;
            if ((i & 0x10) != 0) crc ^= 0x9d;
            if ((i & 0x20) != 0) crc ^= 0x23;
            if ((i & 0x40) != 0) crc ^= 0x46;
            if ((i & 0x80) != 0) crc ^= 0x8c;
        }
        return crc & 0xff;
    }

    // CRC16 para Protocolo Modbus RTU
    public static int calculateModbusCrc16(byte[] buf, int len) {
        int crc = 0xffff;
        for (int pos = 0; pos < len; pos++) {
            crc ^= (buf[pos] & 0xff);
            for (int i = 8; i != 0; i--) {
                if ((crc & 0x0001) != 0) {
                    crc >>= 1;
                    crc ^= 0xa001;
                } else {
                    crc >>= 1;
                }
            }
        }
        return crc & 0xffff;
    }

    @PluginMethod
    public void setPortBaudrate(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL0");
        int baudrate = call.getInt("baudrate", 9600);

        try {
            Process process = Runtime.getRuntime().exec(new String[] {
                "stty", "-F", devicePath, String.valueOf(baudrate), "raw", "-echo"
            });
            process.waitFor();
            JSObject ret = new JSObject();
            ret.put("status", "configured");
            ret.put("devicePath", devicePath);
            ret.put("baudrate", baudrate);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error configurando stty para " + devicePath, e);
            call.reject("Error stty: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendEurosensQuery(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL0");
        int address = call.getInt("address", 1);
        int command = call.getInt("command", 6);

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] head = new byte[] { (byte) 0x31, (byte) (address & 0xff), (byte) (command & 0xff) };
            int crc = calculateEurosensCrc8(head, 3);
            byte[] packet = new byte[] { head[0], head[1], head[2], (byte) crc };

            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(packet);
                fos.flush();
            }

            StringBuilder sb = new StringBuilder();
            for (byte b : packet) sb.append(String.format("%02X ", b));

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("hexSent", sb.toString().trim());
            ret.put("devicePath", devicePath);
            ret.put("address", address);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando trama Eurosens a " + devicePath, e);
            call.reject("Error Eurosens: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendModbusQuery(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL0");
        int address = call.getInt("address", 1);
        int functionCode = call.getInt("functionCode", 3);
        int startRegister = call.getInt("startRegister", 0);
        int registerCount = call.getInt("registerCount", 4);

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] pdu = new byte[6];
            pdu[0] = (byte) (address & 0xff);
            pdu[1] = (byte) (functionCode & 0xff);
            pdu[2] = (byte) ((startRegister >> 8) & 0xff);
            pdu[3] = (byte) (startRegister & 0xff);
            pdu[4] = (byte) ((registerCount >> 8) & 0xff);
            pdu[5] = (byte) (registerCount & 0xff);

            int crc = calculateModbusCrc16(pdu, 6);
            byte[] packet = new byte[8];
            System.arraycopy(pdu, 0, packet, 0, 6);
            packet[6] = (byte) (crc & 0xff);        // CRC Low Byte
            packet[7] = (byte) ((crc >> 8) & 0xff); // CRC High Byte

            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(packet);
                fos.flush();
            }

            StringBuilder sb = new StringBuilder();
            for (byte b : packet) sb.append(String.format("%02X ", b));

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("hexSent", sb.toString().trim());
            ret.put("devicePath", devicePath);
            ret.put("address", address);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando trama Modbus a " + devicePath, e);
            call.reject("Error Modbus: " + e.getMessage());
        }
    }

    @PluginMethod
    public void sendRawBytes(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL0");
        String hexString = call.getString("hexData", "0103000000044409");

        try {
            File devFile = new File(devicePath);
            if (!devFile.exists()) {
                call.reject("Archivo de dispositivo no existe: " + devicePath);
                return;
            }

            byte[] bytes = hexStringToByteArray(hexString);
            try (FileOutputStream fos = new FileOutputStream(devFile)) {
                fos.write(bytes);
                fos.flush();
            }

            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("bytesSent", bytes.length);
            ret.put("devicePath", devicePath);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error enviando raw a " + devicePath, e);
            call.reject("Error enviando bytes: " + e.getMessage());
        }
    }

    private byte[] hexStringToByteArray(String s) {
        s = s.replaceAll("\\s+", "");
        int len = s.length();
        byte[] data = new byte[len / 2];
        for (int i = 0; i < len; i += 2) {
            data[i / 2] = (byte) ((Character.digit(s.charAt(i), 16) << 4)
                                 + Character.digit(s.charAt(i+1), 16));
        }
        return data;
    }

    @PluginMethod
    public void startGpsListener(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL2");
        int baudrate = call.getInt("baudrate", 921600);

        try {
            getActivity().runOnUiThread(() -> {
                try {
                    locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                    if (locationManager != null && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, new LocationListener() {
                            @Override
                            public void onLocationChanged(Location location) {
                                JSObject data = new JSObject();
                                data.put("latitude", location.getLatitude());
                                data.put("longitude", location.getLongitude());
                                data.put("speed", location.getSpeed() * 3.6);
                                data.put("altitude", location.getAltitude());
                                data.put("timestamp", System.currentTimeMillis());
                                notifyListeners("onGpsLocationFix", data);
                            }
                            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                            @Override public void onProviderEnabled(String provider) {}
                            @Override public void onProviderDisabled(String provider) {}
                        });
                    }
                } catch (Exception e) {
                    Log.e(TAG, "Error activando LocationManager: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error invocando UI Thread para LocationManager", e);
        }

        if (!isGpsListening.get()) {
            isGpsListening.set(true);
            configureStty(devicePath, baudrate);
            gpsThread = new Thread(() -> readTextStream(devicePath, "onGpsData", isGpsListening));
            gpsThread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        ret.put("baudrate", baudrate);
        call.resolve(ret);
    }

    @PluginMethod
    public void startCan1Listener(PluginCall call) {
        int serialBaudrate = call.getInt("serialBaudrate", 115200);
        int canBaudrate = call.getInt("baudrate", 250000);
        if (!isCan1Listening.get()) {
            isCan1Listening.set(true);
            can1Thread = new Thread(() -> startCanBusListening(0, canBusHelper0, "onCan1Data", isCan1Listening, serialBaudrate, canBaudrate));
            can1Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("interface", 0);
        ret.put("canBaudrate", canBaudrate);
        call.resolve(ret);
    }

    @PluginMethod
    public void startCan2Listener(PluginCall call) {
        int serialBaudrate = call.getInt("serialBaudrate", 115200);
        int canBaudrate = call.getInt("baudrate", 250000);
        if (!isCan2Listening.get()) {
            isCan2Listening.set(true);
            can2Thread = new Thread(() -> startCanBusListening(1, canBusHelper1, "onCan2Data", isCan2Listening, serialBaudrate, canBaudrate));
            can2Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("interface", 1);
        ret.put("canBaudrate", canBaudrate);
        call.resolve(ret);
    }

    private void startCanBusListening(int canInterface, CanBusHelper helper, String eventName, AtomicBoolean activeFlag, int serialBaudrate, int canBaudrate) {
        Log.i(TAG, "Iniciando CANBusHelper en Interfaz CAN" + (canInterface + 1) + " para " + eventName);
        
        int retBaud = helper.setSerialBaudrate(canInterface, serialBaudrate, 8, 0, 1);
        if (retBaud < 0) {
            Log.e(TAG, "setSerialBaudrate fallo en CAN" + (canInterface + 1) + ": " + retBaud);
        }
        
        int retInit = helper.initialize(canInterface, serialBaudrate, canBaudrate, false);
        if (retInit != 0) {
            Log.e(TAG, "initialize fallo en CAN" + (canInterface + 1) + ": " + retInit);
            activeFlag.set(false);
            return;
        }

        helper.readCan(canInterface, new CanBusCallback() {
            @Override
            public void onSetError() {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onSetError");
            }

            @Override
            public void onSendError() {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onSendError");
            }

            @Override
            public void onIdError(int count) {
                Log.w(TAG, "CAN" + (canInterface + 1) + " onIdError count: " + count);
            }

            @Override
            public void onReceiveCanbusData(int FF, int RTR, int DLC, int ID, int[] DATA) {
                if (!activeFlag.get()) return;

                StringBuilder hexSb = new StringBuilder();
                StringBuilder asciiSb = new StringBuilder();
                if (DATA != null) {
                    for (int i = 0; i < DLC && i < DATA.length; i++) {
                        int b = DATA[i] & 0xff;
                        hexSb.append(String.format("%02X ", b));
                        if (b >= 32 && b <= 126) {
                            asciiSb.append((char) b);
                        } else {
                            asciiSb.append('.');
                        }
                    }
                }

                JSObject data = new JSObject();
                data.put("id", String.format("0x%X", ID));
                data.put("rawId", ID);
                data.put("dlc", DLC);
                data.put("ff", FF);
                data.put("rtr", RTR);
                data.put("raw", hexSb.toString().trim());
                data.put("ascii", asciiSb.toString());
                data.put("timestamp", System.currentTimeMillis());
                data.put("port", "CAN" + (canInterface + 1));

                notifyListeners(eventName, data);
            }
        });
    }

    @PluginMethod
    public void sendCanFrame(PluginCall call) {
        int canInterface = call.getInt("interface", 0);
        int id = call.getInt("id", 0x123);
        int ff = call.getInt("ff", 0);
        int rtr = call.getInt("rtr", 0);
        String hexData = call.getString("hexData", "");

        byte[] bytes = hexStringToByteArray(hexData);
        int dlc = bytes.length;
        int[] dataInts = new int[dlc];
        for (int i = 0; i < dlc; i++) {
            dataInts[i] = bytes[i] & 0xff;
        }

        CanBusHelper helper = (canInterface == 0) ? canBusHelper0 : canBusHelper1;
        int res = helper.sendFrame(canInterface, ff, rtr, dlc, id, dataInts);
        if (res > 0) {
            JSObject ret = new JSObject();
            ret.put("status", "sent");
            ret.put("bytesSent", res);
            call.resolve(ret);
        } else {
            call.reject("Error enviando trama CAN: " + res);
        }
    }

    @PluginMethod
    public void startRs485Listener(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL0");
        int baudrate = call.getInt("baudrate", 9600);
        enableRs485HardwarePower(true);
        if (!isRs485Listening.get()) {
            isRs485Listening.set(true);
            configureStty(devicePath, baudrate);
            rs485Thread = new Thread(() -> readRawStream(devicePath, "onRs485Data", isRs485Listening));
            rs485Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        ret.put("rs485Power", "gpio40_HIGH");
        call.resolve(ret);
    }

    private void enableRs485HardwarePower(boolean enable) {
        try {
            String dirCmd = "echo out > /sys/class/gpio/gpio40/direction";
            String valCmd = "echo " + (enable ? "1" : "0") + " > /sys/class/gpio/gpio40/value";
            Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd}).waitFor();
            Runtime.getRuntime().exec(new String[]{"sh", "-c", valCmd}).waitFor();
            Log.i(TAG, "Alimentacion Hardware RS485 (gpio40) -> " + (enable ? "ACTIVADA (1)" : "DESACTIVADA (0)"));
        } catch (Exception e) {
            Log.w(TAG, "No se pudo cambiar estado gpio40 para RS485: " + e.getMessage());
        }
    }

    private void configureStty(String devicePath, int baudrate) {
        try {
            Process p = Runtime.getRuntime().exec(new String[] {
                "stty", "-F", devicePath, String.valueOf(baudrate), "raw", "-echo"
            });
            p.waitFor();
            Log.i(TAG, "Configurado " + devicePath + " a " + baudrate + " baudios via stty");
        } catch (Exception e) {
            Log.w(TAG, "No se pudo ejecutar stty en " + devicePath + ": " + e.getMessage());
        }
    }

    private void readRawStream(String devicePath, String eventName, AtomicBoolean activeFlag) {
        Log.i(TAG, "Iniciando lectura binaria en " + devicePath + " para " + eventName);
        File devFile = new File(devicePath);
        if (!devFile.exists()) return;

        byte[] buffer = new byte[256];
        try (FileInputStream fis = new FileInputStream(devFile)) {
            while (activeFlag.get()) {
                int bytesRead = fis.read(buffer);
                if (bytesRead > 0) {
                    StringBuilder hexSb = new StringBuilder();
                    StringBuilder asciiSb = new StringBuilder();
                    for (int i = 0; i < bytesRead; i++) {
                        byte b = buffer[i];
                        hexSb.append(String.format("%02X ", b));
                        if (b >= 32 && b <= 126) {
                            asciiSb.append((char) b);
                        } else {
                            asciiSb.append('.');
                        }
                    }

                    JSObject data = new JSObject();
                    data.put("raw", hexSb.toString().trim());
                    data.put("ascii", asciiSb.toString());
                    data.put("timestamp", System.currentTimeMillis());
                    data.put("port", devicePath);

                    // 1. Parseo del protocolo Eurosens DDS (Cabecera 0x3E, longitud >= 9)
                    if (buffer[0] == (byte) 0x3e && bytesRead >= 9) {
                        int eurosensCrc = calculateEurosensCrc8(buffer, 8);
                        boolean crcOk = (buffer[8] & 0xff) == eurosensCrc;
                        int rawValue = ((buffer[7] & 0xff) << 8) | (buffer[6] & 0xff); // readUInt16LE(6)
                        data.put("isEurosens", true);
                        data.put("eurosensCrcOk", crcOk);
                        data.put("eurosensRawValue", rawValue);
                    }

                    // 2. Parseo de Trama Ráfaga 13 Bytes Flujómetro Modbus RTU (01 03 08 ...)
                    if (buffer[0] == (byte) 0x01 && buffer[1] == (byte) 0x03 && buffer[2] == (byte) 0x08 && bytesRead >= 13) {
                        int flowBits = ((buffer[3] & 0xff) << 24) | ((buffer[4] & 0xff) << 16) | ((buffer[5] & 0xff) << 8) | (buffer[6] & 0xff);
                        float flowRate = Float.intBitsToFloat(flowBits);

                        int totalBits = ((buffer[7] & 0xff) << 24) | ((buffer[8] & 0xff) << 16) | ((buffer[9] & 0xff) << 8) | (buffer[10] & 0xff);
                        float totalizer = Float.intBitsToFloat(totalBits);

                        int calculatedCrc = calculateModbusCrc16(buffer, 11);
                        int rxCrc = ((buffer[12] & 0xff) << 8) | (buffer[11] & 0xff);
                        boolean crcOk = calculatedCrc == rxCrc;

                        data.put("isFlowmeterModbus", true);
                        data.put("modbusCrcOk", crcOk);
                        data.put("flowRate", flowRate);
                        data.put("totalizer", totalizer);
                    }

                    notifyListeners(eventName, data);
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo raw de " + devicePath, e);
        }
    }

    private void readTextStream(String devicePath, String eventName, AtomicBoolean activeFlag) {
        Log.i(TAG, "Iniciando lectura NMEA en " + devicePath);
        File devFile = new File(devicePath);
        if (!devFile.exists()) return;

        byte[] buffer = new byte[512];
        StringBuilder sb = new StringBuilder();
        try (FileInputStream fis = new FileInputStream(devFile)) {
            while (activeFlag.get()) {
                int bytesRead = fis.read(buffer);
                if (bytesRead > 0) {
                    for (int i = 0; i < bytesRead; i++) {
                        char c = (char) buffer[i];
                        if (c == '\n' || c == '\r') {
                            if (sb.length() > 0) {
                                String line = sb.toString().trim();
                                sb.setLength(0);
                                if (!line.isEmpty()) {
                                    JSObject data = parseNmeaLine(line);
                                    data.put("port", devicePath);
                                    notifyListeners(eventName, data);
                                }
                            }
                        } else {
                            sb.append(c);
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo NMEA de " + devicePath, e);
        }
    }

    private JSObject parseNmeaLine(String line) {
        JSObject data = new JSObject();
        data.put("raw", line);
        data.put("timestamp", System.currentTimeMillis());

        if (line == null || !line.startsWith("$")) {
            return data;
        }

        try {
            String[] parts = line.split(",", -1);
            if (parts.length < 2) return data;

            String type = parts[0].toUpperCase();

            // Parse $GNGGA / $GPGGA (Global Positioning System Fix Data & RTK Status)
            if (type.endsWith("GGA") && parts.length >= 10) {
                data.put("isGga", true);
                data.put("utcTime", parts[1]);

                double lat = parseNmeaCoord(parts[2], parts[3]);
                double lon = parseNmeaCoord(parts[4], parts[5]);
                data.put("latitude", lat);
                data.put("longitude", lon);

                int quality = 0;
                try {
                    if (!parts[6].isEmpty()) quality = Integer.parseInt(parts[6]);
                } catch (Exception ignored) {}

                data.put("rtkQuality", quality);
                data.put("rtkStatus", getRtkQualityName(quality));
                data.put("isRtkFixed", quality == 4);
                data.put("isRtkFloat", quality == 5);
                data.put("hasFix", quality > 0);

                int sats = 0;
                try {
                    if (!parts[7].isEmpty()) sats = Integer.parseInt(parts[7]);
                } catch (Exception ignored) {}
                data.put("satellites", sats);

                double hdop = 99.9;
                try {
                    if (!parts[8].isEmpty()) hdop = Double.parseDouble(parts[8]);
                } catch (Exception ignored) {}
                data.put("hdop", hdop);

                double alt = 0.0;
                try {
                    if (!parts[9].isEmpty()) alt = Double.parseDouble(parts[9]);
                } catch (Exception ignored) {}
                data.put("altitude", alt);
            }
            // Parse $GNRMC / $GPRMC (Recommended Minimum Navigation Information)
            else if (type.endsWith("RMC") && parts.length >= 9) {
                data.put("isRmc", true);
                String status = parts[2];
                boolean valid = "A".equalsIgnoreCase(status);
                data.put("isValid", valid);

                if (valid && parts.length >= 9) {
                    double lat = parseNmeaCoord(parts[3], parts[4]);
                    double lon = parseNmeaCoord(parts[5], parts[6]);
                    data.put("latitude", lat);
                    data.put("longitude", lon);

                    double speedKnots = 0.0;
                    try {
                        if (!parts[7].isEmpty()) speedKnots = Double.parseDouble(parts[7]);
                    } catch (Exception ignored) {}
                    data.put("speedKnots", speedKnots);
                    data.put("speedKmH", speedKnots * 1.852);

                    double heading = 0.0;
                    try {
                        if (!parts[8].isEmpty()) heading = Double.parseDouble(parts[8]);
                    } catch (Exception ignored) {}
                    data.put("heading", heading);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Error parseando sentencia NMEA: " + line, e);
        }

        return data;
    }

    private double parseNmeaCoord(String raw, String dir) {
        if (raw == null || raw.isEmpty()) return 0.0;
        try {
            double val = Double.parseDouble(raw);
            int deg = (int) (val / 100);
            double min = val - (deg * 100);
            double decimal = deg + (min / 60.0);
            if ("S".equalsIgnoreCase(dir) || "W".equalsIgnoreCase(dir)) {
                decimal = -decimal;
            }
            return decimal;
        } catch (Exception e) {
            return 0.0;
        }
    }

    private String getRtkQualityName(int quality) {
        switch (quality) {
            case 1: return "GPS Standalone (~2.5m)";
            case 2: return "DGPS (~0.5m)";
            case 4: return "RTK FIXED (~1-2 cm)";
            case 5: return "RTK FLOAT (~10-20 cm)";
            case 6: return "Estimated / Dead Reckoning";
            default: return "No Fix / Buscando";
        }
    }

    @PluginMethod
    public void setGpioPin(PluginCall call) {
        String gpioName = call.getString("gpioName", "gpio137");
        int value = call.getInt("value", 1);
        String direction = call.getString("direction", "out");

        try {
            String dirCmd = "echo " + direction + " > /sys/class/gpio/" + gpioName + "/direction";
            String valCmd = "echo " + value + " > /sys/class/gpio/" + gpioName + "/value";

            Process pDir = Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd});
            pDir.waitFor();

            Process pVal = Runtime.getRuntime().exec(new String[]{"sh", "-c", valCmd});
            pVal.waitFor();

            JSObject ret = new JSObject();
            ret.put("status", "success");
            ret.put("gpioName", gpioName);
            ret.put("direction", direction);
            ret.put("value", value);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error configurando GPIO " + gpioName, e);
            call.reject("Error GPIO: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readGpioPin(PluginCall call) {
        String gpioName = call.getString("gpioName", "gpio44");
        String direction = call.getString("direction", "in");

        try {
            String dirCmd = "echo " + direction + " > /sys/class/gpio/" + gpioName + "/direction";
            Process pDir = Runtime.getRuntime().exec(new String[]{"sh", "-c", dirCmd});
            pDir.waitFor();

            File file = new File("/sys/class/gpio/" + gpioName + "/value");
            int val = 0;
            if (file.exists()) {
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] b = new byte[8];
                    int r = fis.read(b);
                    if (r > 0) {
                        String s = new String(b, 0, r).trim();
                        val = Integer.parseInt(s);
                    }
                }
            }

            JSObject ret = new JSObject();
            ret.put("gpioName", gpioName);
            ret.put("value", val);
            ret.put("isHigh", val == 1);
            call.resolve(ret);
        } catch (Exception e) {
            Log.e(TAG, "Error leyendo GPIO " + gpioName, e);
            call.reject("Error leyendo GPIO: " + e.getMessage());
        }
    }

    @PluginMethod
    public void readAllGpios(PluginCall call) {
        String[] gpioNames = new String[]{"gpio44", "gpio45", "gpio138", "gpio36", "gpio137", "gpio66", "gpio90", "gpio96"};
        JSObject list = new JSObject();
        for (String name : gpioNames) {
            File file = new File("/sys/class/gpio/" + name + "/value");
            int val = -1;
            if (file.exists()) {
                try (FileInputStream fis = new FileInputStream(file)) {
                    byte[] b = new byte[8];
                    int r = fis.read(b);
                    if (r > 0) {
                        val = Integer.parseInt(new String(b, 0, r).trim());
                    }
                } catch (Exception ignored) {}
            }
            list.put(name, val);
        }
        JSObject ret = new JSObject();
        ret.put("gpios", list);
        call.resolve(ret);
    }

    @Override
    protected void handleOnDestroy() {
        isGpsListening.set(false);
        isCan1Listening.set(false);
        isCan2Listening.set(false);
        isRs485Listening.set(false);
        enableRs485HardwarePower(false);
        try {
            canBusHelper0.uninitialize(0);
        } catch (Exception e) {
            Log.e(TAG, "Error uninitializing CAN0", e);
        }
        try {
            canBusHelper1.uninitialize(1);
        } catch (Exception e) {
            Log.e(TAG, "Error uninitializing CAN1", e);
        }
        super.handleOnDestroy();
    }
}
