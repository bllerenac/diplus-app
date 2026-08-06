#!/system/bin/sh
echo "=== CONSULTA OFICIAL FLUJOMETRO MODBUS RTU (01 03 00 00 00 04 44 09) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo "--- Provando $dev a 9600 baudios (4 Registros Float32 Flujómetro) ---"
  stty -F $dev 9600 raw -echo 2>/dev/null

  # 1. Enviar consulta Modbus Fn 03 (01 03 00 00 00 04 44 09)
  echo "Enviando 01 03 00 00 00 04 44 09..."
  printf '\x01\x03\x00\x00\x00\x04\x44\x09' > $dev
  res3=$(timeout 1.5 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res3" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RESPUESTA RECIBIDA DEL FLUJOMETRO EN $dev!!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res3"
    echo "=========================================================="
  else
    echo "Sin respuesta a Fn 03 en $dev."
  fi

  # 2. Enviar consulta Modbus Fn 04 (01 04 00 00 00 04 F1 C9)
  echo "Enviando 01 04 00 00 00 04 F1 C9..."
  printf '\x01\x04\x00\x00\x00\x04\xF1\xC9' > $dev
  res4=$(timeout 1.5 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res4" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RESPUESTA RECIBIDA DEL FLUJOMETRO EN $dev!!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res4"
    echo "=========================================================="
  else
    echo "Sin respuesta a Fn 04 en $dev."
  fi
done
echo "=== FIN DE PRUEBA ==="
