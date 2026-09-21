/**
 * Canal MQTT nativo.
 *
 * El WebView no puede abrir sockets TCP crudos, asi que la conexion al broker
 * vive en el plugin Java y este modulo es solo el puente que lo llama desde
 * TypeScript.
 *
 * La logica de cuanto publicar, cuando y con que payload vive en envio.ts,
 * no aqui: este modulo solo sabe conectar, desconectar y publicar.
 */
import { registerPlugin, Capacitor } from '@capacitor/core';

interface PluginMqtt {
  conectar(o: {
    broker: string;
    puerto: number;
    usuario: string;
    clave: string;
    clientId?: string;
  }): Promise<void>;

  desconectar(): Promise<void>;

  publicar(o: {
    topic: string;
    payload: string;
  }): Promise<{ topic: string; bytes: number }>;

  estado(): Promise<{
    estado: 'conectado' | 'desconectado' | 'error';
    conectado: boolean;
    error?: string;
  }>;

  addListener(
    evento: 'onConectado' | 'onDesconectado',
    fn: (data: { broker?: string; error?: string }) => void,
  ): Promise<{ remove: () => void }>;
}

const Nativo = registerPlugin<PluginMqtt>('Mqtt');

export const hayMqtt = () => Capacitor.isNativePlatform();

export const mqtt = {
  conectar: (o: {
    broker: string;
    puerto: number;
    usuario: string;
    clave: string;
    clientId?: string;
  }) => Nativo.conectar(o),

  desconectar: () => Nativo.desconectar(),

  publicar: (topic: string, payload: string) =>
    Nativo.publicar({ topic, payload }),

  estado: () => Nativo.estado(),

  alConectar: (fn: (data: { broker?: string }) => void) =>
    Nativo.addListener('onConectado', fn),

  alDesconectar: (fn: (data: { error?: string }) => void) =>
    Nativo.addListener('onDesconectado', fn),
};
