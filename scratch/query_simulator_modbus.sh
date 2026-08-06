#!/system/bin/sh
echo "=== CONSULTA AL SIMULADOR MODBUS RTU (ESCLAVO ID 1 A 9600 BAUDIOS) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo ">>> PROBANDO PUERTO $dev A 9600 BAUDIOS <<<"
  stty -F $dev 9600 raw -echo 2>/dev/null

  # 1. Consulta Function 03 Read Holding (2 Registros - 01 03 00 00 00 02 C4 0B)
  echo "Enviando Fn 03 (01 03 00 00 00 02 C4 0B)..."
  printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev
  res3=$(timeout 1.2 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res3" ]; then
    echo "======================================================="
    echo "🎉 🎉 ¡¡RESPUESTA MODBUS RECIBIDA CON EXITO EN $dev!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res3"
    echo "======================================================="
  else
    echo "Sin respuesta en $dev para Fn 03 a 9600 baud."
  fi

  # 2. Consulta Function 04 Read Input (2 Registros - 01 04 00 00 00 02 71 CB)
  echo "Enviando Fn 04 (01 04 00 00 00 02 71 CB)..."
  printf '\x01\x04\x00\x00\x00\x02\x71\xCB' > $dev
  res4=$(timeout 1.2 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res4" ]; then
    echo "======================================================="
    echo "🎉 🎉 ¡¡RESPUESTA MODBUS RECIBIDA CON EXITO EN $dev!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res4"
    echo "======================================================="
  else
    echo "Sin respuesta en $dev para Fn 04 a 9600 baud."
  fi
done
echo "=== FIN DE TEST ==="
