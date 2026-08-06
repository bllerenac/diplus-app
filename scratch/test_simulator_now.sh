#!/system/bin/sh
echo "=== PRUEBA EN VIVO DEL SIMULADOR MODBUS RTU (ESCLAVO ID 1 A 9600 BAUD) ==="

for dev in /dev/ttyHSL0 /dev/ttyHSL1 /dev/ttyHSL3; do
  echo ">>> PROBANDO PUERTO $dev A 9600 BAUDIOS <<<"
  stty -F $dev 9600 raw -echo 2>/dev/null

  # 1. Enviar consulta Modbus Fn 03 Read Holding (01 03 00 00 00 02 C4 0B)
  echo "Enviando Fn 03 Modbus ID 1..."
  printf '\x01\x03\x00\x00\x00\x02\xC4\x0B' > $dev
  res3=$(timeout 1.5 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res3" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RESPUESTA MODBUS RECIBIDA CON EXITO EN $dev!!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res3"
    echo "=========================================================="
  else
    echo "Sin respuesta a Fn 03 en $dev."
  fi

  # 2. Enviar consulta Modbus Fn 04 Read Input (01 04 00 00 00 02 71 CB)
  echo "Enviando Fn 04 Modbus ID 1..."
  printf '\x01\x04\x00\x00\x00\x02\x71\xCB' > $dev
  res4=$(timeout 1.5 cat $dev | xxd -p 2>/dev/null)

  if [ -n "$res4" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RESPUESTA MODBUS RECIBIDA CON EXITO EN $dev!!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $res4"
    echo "=========================================================="
  else
    echo "Sin respuesta a Fn 04 en $dev."
  fi

  # 3. Escucha pasiva continua de ráfagas
  echo "Escuchando ráfagas pasivas en $dev durante 2 segundos..."
  pasivo=$(timeout 2 cat $dev | xxd -p 2>/dev/null)
  if [ -n "$pasivo" ]; then
    echo "=========================================================="
    echo "🎉 🎉 ¡¡¡RAFAGA PASIVA DETECTADA EN $dev!!! 🎉 🎉"
    echo "TRAMA HEX RECIBIDA: $pasivo"
    echo "=========================================================="
  fi
done
echo "=== FIN DE PRUEBA ==="
