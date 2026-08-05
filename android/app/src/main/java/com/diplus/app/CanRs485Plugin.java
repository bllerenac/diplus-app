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
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "CanRs485")
public class CanRs485Plugin extends Plugin {

    private static final String TAG = "CanRs485Plugin";
    private final AtomicBoolean isGpsListening = new AtomicBoolean(false);
    private final AtomicBoolean isCan1Listening = new AtomicBoolean(false);
    private final AtomicBoolean isCan2Listening = new AtomicBoolean(false);

    private Thread gpsThread;
    private Thread can1Thread;
    private Thread can2Thread;
    private LocationManager locationManager;

    @PluginMethod
    public void setPortBaudrate(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL3");
        int baudrate = call.getInt("baudrate", 115200);

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
    public void startGpsListener(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL2");

        // Activar el motor Qualcomm GNSS a nivel de Android Framework y emitir fix a JS
        try {
            getActivity().runOnUiThread(() -> {
                try {
                    locationManager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
                    if (locationManager != null && locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000, 0, new LocationListener() {
                            @Override
                            public void onLocationChanged(Location location) {
                                Log.d(TAG, "Android LocationManager GPS Fix: " + location.getLatitude() + ", " + location.getLongitude());
                                JSObject data = new JSObject();
                                data.put("latitude", location.getLatitude());
                                data.put("longitude", location.getLongitude());
                                data.put("speed", location.getSpeed() * 3.6); // m/s a Km/h
                                data.put("altitude", location.getAltitude());
                                data.put("timestamp", System.currentTimeMillis());
                                notifyListeners("onGpsLocationFix", data);
                            }
                            @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
                            @Override public void onProviderEnabled(String provider) {}
                            @Override public void onProviderDisabled(String provider) {}
                        });
                        Log.i(TAG, "Activado requestLocationUpdates en Qualcomm GNSS");
                    }
                } catch (SecurityException se) {
                    Log.w(TAG, "Permiso de ubicación no concedido en Android manifest: " + se.getMessage());
                } catch (Exception e) {
                    Log.e(TAG, "Error activando LocationManager: " + e.getMessage());
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Error invocando UI Thread para LocationManager", e);
        }

        if (!isGpsListening.get()) {
            isGpsListening.set(true);
            configureStty(devicePath, 9600);
            gpsThread = new Thread(() -> readTextStream(devicePath, "onGpsData", isGpsListening));
            gpsThread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        call.resolve(ret);
    }

    @PluginMethod
    public void startCan1Listener(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL3");
        int baudrate = call.getInt("baudrate", 115200);
        if (!isCan1Listening.get()) {
            isCan1Listening.set(true);
            configureStty(devicePath, baudrate);
            can1Thread = new Thread(() -> readRawStream(devicePath, "onCan1Data", isCan1Listening));
            can1Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        call.resolve(ret);
    }

    @PluginMethod
    public void startCan2Listener(PluginCall call) {
        String devicePath = call.getString("devicePath", "/dev/ttyHSL1");
        int baudrate = call.getInt("baudrate", 115200);
        if (!isCan2Listening.get()) {
            isCan2Listening.set(true);
            configureStty(devicePath, baudrate);
            can2Thread = new Thread(() -> readRawStream(devicePath, "onCan2Data", isCan2Listening));
            can2Thread.start();
        }
        JSObject ret = new JSObject();
        ret.put("status", "started");
        ret.put("devicePath", devicePath);
        call.resolve(ret);
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
                                    JSObject data = new JSObject();
                                    data.put("raw", line);
                                    data.put("timestamp", System.currentTimeMillis());
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

    @Override
    protected void handleOnDestroy() {
        isGpsListening.set(false);
        isCan1Listening.set(false);
        isCan2Listening.set(false);
        super.handleOnDestroy();
    }
}
